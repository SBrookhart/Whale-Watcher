export const config = { runtime: "edge" };

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const origin = `${reqUrl.protocol}//${reqUrl.host}`;

  const minUsd = Number(reqUrl.searchParams.get("minUsd") || "10000");
  const usdEth  = Number(reqUrl.searchParams.get("usdEth")  || "4000");
  const usdUSDC = Number(reqUrl.searchParams.get("usdUSDC") || "1");
  const usdUSDT = Number(reqUrl.searchParams.get("usdUSDT") || "1");
  const usdBtc  = Number(reqUrl.searchParams.get("usdBtc")  || "110000");
  const usdSol  = Number(reqUrl.searchParams.get("usdSol")  || "200");
  const stableOnly = reqUrl.searchParams.get("stableOnly") || "0";

  const qs = new URLSearchParams({
    minUsd: String(minUsd),
    usdEth: String(usdEth),
    usdUSDC: String(usdUSDC),
    usdUSDT: String(usdUSDT),
    usdBtc: String(usdBtc),
    usdSol: String(usdSol),
    stableOnly
  }).toString();

  async function j(path) {
    try {
      const url = new URL(`${path}?${qs}`, origin).toString();
      const r = await fetch(url, { cache: "no-store" });
      const x = await r.json();
      return {
        ok: r.ok,
        count: Array.isArray(x.items) ? x.items.length : 0,
        sample: Array.isArray(x.items) && x.items.length ? x.items[0] : null,
        note: x.note || null
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  const [eth, erc20, btc, sol] = await Promise.all([
    j("/api/eth"), j("/api/erc20"), j("/api/btc"), j("/api/sol")
  ]);

  return new Response(JSON.stringify({ minUsd, eth, erc20, btc, sol }), {
    headers: { "content-type": "application
