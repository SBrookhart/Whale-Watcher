import { useEffect, useState } from "react";
import { loadSettings, saveSettings } from "../lib/storage";

export default function SettingsDrawer({ open, onClose, onApply }) {
  const [s, setS] = useState(loadSettings());

  useEffect(() => {
    if (open) setS(loadSettings());
  }, [open]);

  function Row({ label, children }) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div>{children}</div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
      display: "flex", justifyContent: "flex-end", zIndex: 50
    }}>
      <div style={{
        width: 420, maxWidth: "100%", background: "#fff", height: "100%",
        padding: 20, boxShadow: "0 0 30px rgba(0,0,0,0.15)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Settings</h2>
          <button onClick={onClose} style={{ border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 8 }}>Close</button>
        </div>

        <h3 style={{ marginTop: 8, marginBottom: 8 }}>Chains</h3>
        <Row label="Ethereum (ETH)">
          <input type="checkbox" checked={s.enableETH} onChange={e=>setS({...s, enableETH: e.target.checked})}/>
        </Row>
        <Row label="Ethereum ERC-20 (USDC/USDT)">
          <input type="checkbox" checked={s.enableERC20} onChange={e=>setS({...s, enableERC20: e.target.checked})}/>
        </Row>
        <Row label="Bitcoin">
          <input type="checkbox" checked={s.enableBTC} onChange={e=>setS({...s, enableBTC: e.target.checked})}/>
        </Row>
        <Row label="Solana">
          <input type="checkbox" checked={s.enableSOL} onChange={e=>setS({...s, enableSOL: e.target.checked})}/>
        </Row>

        <Row label="Solana stablecoin-only (USDC)">
          <input type="checkbox" checked={s.solStablecoinOnly} onChange={e=>setS({...s, solStablecoinOnly: e.target.checked})}/>
        </Row>
        <div style={{ color:"#6b7280", fontSize: 12, marginBottom: 12 }}>
          Note: stablecoin-only mode for Solana requires an indexer (Helius/Solscan Pro). This prototype returns no items when enabled.
        </div>

        <h3 style={{ marginTop: 16, marginBottom: 8 }}>Thresholds</h3>
        <Row label="Minimum USD size">
          <input type="number" value={s.minUsd} onChange={e=>setS({...s, minUsd: Number(e.target.value||0)})}
                 style={{ width: 160, padding: 8, borderRadius: 8, border: "1px solid #e5e7eb" }}/>
        </Row>

        <h3 style={{ marginTop: 16, marginBottom: 8 }}>Alerts</h3>
        <Row label="Enable whale alerts">
          <input type="checkbox" checked={s.alertEnabled} onChange={e=>setS({...s, alertEnabled: e.target.checked})}/>
        </Row>
        <Row label="Alert USD threshold">
          <input type="number" value={s.alertUsd} onChange={e=>setS({...s, alertUsd: Number(e.target.value||0)})}
                 style={{ width: 160, padding: 8, borderRadius: 8, border: "1px solid #e5e7eb" }}/>
        </Row>
        <Row label="Webhook URL">
          <input type="text" value={s.alertWebhook} onChange={e=>setS({...s, alertWebhook: e.target.value})}
                 placeholder="https://hooks.slack.com/... or https://discord.com/api/webhooks/..."
                 style={{ width: 240, padding: 8, borderRadius: 8, border: "1px solid #e5e7eb" }}/>
        </Row>
        <div style={{ color:"#6b7280", fontSize: 12, marginBottom: 12 }}>
          Paste a webhook (Slack, Discord, Zapier, IFTTT, your endpoint). We’ll POST JSON when a transfer ≥ threshold appears.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={() => { saveSettings(s); onApply(s); }}
                  style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#111827", color: "#fff", fontWeight: 600 }}>
            Save & Apply
          </button>
          <button onClick={() => { const d = { ...loadSettings() }; setS(d); }}
                  style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff" }}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
