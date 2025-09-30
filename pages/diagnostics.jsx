import { useEffect, useState } from "react";

export default function Diagnostics() {
  const [j, setJ] = useState(null);

  useEffect(() => {
    fetch("/api/health").then(r=>r.json()).then(setJ).catch(()=>setJ({ error: "fetch_failed" }));
  }, []);

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: 20, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1>🔎 Diagnostics</h1>
      <p>Quick sanity checks for environment keys and price feeds.</p>
      <pre style={{ background:"#f8fafc", padding:16, borderRadius:12, overflowX:"auto" }}>
        {JSON.stringify(j, null, 2)}
      </pre>
      <p style={{ color:"#6b7280" }}>
        If ALCHEMY or HELIUS is false, add keys in Vercel → Settings → Environment Variables and redeploy.
      </p>
    </div>
  );
}
