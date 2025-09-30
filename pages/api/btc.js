export const config = { runtime: "edge" };

const BASE = "https://mempool.space/api";

async function safeJson(r) {
  try { return await r.json(); } catch { return null; }
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const usdBtc = Number(searchParams.get("usdBtc") || "0");
  const minUsd = Number(searchParams.get("minUsd") || "1000000");

  const items = [];

  // 1) Try /mempool/txids
  try {
    const r = await fetch(`${BASE}/mempool/txids`, { cache: "no-store" });
    if (r.ok) {
      const ids = (await safeJson(r)) || [];
      for (const txid of ids.slice(0, 250)) {
        const d = await fetch(`${BASE}/tx/${txid}`, { cache: "no-store" });
        if (!d.ok) continue;
        const tx = await safeJson(d);
        if (!tx) continue;
        const totalOut = (tx.vout || []).reduce((s, o) => s + (o.value || 0), 0) / 1e8;
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
            ts: tx.status?.block_time ?? Math.floor(Date.now()/1000),
          });
        }
      }
    }
  } catch { /* ignore */ }

  // 2) If nothing, try /mempool/recent
  if (items.length < 1) {
    try {
      const r = await fetch(`${BASE}/mempool/recent`, { cache: "no-store" });
      if (r.ok) {
        const arr = (await safeJson(r)) || [];
        for (const e of arr) {
          const totalOut = (e?.value || 0) / 1e8; // mempool/recent gives 'value' in sats for fee? Some deployments vary; guard anyway
          const usd = totalOut * usdBtc;
          if (usd >= minUsd && totalOut > 0) {
            items.push({
              chain: "bitcoin",
              kind: "BTC",
              amount: totalOut,
              usd,
              from: "mempool",
              to: "multiple",
              hash: e.txid,
              ts: Math.floor(Date.now()/1000),
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 3) If still nothing, look at last few blocks
  if (items.length < 1) {
    try {
      const r = await fetch(`${BASE}/blocks`, { cache: "no-store" });
      if (r.ok) {
        const blocks = (await safeJson(r)) || [];
        for (const b of blocks.slice(0, 3)) {
          const br = await fetch(`${BASE}/block/${b.id}/txs`, { cache: "no-store" });
          if (!br.ok) continue;
          const txs = (await safeJson(br)) || [];
          for (const tx of txs) {
            const totalOut = (tx.vout || []).reduce((s, o) => s + (o.value || 0), 0) / 1e8;
            const usd = totalOut * usdBtc;
            if (usd >= minUsd) {
              items.push({
                chain: "bitcoin",
                kind: "BTC",
                amount: totalOut,
                usd,
                from: "block",
                to: "multiple",
                hash: tx.txid,
                ts: b.timestamp || Math.floor(Date.now()/1000),
              });
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  items.sort((a,b)=>b.usd - a.usd);
  return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } });
}
