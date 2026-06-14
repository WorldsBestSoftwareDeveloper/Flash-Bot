import type { MarketSnapshot, Position, TradingSignal } from "./types";

const HIGH_VOLATILITY = 72;

function signal(action: TradingSignal["action"], confidence: number, reason: string, risk: TradingSignal["risk"]): TradingSignal {
  return { id: crypto.randomUUID(), timestamp: Date.now(), action, confidence, reason, risk };
}

export function rulesEngine(market: MarketSnapshot, positions: Position[]): TradingSignal | null {
  const solPosition = positions.find((position) => position.asset === "SOL" && !position.isHedge);
  const hedge = positions.find((position) => position.isHedge);

  if (solPosition) {
    if (solPosition.pnlPercent >= 3) {
      return signal("EXIT_SOL", 94, "Profit target reached above +3.0%", "LOW");
    }
    if (market.volatilityIndex >= HIGH_VOLATILITY) {
      return signal("EXIT_SOL", 91, "Volatility spike breached risk threshold", "HIGH");
    }
    if (solPosition.side === "LONG" && market.solPriceChange1m < -0.8) {
      return signal("EXIT_SOL", 86, "SOL momentum reversed against the active long", "HIGH");
    }
    if (!hedge && solPosition.side === "LONG" && market.solBtcCorrelation > 0.78) {
      return signal("HEDGE_BTC_SHORT", 84, "High SOL/BTC correlation triggered defensive hedge", "MEDIUM");
    }
    return null;
  }

  if (market.solPriceChange1m > 1.5 && market.btcPriceChange1m < 0.5 && market.volatilityIndex < HIGH_VOLATILITY) {
    return signal("LONG_SOL", 80, "SOL momentum strong, BTC lagging, volatility stable", "MEDIUM");
  }

  if (market.solPriceChange1m < -1.45 && market.btcPriceChange1m > -0.4 && market.volatilityIndex < HIGH_VOLATILITY) {
    return signal("SHORT_SOL", 78, "SOL downside momentum confirmed while BTC remains resilient", "MEDIUM");
  }

  return null;
}
