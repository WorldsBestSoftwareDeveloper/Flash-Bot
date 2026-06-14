import { FlashV2Client } from "flash-v2";
import type { MarketSnapshot } from "./types";

let tick = 0;
let solPrice = 146.82;
let btcPrice = 104620;
const flash = new FlashV2Client();
const liveHistory: Array<{ timestamp: number; sol: number; btc: number }> = [];

export function getMarketData(previous?: MarketSnapshot): MarketSnapshot {
  tick += 1;
  const cycle = Math.sin(tick / 3.2);
  const micro = Math.sin(tick * 1.73) * 0.16;
  // Deterministic fallback impulse keeps paper mode lively without random or
  // scripted trades.
  const solMomentum = cycle * 1.18 + micro + (tick % 4 === 0 ? 1 : 0);
  const btcMomentum = Math.sin(tick / 5.1) * 0.38 + Math.cos(tick * 0.7) * 0.09;

  solPrice = Math.max(50, solPrice * (1 + solMomentum / 850));
  btcPrice = Math.max(10000, btcPrice * (1 + btcMomentum / 1150));

  return {
    timestamp: Date.now(),
    solPrice,
    btcPrice,
    solPriceChange1m: Number((previous ? solMomentum : 1.72).toFixed(2)),
    btcPriceChange1m: Number((previous ? btcMomentum : -0.18).toFixed(2)),
    volatilityIndex: Number((48 + Math.abs(Math.sin(tick / 4)) * 21 + (tick % 29 === 0 ? 12 : 0)).toFixed(1)),
    solBtcCorrelation: Number((0.66 + Math.abs(Math.sin(tick / 7)) * 0.26).toFixed(2)),
    source: "simulation",
  };
}

function percentChange(current: number, previous: number) {
  return previous ? ((current - previous) / previous) * 100 : 0;
}

function correlation(xs: number[], ys: number[]) {
  if (xs.length < 3 || xs.length !== ys.length) return 0.7;
  const avgX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const avgY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0, dx = 0, dy = 0;
  xs.forEach((x, index) => {
    const a = x - avgX;
    const b = (ys[index] ?? avgY) - avgY;
    numerator += a * b; dx += a * a; dy += b * b;
  });
  return dx && dy ? numerator / Math.sqrt(dx * dy) : 0.7;
}

export async function getLiveMarketData(previous?: MarketSnapshot): Promise<MarketSnapshot> {
  try {
    const prices = await flash.prices();
    const sol = prices.SOL?.priceUi;
    const btc = prices.BTC?.priceUi;
    if (!sol || !btc) throw new Error("SOL/BTC unavailable from Flash price API");
    const now = Date.now();
    liveHistory.push({ timestamp: now, sol, btc });
    while (liveHistory[0] && liveHistory[0].timestamp < now - 65_000) liveHistory.shift();
    const baseline = liveHistory[0] ?? { sol: previous?.solPrice ?? sol, btc: previous?.btcPrice ?? btc };
    const solReturns = liveHistory.slice(1).map((point, index) => percentChange(point.sol, liveHistory[index]?.sol ?? point.sol));
    const btcReturns = liveHistory.slice(1).map((point, index) => percentChange(point.btc, liveHistory[index]?.btc ?? point.btc));
    const volatility = solReturns.length
      ? Math.min(100, 35 + Math.sqrt(solReturns.reduce((sum, value) => sum + value ** 2, 0) / solReturns.length) * 150)
      : 45;
    return {
      timestamp: now,
      solPrice: sol,
      btcPrice: btc,
      solPriceChange1m: Number(percentChange(sol, baseline.sol).toFixed(2)),
      btcPriceChange1m: Number(percentChange(btc, baseline.btc).toFixed(2)),
      volatilityIndex: Number(volatility.toFixed(1)),
      solBtcCorrelation: Number(correlation(solReturns, btcReturns).toFixed(2)),
      source: "flash",
    };
  } catch {
    return getMarketData(previous);
  }
}
