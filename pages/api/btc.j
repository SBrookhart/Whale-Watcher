export const config = { runtime: "edge" };

const BASE = "https://mempool.space/api";

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const usdBtc = Number(searchParams.get("usdBtc") || "0");
  const minUsd = Number(searchParams.get("minUsd") || "1000000");

  const r = await fetch(`${BASE}/mempool/txids`);
  if (!r.ok)
    return new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
    });
  const ids = (await r.json()).slice(0, 30);

  const items = [];
  for (const txid of ids) {
    const d = await fetch(`${BASE}/tx/${txid}`);
    if (!d.ok) continue;
    const tx = await d.json();
    const totalOut =
      (tx.vout || []).reduce((s, o) => s + (o.value || 0), 0) / 1e8; // BTC
    const usd = totalOut * usdBtc;
    if (usd >= minUsd) {
      items.push({
        chain: "bitcoin",
        kind: "BTC",
        amount: totalOut,
        usd,
        from: "mempool",
        to: "multiple",
        hash: txid,
        ts: tx.status?.block_time ?? Date.now() / 1000,
      });
    }
  }

  items.sort((a, b) => b.usd - a.usd);
  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
