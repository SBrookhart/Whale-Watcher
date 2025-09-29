export async function fetchUsdPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,solana,usd-coin,tether&vs_currencies=usd";
  const r = await fetch(url, { next: { revalidate: 15 } });
  if (!r.ok) throw new Error("Price feed error");
  const j = await r.json();
  return {
    ETH: j.ethereum?.usd ?? 0,
    BTC: j.bitcoin?.usd ?? 0,
    SOL: j.solana?.usd ?? 0,
    USDC: j["usd-coin"]?.usd ?? 1,
    USDT: j.tether?.usd ?? 1,
  };
}
