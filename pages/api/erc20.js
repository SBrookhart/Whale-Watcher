export const config = { runtime: "edge" };

import { hasAlchemy, getEnv } from "../../lib/providers";

const ETH_RPC = "https://cloudflare-eth.com";
const FALLBACK_BLOCKS = 2500;

const TOKENS = [
  { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
];
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc(method, params = []) {
  const r = await fetch(ETH_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

async function ensureUsd(sym, incoming) {
  if (incoming > 0) return incoming;
  try {
    const id = sym === "USDT" ? "tether" : "usd-coin";
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { cache: "no-store" }
    );
    const j = await r.json();
    return Number(j?.[id]?.usd || 1);
  } catch {
    return 1;
  }
}

async function alchemyErc20(minUsd, usdUSDC, usdUSDT) {
  const { ALCHEMY_ETH_MAINNET_KEY } = getEnv();
  const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_ETH_MAINNET_KEY}`;

  // limit to last ~1–1.5 days by fromBlock to avoid stale pages
  const latest = await rpc("eth_blockNumber");
  const head = parseInt(latest.result, 16);
  const fromBlock = "0x" + Math.max(head - 5000, 0).toString(16);

  const contracts = TOKENS.map((t) => t.address.toLowerCase());
  const body = {
    id: 1,
    jsonrpc: "2.0",
    method: "alchemy_getAssetTransfers",
    params: [
      {
        category: ["erc20"],
        contractAddresses: contracts,
        withMetadata: true,
        order: "desc",
        fromBlock,
        excludeZeroValue: true,
        maxCount: "0x3e8",
      },
    ],
  };

  const res = await fetch(alchemyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Alchemy ERC20 transfers error");
  const json = await res.json();
  const txs = json?.result?.transfers || [];

  const items = [];
  for (const t of txs) {
    const sym = (t.asset || "").toUpperCase();
    const tok =
      TOKENS.find(
        (x) =>
          x.symbol === sym ||
          x.address.toLowerCase() === (t.rawContract?.address || "").toLowerCase()
      ) || null;
    if (!tok) continue;

    const amount = Number(t.value || 0); // already decimal, not scaled
    const price = tok.symbol === "USDT" ? usdUSDT : usdUSDC;
    const usd = amount * price;

    if (usd >= minUsd && amount > 0) {
      items.push({
        chain: "ethereum",
        kind: tok.symbol,
        amount,
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

  items.sort((a, b) => b.usd - a.usd);
  return items;
}

async function fallbackErc20(minUsd, usdUSDC, usdUSDT) {
  const latest = await rpc("eth_blockNumber");
  const head = parseInt(latest.result, 16);
  const fromBlock = "0x" + Math.max(head - FALLBACK_BLOCKS, 0).toString(16);
  const toBlock = "0x" + head.toString(16);

  const items = [];
  for (const t of TOKENS) {
    const price = t.symbol === "USDT" ? usdUSDT : usdUSDC;
    const filter = {
      fromBlock,
      toBlock,
      address: t.address,
      topics: [TRANSFER_TOPIC],
    };
    const logs = await rpc("eth_getLogs", [filter]);
    for (const log of logs.result || []) {
      const raw = BigInt(log.data || "0x0");
      const amount = Number(raw) / 10 ** t.decimals;
      const usd = amount * price;
      if (usd >= minUsd && amount > 0) {
        items.push({
          chain: "ethereum",
          kind: t.symbol,
          amount,
          usd,
          from: "0x" + log.topics[1].slice(26),
          to: "0x" + log.topics[2].slice(26),
          hash: log.transactionHash,
          ts: Math.floor(Date.now() / 1000),
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

  let usdUSDC = Number(searchParams.get("usdUSDC") || "0");
  let usdUSDT = Number(searchParams.get("usdUSDT") || "0");
  usdUSDC = await ensureUsd("USDC", usdUSDC);
  usdUSDT = await ensureUsd("USDT", usdUSDT);

  let items = [];
  try {
    if (hasAlchemy()) items = await alchemyErc20(minUsd, usdUSDC, usdUSDT);
    else items = await fallbackErc20(minUsd, usdUSDC, usdUSDT);
  } catch {
    items = [];
  }

  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
