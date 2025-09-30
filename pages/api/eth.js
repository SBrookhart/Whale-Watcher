export const config = { runtime: "edge" };

import { hasAlchemy, getEnv } from "../../lib/providers";

/**
 * Uses Alchemy Transfers API when ALCHEMY_ETH_MAINNET_KEY is set.
 * Falls back to Cloudflare RPC scan if not set (works, but less comprehensive).
 */

const ETH_RPC = "https://cloudflare-eth.com";
const FALLBACK_BLOCKS = 200; // used only if no Alchemy key present

async function rpc(method, params = []) {
  const r = await fetch(ETH_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

async function alchemyTransfers(minUsd, usdEth) {
  const { ALCHEMY_ETH_MAINNET_KEY } = getEnv();
  const url = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_ETH_MAINNET_KEY}`;

  // alchemy_getAssetTransfers for native (ETH) "external" transfers
  const body = {
    id: 1,
    jsonrpc: "2.0",
    method: "alchemy_getAssetTransfers",
    params: [{
      category: ["external"],
      withMetadata: true,
      order: "desc",
      maxCount: "0x3e8" // 1000
    }]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Alchemy ETH transfers error");
  const json = await res.json();
  const txs = json?.result?.transfers || [];

  const items = [];
  for (const t of txs) {
    // native ETH transfers expose value as a decimal string of ETH
    const eth = Number(t.value || 0);
    const usd = eth * usdEth;
    if (usd >= minUsd && eth > 0) {
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
  items.sort((a,b)=>b.usd - a.usd);
  return items;
}

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
      const usd = eth * usdEth;
      if (usd >= minUsd && eth > 0) {
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
  const usdEth = Number(searchParams.get("usdEth") || "0");
  const minUsd = Number(searchParams.get("minUsd") || "1000000");

  let items = [];
  try {
    if (hasAlchemy()) {
      items = await alchemyTransfers(minUsd, usdEth);
    } else {
      items = await fallbackScan(minUsd, usdEth);
    }
  } catch (e) {
    // graceful failure → empty list
    items = [];
  }

  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
