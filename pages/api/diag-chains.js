export const config = { runtime: "edge" };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const minUsd = Number(searchParams.get("minUsd") || "10000");
  const usdEth = Number(searchParams.get("usdEth") || "4000");
  const usdUSDC = Number(searchParams.get("usdUSDC") || "1");
  const usdUSDT = Number(searchParams.get("usdUSDT") || "1");
  const usdBtc = Number(searchParams.get("usdBtc") || "110000");
  const usdSol = Number(searchParams.get("usdSol") || "200");
  const stableOnly = searchParams.get("stableOnly") || "0";

  async function j(path) {
    try {
      const url = `${path}?minUsd=${minUsd}&usdEth=${usdEth}&usdUSDC=${usdUSDC}&usdUSDT=${usdUSDT}&usdBtc=${usdBtc}&usdSol=${usdSol}&stableOnly=${stableOnly}`;
      const r = await fetch(url, { cache: "no-store" });
      const x = await r.json();
      return { ok: r.ok, count: (x.items || []).length, sample: (x.items || [])[0] || null, note: x.note || null };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  const [eth, erc20, btc, sol] = await Promise.all([
    j("/api/eth"), j("/api/erc20"), j("/api/btc"), j("/api/sol")
  ]);

  return new Response(JSON.stringify({ minUsd, eth, erc20, btc, sol }), {
    headers: { "content-type": "application/json" }
  });
}
