export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const n = (x) => Number(x || 0);
export const niceUsd = (x) =>
  `$${n(x).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
