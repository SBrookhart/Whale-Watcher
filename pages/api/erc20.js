export const config = { runtime: "edge" };

const ETH_RPC = "https://cloudflare-eth.com";
// Wider window for stablecoin transfers (~8–10 hours depending on network conditions)
const BLOCKS_TO_SCAN = 2500;

const TOKENS = [
  { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
];

// keccak256("Transfer(address,address,uint256)")
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

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const minUsd = Number(searchParams.get("minUsd") || "1000000");
  const usdUSDC = Number(searchParams.get("usdUSDC") || "1");
  const usdUSDT = Number(searchParams.get("usdUSDT") || "1");

  const latest = await rpc("eth_blockNumber");
  const head = parseInt(latest.result, 16);
  const fromBlock = "0x" + Math.max(head - BLOCKS_TO_SCAN, 0).toString(16);
  const toBlock = "0x" + head.toString(16);

  const items = [];
  for (const t of TOKENS) {
    const price = t.symbol === "USDT" ? usdUSDT : usdUSDC;
    const filter = { fromBlock, toBlock, address: t.address, topics: [TRANSFER_TOPIC] };
    const logs = await rpc("eth_getLogs", [filter]);

    for (const log of logs.result || []) {
      const raw = BigInt(log.data || "0x0");
      const amount = Number(raw) / 10 ** t.decimals;
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
          ts: Date.now() / 1000, // cheaper than extra block lookups for prototype
        });
      }
    }
  }

  items.sort((a, b) => b.usd - a.usd);
  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
