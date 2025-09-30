export const config = { runtime: "edge" };

import { hasAlchemy, hasHelius } from "../../lib/providers";

export default async function handler() {
  // Lightweight checks: prices + simple pings
  let prices = {};
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,solana,usd-coin,tether&vs_currencies=usd", { cache: "no-store" });
    prices = await r.json();
  } catch { prices = { error: "price_fetch_failed" }; }

  return new Response(JSON.stringify({
    env: {
      ALCHEMY: hasAlchemy(),
      HELIUS: hasHelius(),
    },
    prices,
    notes: [
      "If env flags are false, routes fall back to public RPC (less coverage).",
      "If prices are 0/undefined, USD filters will hide items.",
    ]
  }), { headers: { "content-type": "application/json" }});
}
