import type { Position } from "./types";

export const HEDGE_RATIO = 0.2;

export function calculateHedgeSize(position: Position): number {
  return Number((position.sizeUsd * HEDGE_RATIO).toFixed(2));
}

export function shouldReduceSolExposure(positions: Position[]): boolean {
  const btcExposure = positions.filter((position) => position.asset === "BTC").reduce((sum, position) => sum + position.sizeUsd, 0);
  const solExposure = positions.filter((position) => position.asset === "SOL").reduce((sum, position) => sum + position.sizeUsd, 0);
  return btcExposure > solExposure * 0.35;
}
