export function getEnv() {
  return {
    ALCHEMY_ETH_MAINNET_KEY: process.env.ALCHEMY_ETH_MAINNET_KEY || "",
    HELIUS_API_KEY: process.env.HELIUS_API_KEY || "",
  };
}

export function hasAlchemy() {
  return !!process.env.ALCHEMY_ETH_MAINNET_KEY;
}

export function hasHelius() {
  return !!process.env.HELIUS_API_KEY;
}
