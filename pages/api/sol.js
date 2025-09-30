export const config = { runtime: "edge" };

import { hasHelius, getEnv } from "../../lib/providers";

const SOL_RPC = "https://api.mainnet-beta.solana.com";
const SLOTS_TO_SCAN = 40; // wider fallback

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function rpc(method, params = []) {
  const r = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

/** Helius: native SOL transfers (broader) */
async function heliusNativeSol(minUsd, usdSol) {
  const { HELIUS_API_KEY } = getEnv();
  const url = `https://api.helius.xyz/v1/transactions?api-key=${HELIUS_API_KEY}`;
  const body = {
    query: { types: ["TRANSFER"] },
    options: { limit: 1000, sortOrder: "desc" }
  };
  const res = await fetch(url, { method:"POST", headers: { "content-type":"application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error("Helius native SOL query failed");
  const data = await res.json();
  const txs = Array.isArray(data) ? data : data?.result || [];

  const items = [];
  for (const t of txs) {
    const transfers = t.nativeTransfers || [];
    for (const x of transfers) {
      const sol = Number(x.amount || 0) / 1e9;
      if (!sol) continue;
      const usd = sol * usdSol;
      if (usd >= minUsd) {
        items.push({
          chain: "solana",
          kind: "SOL",
          amount: sol,
          usd,
          from: x.fromUserAccount || "",
          to: x.toUserAccount || "",
          hash: t.signature || "",
          ts: t.timestamp || Math.floor(Date.now()/1000)
        });
      }
    }
  }
  items.sort((a,b)=>b.usd - a.usd);
  return items;
}

/** Helius: USDC token transfers only */
async function heliusStablecoinOnly(minUsd, usdUSDC) {
  const { HELIUS_API_KEY } = getEnv();
  const url = `https://api.helius.xyz/v1/transactions?api-key=${HELIUS_API_KEY}`;
  const body = {
    query: { types: ["TRANSFER"], accounts: [USDC_MINT] },
    options: { limit: 1000, sortOrder: "desc" }
  };
  const res = await fetch(url, { method:"POST", headers: { "content-type":"application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error("Helius USDC query failed");
  const data = await res.json();
  const txs = Array.isArray(data) ? data : data?.result || [];

  const items = [];
  for (const t of txs) {
    const tokenTransfers = t.tokenTransfers || [];
    for (const x of tokenTransfers) {
      if ((x.mint || "").toLowerCase() !== USDC_MINT.toLowerCase()) continue;
      const amount = Number(x.tokenAmount || 0);
      if (!amount) continue;
      const usd = amount * usdUSDC;
      if (usd >= minUsd) {
        items.push({
          chain: "solana",
          kind: "USDC",
          amount,
          usd,
          from: x.fromUserAccount || "",
          to: x.toUserAccount || "",
          hash: t.signature || "",
          ts: t.timestamp || Math.floor(Date.now()/1000)
        });
      }
    }
  }
  items.sort((a,b)=>b.usd - a.usd);
  return items;
}

/** Fallback scanner via RPC (native SOL only) */
async function fallbackNativeSol(minUsd, usdSol) {
  const slotInfo = await rpc("getSlot");
  const head = slotInfo.result;

  const items = [];
  for (let i = 0; i < SLOTS_TO_SCAN; i++) {
    const slot = head - i;
    const blk = await rpc("getBlock", [slot, { maxSupportedTransactionVersion: 0, transactionDetails: "full", rewards: false }]);
    const txs = blk.result?.transactions || [];
    for (const tx of txs) {
      const meta = tx.meta;
      const message = tx.transaction.message;
      if (!meta || !message) continue;

      const ix = message.instructions || [];
      for (const ins of ix) {
        const programId = message.accountKeys[ins.programIdIndex]?.toString?.() || "";
        if (programId !== "11111111111111111111111111111111") continue; // system program

        const data = typeof ins.data === "string" ? ins.data : "";
        if (!data) continue;
        const buf = Buffer.from(data, "base64");
        if (buf.length < 12) continue;
        const kind = buf.readUInt32LE(0);
        if (kind !== 2) continue;
        const lamports = Number(buf.readBigUInt64LE(4));
        const sol = lamports / 1e9;
        if (!sol) continue;
        const usd = sol * usdSol;
        if (usd >= minUsd) {
          const from = message.accountKeys[ins.accounts[0]]?.toString?.() || "";
          const to = message.accountKeys[ins.accounts[1]]?.toString?.() || "";
          items.push({
            chain: "solana",
            kind: "SOL",
            amount: sol,
            usd,
            from,
            to,
            hash: tx.transaction.signatures?.[0] || "",
            ts: blk.result?.blockTime || Math.floor(Date.now()/1000),
          });
        }
      }
    }
  }
  items.sort((a,b)=>b.usd - a.usd);
  return items;
}

/** Router */
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const usdSol  = Number(searchParams.get("usdSol") || "0");
  const usdUSDC = Number(searchParams.get("usdUSDC") || "1");
  const minUsd  = Number(searchParams.get("minUsd") || "1000000");
  const stableOnly = searchParams.get("stableOnly") === "1";

  let items = [];
  try {
    if (hasHelius()) {
      items = stableOnly ? await heliusStablecoinOnly(minUsd, usdUSDC) : await heliusNativeSol(minUsd, usdSol);
      if (items.length < 3 && !stableOnly) {
        const f = await fallbackNativeSol(minUsd, usdSol);
        items = [...items, ...f];
      }
    } else {
      items = stableOnly ? [] : await fallbackNativeSol(minUsd, usdSol);
    }
  } catch {
    try { items = stableOnly ? [] : await fallbackNativeSol(minUsd, usdSol); } catch { items = []; }
  }

  // de-dupe by signature
  const seen = new Set();
  items = items.filter(it => (seen.has(it.hash) ? false : (seen.add(it.hash), true)));

  return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } });
}
