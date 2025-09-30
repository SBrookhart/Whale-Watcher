export const config = { runtime: "edge" };

import { hasAlchemy, getEnv } from "../../lib/providers";

const ETH_RPC = "https://cloudflare-eth.com";
const FALLBACK_BLOCKS = 600; // ~2+ hours

async function rpc(method, params = []) {
  const r = await fetch(ETH_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

async function ensureUsdEth(usdEth) {
  if (usdEth > 0) return usdEth;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { cache: "no-store" });
    const j = await r.json();
    return Number(j?.ethereum?.usd || 0);
  } catch { return 0; }
}

/** ---------- Alchemy (indexer) with pagination + wide window ---------- */
async function alchemyTransfers(minUsd, usdEth) {
  const { ALCHEMY_ETH_MAINNET_KEY } = getEnv();
  const base = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_ETH_MAINNET_KEY}`;

  // Use a recent fromBlock anchor to avoid stale pages
  const latest = await rpc("eth_blockNumber");
  const head = parseInt(latest.result, 16);
  const fromBlock = "0x" + Math.max(head - 12000, 0).toString(16); // ~3–4 days

  let pageKey = undefined;
  const items = [];
  for (let i = 0; i < 3; i++) { // up to 3 pages (≈ 3000 transfers)
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [{
        category: ["external", "internal"],
        withMetadata: true,
        order: "desc",
        fromBlock,
        excludeZeroValue: true,
        maxCount: "0x3e8", // 1000
        pageKey
      }]
    };
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;
    const json = await res.json();
    const txs = json?.result?.transfers || [];

    for (const t of txs) {
      const eth = Number(t.value || 0);
      if (!eth) continue;
      const usd = eth * usdEth;
      if (usd >= minUsd) {
        items.push({
          chain: "ethereum",
          kind: "ETH",
          amount: eth,
          usd,
          from: t.from,
          to: t.to,
          hash: t.hash,
          ts: t.metadata?.blockTimestamp ? Math.floor(new Date(t.metadata.blockTimestamp).getTime()/1000) : Math.floor(Date.now()/1000),
        });
      }
    }

    pageKey = json?.result?.pageKey;
    if (!pageKey) break;
  }

  items.sort((a,b)=>b.usd - a.usd);
  return items;
}

/** ---------- Public RPC fallback scan (merge safety net) ---------- */
async function fallbackScan(minUsd, usdEth) {
  const latest = await rpc("eth_blockNumber");
  const head = parseInt(latest.result, 16);
  const items = [];

  for (let i = 0; i < FALLBACK_BLOCKS; i++) {
    const numHex = "0x" + (head - i).toString(16);
    const b = await rpc("eth_getBlockByNumber", [numHex, true]);
    const txs = b.result?.transactions || [];
    for (const tx of txs) {
      const wei = BigInt(tx.value || "0x0");
      const eth = Number(wei) / 1e18;
      if (!eth) continue;
      const usd = eth * usdEth;
      if (usd >= minUsd) {
        items.push({
          chain: "ethereum",
          kind: "ETH",
          amount: eth,
          usd,
          from: tx.from,
          to: tx.to,
          hash: tx.hash,
          ts: Number(b.result?.timestamp ? parseInt(b.result.timestamp, 16) : Date.now()/1000),
        });
      }
    }
  }

  items.sort((a,b)=>b.usd - a.usd);
  return items;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const minUsd = Number(searchParams.get("minUsd") || "1000000");
  let usdEth = Number(searchParams.get("usdEth") || "0");
  usdEth = await ensureUsdEth(usdEth);

  let items = [];
  try {
    if (hasAlchemy()) {
      const a = await alchemyTransfers(minUsd, usdEth);
      // If indexer returns thin results, merge with fallback
      const needsFallback = a.length < 3;
      if (needsFallback) {
        const f = await fallbackScan(minUsd, usdEth);
        items = [...a, ...f];
      } else {
        items = a;
      }
    } else {
      items = await fallbackScan(minUsd, usdEth);
    }
  } catch {
    // final guard
    try { items = await fallbackScan(minUsd, usdEth); } catch { items = []; }
  }

  // de-duplicate by tx hash
  const seen = new Set();
  items = items.filter(it => (seen.has(it.hash) ? false : (seen.add(it.hash), true)));

  return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } });
}
