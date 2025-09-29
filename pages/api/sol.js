export const config = { runtime: "edge" };

const SOL_RPC = "https://api.mainnet-beta.solana.com";
const SLOTS_TO_SCAN = 4;

async function rpc(method, params = []) {
  const r = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const usdSol = Number(searchParams.get("usdSol") || "0");
  const minUsd = Number(searchParams.get("minUsd") || "1000000");
  const stableOnly = searchParams.get("stableOnly") === "1";

  // Placeholder: requires indexer for USDC mint transfers (EPjFWd...Td1v).
  if (stableOnly) {
    return new Response(
      JSON.stringify({
        items: [],
        note:
          "Solana stablecoin-only mode requires an indexer (e.g., Helius/Solscan Pro). This API returns no items in this mode.",
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  const slotInfo = await rpc("getSlot");
  const head = slotInfo.result;

  const items = [];
  for (let i = 0; i < SLOTS_TO_SCAN; i++) {
    const slot = head - i;
    const blk = await rpc("getBlock", [
      slot,
      {
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      },
    ]);
    const txs = blk.result?.transactions || [];
    for (const tx of txs) {
      const meta = tx.meta;
      const message = tx.transaction.message;
      if (!meta || !message) continue;

      const ix = message.instructions || [];
      for (const ins of ix) {
        const programId = message.accountKeys[ins.programIdIndex]?.toString?.() || "";
        if (programId !== "11111111111111111111111111111111") continue; // System program

        const data = typeof ins.data === "string" ? ins.data : "";
        if (!data) continue;
        const buf = Buffer.from(data, "base64");
        if (buf.length < 12) continue;
        const kind = buf.readUInt32LE(0);
        if (kind !== 2) continue; // transfer
        const lamports = Number(buf.readBigUInt64LE(4));
        const sol = lamports / 1e9;
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
            ts: blk.result?.blockTime || Math.floor(Date.now() / 1000),
          });
        }
      }
    }
  }

  items.sort((a, b) => b.usd - a.usd);
  return new Response(JSON.stringify({ items }), {
    headers: { "content-type": "application/json" },
  });
}
