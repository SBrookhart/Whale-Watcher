export const config = { runtime: "edge" };

const ETH_RPC = "https://cloudflare-eth.com";
const BLOCKS_TO_SCAN = 20;

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
  const usdEth = Number(searchParams.get("usdEth") || "0");
  const minUsd = Number(searchParams.get("minUsd") || "1000000");

  const latest = await rpc("eth_blockNumber");
  const head = parseInt(latest.result, 16);

  const items = [];
  for (let i = 0; i < BLOCKS_TO_SCAN; i++) {
    const numHex = "0x" + (head - i).toString(16);
    const b = await rpc("eth_getBlockByNumber", [numHex, true]);
    const txs = b.result?.transactions || [];
    for (const tx of txs) {
      const eth = Number(BigInt(tx.value) / 10n ** 18n);
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
          ts: Number(
            b.result.timestamp ? parseInt(b.result.timestamp, 16) : Date.now() / 1000
          ),
        });
      }
    }
  }

  items.sort((a, b) => b.usd - a.usd);
  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
