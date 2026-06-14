import { FlashV2Client, type NetworkConfig } from "flash-v2";

function publicNetworkOverrides(): Partial<NetworkConfig> {
  const config: Partial<NetworkConfig> = {};
  const apiBase = process.env.NEXT_PUBLIC_FLASH_API_BASE;
  const erRpc = process.env.NEXT_PUBLIC_ER_RPC;
  const baseRpc = process.env.NEXT_PUBLIC_BASE_RPC;
  if (apiBase) config.apiBase = apiBase.replace(/\/$/, "");
  if (erRpc) config.erRpc = erRpc;
  if (baseRpc) config.baseRpc = baseRpc;
  return config;
}

export const flash = new FlashV2Client(publicNetworkOverrides());
