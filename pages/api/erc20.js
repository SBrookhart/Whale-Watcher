export const config = { runtime: "edge" };

import { hasAlchemy, getEnv } from "../../lib/providers";

const RPCS = [
  "https://cloudflare-eth.com",
  "https://rpc.ankr.com/eth",
];

// Wider window, but we’ll **chunk** it so RPCs don’t refuse the request
const FALLBACK_BLOCKS = 12000; // ~3–4 days
const CHUNK_SIZE = 1000;       // safe per getLogs request

const TOKENS = [
  { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
];

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

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

/** --------- Alchemy (indexer) path with pagination --------- */
async function alchemyErc20(minUsd, usdUSDC, usdUSDT) {
  const { ALCHEMY_ETH_MAINNET_KEY } = getEnv();
  const base = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_ETH_MAINNET_KEY}`;

  // Anchor window using head block from any RPC
  const headHex = await rpc(RPCS[0], "eth_blockNumber");
  const head = parseInt(headHex, 16);
  const fromBlock = "0x" + Math.max(head - 12000, 0).toString(16);

  const contracts = TOKENS.map((t) => t.address.toLowerCase());
  let pageKey = undefined;
  const items = [];

  for (let i = 0; i < 3; i++) {
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
      const sym = (t.asset || "").toUpperCase();
      const tok =
        TOKENS.find(
          (x) =>
            x.symbol === sym ||
            x.address.toLowerCase() === (t.rawContract?.address || "").toLowerCase()
        ) || null;
      if (!tok) continue;

      const amount = Number(t.value || 0); // already decimal
      if (!amount) continue;
      const price = tok.symbol === "USDT" ? usdUSDT : usdUSDC;
      const usd = amount * price;

      if (usd >= minUsd) {
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

    pageKey = json?.result?.pageKey;
    if (!pageKey) break;
  }

  items.sort((a, b) => b.usd - a.usd);
  return items;
}

/** --------- Public RPC getLogs, chunked --------- */
async function fallbackErc20(minUsd, usdUSDC, usdUSDT) {
  // Try RPCs in order until one works
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
  const start = Math.max(head - FALLBACK_BLOCKS, 0);

  const items = [];

  // Process each token separately
  for (const t of TOKENS) {
    const price = t.symbol === "USDT" ? usdUSDT : usdUSDC;

    // Walk the range in CHUNK_SIZE steps to avoid silent empty responses
    for (let from = start; from <= head; from += CHUNK_SIZE + 1) {
      const to = Math.min(from + CHUNK_SIZE, head);
      const filter = {
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        address: t.address,
        topics: [TRANSFER_TOPIC],
      };

      let logs;
      try {
        logs = await rpc(rpcUrl, "eth_getLogs", [filter]);
      } catch {
        continue; // skip chunk on error
      }
      for (const log of logs || []) {
        try {
          const raw = BigInt(log.data || "0x0");
          const amount = Number(raw) / 10 ** t.decimals;
          if (!amount) continue;
          const usd = amount * price;
          if (usd >= minUsd) {
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
        } catch {
          /* ignore a bad log */
        }
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
    if (hasAlchemy()) {
      const a = await alchemyErc20(minUsd, usdUSDC, usdUSDT);
      if (a.length >= 1) {
        items = a;
      } else {
        const f = await fallbackErc20(minUsd, usdUSDC, usdUSDT);
        items = f;
      }
    } else {
      items = await fallbackErc20(minUsd, usdUSDC, usdUSDT);
    }
  } catch {
    try {
      items = await fallbackErc20(minUsd, usdUSDC, usdUSDT);
    } catch {
      items = [];
    }
  }

  // de-dup by tx hash
  const seen = new Set();
  items = items.filter((it) => (seen.has(it.hash) ? false : (seen.add(it.hash), true)));

  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
