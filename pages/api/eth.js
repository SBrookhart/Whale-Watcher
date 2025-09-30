export const config = { runtime: "edge" };

import { hasAlchemy, getEnv } from "../../lib/providers";

const RPCS = [
  "https://cloudflare-eth.com",
  "https://rpc.ankr.com/eth",
];
const FALLBACK_BLOCKS = 4000; // ~12+ hours for native tx scanning

async function rpc(url, method, params = []) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`RPC ${url} ${method} HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method} error: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function ensureUsdEth(usdEth) {
  if (usdEth > 0) return usdEth;
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { cache: "no-store" }
    );
    const j = await r.json();
    return Number(j?.ethereum?.usd || 0);
  } catch {
    return 0;
  }
}

/** --------- Alchemy (indexer) with pagination --------- */
async function alchemyTransfers(minUsd, usdEth) {
  const { ALCHEMY_ETH_MAINNET_KEY } = getEnv();
  const base = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_ETH_MAINNET_KEY}`;

  // Anchor window to last ~3–4 days
  const headHex = await rpc(RPCS[0], "eth_blockNumber");
  const head = parseInt(headHex, 16);
  const fromBlock = "0x" + Math.max(head - 12000, 0).toString(16);

  let pageKey = undefined;
  const items = [];
  for (let i = 0; i < 3; i++) {
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [
        {
          category: ["external", "internal"],
          withMetadata: true,
          order: "desc",
          fromBlock,
          excludeZeroValue: true,
          maxCount: "0x3e8",
          pageKey,
        },
      ],
    };
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
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
          ts: t.metadata?.blockTimestamp
            ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
        });
      }
    }

    pageKey = json?.result?.pageKey;
    if (!pageKey) break;
  }

  items.sort((a, b) => b.usd - a.usd);
  return items;
}

/** --------- Public RPC fallback scan (wider) --------- */
async function fallbackScan(minUsd, usdEth) {
  // pick a working RPC
  let rpcUrl = RPCS[0];
  for (const url of RPCS) {
    try {
      await rpc(url, "eth_chainId");
      rpcUrl = url;
      break;
    } catch {
      /* try next */
    }
  }

  const headHex = await rpc(rpcUrl, "eth_blockNumber");
  const head = parseInt(headHex, 16);

  const items = [];
  const start = Math.max(head - FALLBACK_BLOCKS, 0);
  for (let bn = head; bn >= start; bn--) {
    const numHex = "0x" + bn.toString(16);
    let b;
    try {
      b = await rpc(rpcUrl, "eth_getBlockByNumber", [numHex, true]);
    } catch {
      continue;
    }
    const txs = b?.transactions || [];
    for (const tx of txs) {
      const valHex = tx.value || "0x0";
      let eth = 0;
      try {
        const wei = BigInt(valHex);
        eth = Number(wei) / 1e18;
      } catch {
        eth = 0;
      }
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
          ts: Number(b.timestamp || Math.floor(Date.now() / 1000)),
        });
      }
    }
  }

  items.sort((a, b) => b.usd - a.usd);
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
      if (a.length >= 1) {
        items = a;
      } else {
        const f = await fallbackScan(minUsd, usdEth);
        items = f;
      }
    } else {
      items = await fallbackScan(minUsd, usdEth);
    }
  } catch {
    try {
      items = await fallbackScan(minUsd, usdEth);
    } catch {
      items = [];
    }
  }

  // de-dupe by hash
  const seen = new Set();
  items = items.filter((it) => (seen.has(it.hash) ? false : (seen.add(it.hash), true)));

  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
