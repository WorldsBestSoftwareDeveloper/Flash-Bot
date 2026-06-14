export type Asset = "SOL" | "BTC";
export type Side = "LONG" | "SHORT";
export type ExecutionMode = "paper" | "live";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type SignalAction = "LONG_SOL" | "SHORT_SOL" | "HEDGE_BTC_SHORT" | "EXIT_SOL" | "HOLD";

export interface MarketSnapshot {
  timestamp: number;
  solPrice: number;
  btcPrice: number;
  solPriceChange1m: number;
  btcPriceChange1m: number;
  volatilityIndex: number;
  solBtcCorrelation: number;
  source: "flash" | "simulation";
}

export interface TradingSignal {
  id: string;
  timestamp: number;
  action: SignalAction;
  confidence: number;
  reason: string;
  risk: RiskLevel;
}

export interface Position {
  id: string;
  asset: Asset;
  side: Side;
  sizeUsd: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  isHedge: boolean;
  openedAt: number;
}

export interface Trade {
  id: string;
  timestamp: number;
  asset: Asset;
  side: Side;
  sizeUsd: number;
  entryPrice: number;
  exitPrice?: number;
  pnl: number;
  status: "OPEN" | "CLOSED";
  source: "SIGNAL" | "HEDGE" | "EXIT";
  txSignature?: string;
}

export interface LogEvent {
  id: string;
  timestamp: number;
  type: "SYSTEM" | "SIGNAL" | "EXECUTED" | "HEDGE" | "PNL" | "EXIT" | "WARNING";
  message: string;
  detail?: string;
  tone: "cyan" | "green" | "purple" | "red" | "muted";
}

export interface Metrics {
  totalPnL: number;
  winRate: number;
  signalAccuracy: number;
  drawdown: number;
  completedTrades: number;
}

export interface PricePoint {
  timestamp: number;
  sol: number;
  btc: number;
}

export interface AppState {
  agentActive: boolean;
  mode: ExecutionMode;
  walletAddress: string | null;
  sessionReady: boolean;
  basketReady: boolean;
  marketDataLive: boolean;
  liveStatus: string;
  tradeCollateralUsd: number;
  leverage: number;
  market: MarketSnapshot;
  priceHistory: PricePoint[];
  currentSignal: TradingSignal | null;
  positions: Position[];
  trades: Trade[];
  logs: LogEvent[];
  metrics: Metrics;
  balance: number;
  peakEquity: number;
}
