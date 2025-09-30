const KEY = "whale_watcher_settings_v1";

export function loadSettings() {
  if (typeof window === "undefined") return defaultSettings();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...defaultSettings(), ...s };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function defaultSettings() {
  return {
    enableETH: true,
    enableERC20: true,
    enableBTC: true,
    enableSOL: true,
    solStablecoinOnly: false, // needs indexer when true
    // Friendlier default so users see data immediately
    minUsd: 25000,
    alertEnabled: true,
    alertUsd: 10000000,
    alertWebhook: "" // paste Slack/Discord/Zapier/IFTTT webhook URL
  };
}

const ALERT_KEY = "whale_watcher_alerted_hashes";
export function loadAlerted() {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(ALERT_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function saveAlerted(set) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ALERT_KEY, JSON.stringify([...set]));
}
