import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchUsdPrices } from "../lib/usd";
import { niceUsd, short } from "../lib/format";
import SettingsDrawer from "../components/SettingsDrawer";
import { loadSettings, saveSettings, loadAlerted, saveAlerted } from "../lib/storage";

const qc = new QueryClient();

function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: fetchUsdPrices,
    refetchInterval: 30000,
  });
}

async function fetchJSON(u) {
  const r = await fetch(u);
  if (!r.ok) return { items: [] };
  return r.json();
}

async function loadAll(settings, prices) {
  const p = new URLSearchParams({
    minUsd: String(settings.minUsd),
    usdEth: String(prices.ETH),
    usdUSDC: String(prices.USDC),
    usdUSDT: String(prices.USDT),
    usdBtc: String(prices.BTC),
    usdSol: String(prices.SOL),
  });

  const promises = [];
  if (settings.enableETH) promises.push(fetchJSON(`/api/eth?${p}`));
  if (settings.enableERC20) promises.push(fetchJSON(`/api/erc20?${p}`));
  if (settings.enableBTC) promises.push(fetchJSON(`/api/btc?${p}`));
  if (settings.enableSOL) {
    const params = new URLSearchParams(p);
    if (settings.solStablecoinOnly) params.set("stableOnly", "1");
    promises.push(fetchJSON(`/api/sol?${params.toString()}`));
  }

  const results = await Promise.all(promises.length ? promises : [Promise.resolve({ items: [] })]);
  const merged = results.flatMap((r) => r.items || []);
  return merged.sort((x, y) => y.usd - x.usd).slice(0, 50);
}

async function postWebhook(url, payload) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort; ignore
  }
}

function Leaderboard() {
  const { data: prices, isLoading } = usePrices();
  const [settings, setSettings] = useState(loadSettings());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Alerts: track hashes we've already alerted on
  const [alerted, setAlerted] = useState(loadAlerted());

  function applySettings(s) {
    saveSettings(s);
    setSettings(s);
    refresh(s);
  }

  async function refresh(s = settings) {
    if (!prices) return;
    setLoading(true);
    try {
      const items = await loadAll(s, prices);
      setRows(items);

      // Whale alerts
      if (s.alertEnabled && s.alertWebhook) {
        const newbies = items.filter((it) => it.usd >= s.alertUsd && !alerted.has(it.hash));
        if (newbies.length) {
          for (const it of newbies) {
            const payload = {
              event: "whale_transfer",
              chain: it.chain,
              asset: it.kind,
              amount: it.amount,
              usd: it.usd,
              from: it.from,
              to: it.to,
              hash: it.hash,
              url:
                it.chain === "ethereum"
                  ? `https://etherscan.io/tx/${it.hash}`
                  : it.chain === "bitcoin"
                  ? `https://mempool.space/tx/${it.hash}`
                  : `https://explorer.solana.com/tx/${it.hash}`,
              ts: it.ts,
              threshold: s.alertUsd,
            };
            await postWebhook(s.alertWebhook, payload);
            alerted.add(it.hash);
          }
          saveAlerted(alerted);
          setAlerted(new Set(alerted)); // force re-render
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setInterval(() => refresh(), 45000);
    return () => clearInterval(t);
  }, [prices, settings]);

  if (isLoading) return <div style={{ padding: 24 }}>Loading prices…</div>;

  return (
    <div style={{ maxWidth: 1040, margin: "40px auto", padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>🐋 Whale Watcher Leaderboard</h1>
          <p style={{ color: "#6b7280", margin: 0 }}>
            Large transfers across Ethereum (ETH, USDC, USDT), Bitcoin, and Solana. Public endpoints only. View-only.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setDrawerOpen(true)}
            style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff" }}
          >
            ⚙️ Settings
          </button>
          <button
            onClick={() => refresh()}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#111827",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <Badge on={settings.enableETH}>ETH</Badge>
        <Badge on={settings.enableERC20}>USDC/USDT (ERC-20)</Badge>
        <Badge on={settings.enableBTC}>BTC</Badge>
        <Badge on={settings.enableSOL}>SOL</Badge>
        {settings.enableSOL && settings.solStablecoinOnly && (
          <span style={{ fontSize: 12, color: "#dc2626" }}>
            Solana stablecoin-only mode needs an indexer (no items shown).
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #f3f4f6", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "10px 8px" }}>#</th>
              <th style={{ padding: "10px 8px" }}>Chain</th>
              <th style={{ padding: "10px 8px" }}>Asset</th>
              <th style={{ padding: "10px 8px" }}>Amount</th>
              <th style={{ padding: "10px 8px" }}>USD</th>
              <th style={{ padding: "10px 8px" }}>From → To</th>
              <th style={{ padding: "10px 8px" }}>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.hash + i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 8px" }}>{i + 1}</td>
                <td style={{ padding: "10px 8px", textTransform: "capitalize" }}>{r.chain}</td>
                <td style={{ padding: "10px 8px" }}>{r.kind}</td>
                <td style={{ padding: "10px 8px" }}>
                  {typeof r.amount === "number"
                    ? r.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })
                    : r.amount}
                </td>
                <td style={{ padding: "10px 8px", fontWeight: 700 }}>{niceUsd(r.usd)}</td>
                <td style={{ padding: "10px 8px", color: "#6b7280" }}>
                  {short(r.from)} → {short(r.to)}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  {r.chain === "ethereum" ? (
                    <a href={`https://etherscan.io/tx/${r.hash}`} target="_blank" rel="noreferrer">
                      Etherscan ↗
                    </a>
                  ) : r.chain === "bitcoin" ? (
                    <a href={`https://mempool.space/tx/${r.hash}`} target="_blank" rel="noreferrer">
                      mempool.space ↗
                    </a>
                  ) : (
                    <a href={`https://explorer.solana.com/tx/${r.hash}`} target="_blank" rel="noreferrer">
                      Solana Explorer ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: "#6b7280" }}>
                  No whales found in the last window. Adjust Settings → lower the USD threshold or enable more chains.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <hr style={{ margin: "24px 0", borderColor: "#e5e7eb" }} />
      <small style={{ color: "#6b7280" }}>
        Prototype. Data is sampled from recent blocks / mempool. For deeper coverage, plug in indexers (Alchemy/Helius/Goldsky).
      </small>

      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onApply={(s) => {
          setDrawerOpen(false);
          applySettings(s);
        }}
      />
    </div>
  );
}

function Badge({ children, on }) {
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: on ? "#eef2ff" : "#f9fafb",
        color: on ? "#3730a3" : "#6b7280",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export default function Page() {
  return (
    <QueryClientProvider client={qc}>
      <Leaderboard />
    </QueryClientProvider>
  );
}
