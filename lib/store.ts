"use client";

import { getMarketData } from "./marketData";
import type { AppState, LogEvent, MarketSnapshot, Position, Trade, TradingSignal } from "./types";

const initialMarket = getMarketData();
let state: AppState = {
  agentActive: false,
  mode: "paper",
  walletAddress: null,
  sessionReady: false,
  basketReady: false,
  marketDataLive: false,
  liveStatus: "Wallet not connected",
  tradeCollateralUsd: 15,
  leverage: 5,
  market: initialMarket,
  priceHistory: Array.from({ length: 36 }, (_, index) => ({
    timestamp: Date.now() - (35 - index) * 2500,
    sol: initialMarket.solPrice * (0.992 + Math.sin(index / 4) * 0.004 + index * 0.0002),
    btc: initialMarket.btcPrice * (0.996 + Math.cos(index / 5) * 0.002 + index * 0.00008),
  })),
  currentSignal: {
    id: "boot-signal",
    timestamp: Date.now(),
    action: "LONG_SOL",
    confidence: 80,
    reason: "SOL momentum strong, BTC lagging, volatility stable",
    risk: "MEDIUM",
  },
  positions: [],
  trades: [],
  logs: [
    event("SYSTEM", "Flash Bot intelligence layer ready", "Flash/Pyth stream connecting with simulation fallback", "cyan"),
    event("SYSTEM", "Session key authority standing by", "Paper execution is default", "purple"),
  ],
  metrics: { totalPnL: 0, winRate: 0, signalAccuracy: 0, drawdown: 0, completedTrades: 0 },
  balance: 10000,
  peakEquity: 10000,
};

const listeners = new Set<() => void>();

function event(type: LogEvent["type"], message: string, detail: string, tone: LogEvent["tone"]): LogEvent {
  return { id: crypto.randomUUID(), timestamp: Date.now(), type, message, detail, tone };
}

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(updater: (current: AppState) => AppState) {
  state = updater(state);
  emit();
}

export const store = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => state,
  setAgentActive(active: boolean) {
    if (active && state.mode === "live") {
      const freshOracle = state.marketDataLive && state.market.source === "flash" && Date.now() - state.market.timestamp < 10_000;
      if (!state.walletAddress || !state.sessionReady || !state.basketReady || !freshOracle) {
        setState((current) => ({
          ...current,
          agentActive: false,
          logs: [event("WARNING", "Live agent start blocked", "Requires connected wallet, session, basket, and a fresh Flash/Pyth oracle tick", "red"), ...current.logs].slice(0, 30),
        }));
        return;
      }
    }
    setState((current) => ({
      ...current,
      agentActive: active,
      logs: [event("SYSTEM", active ? "Autonomous agent started" : "Autonomous agent paused", active ? "Scanning market every 2.5 seconds" : "Positions remain monitored", active ? "green" : "muted"), ...current.logs].slice(0, 30),
    }));
  },
  setMode(mode: AppState["mode"]) {
    setState((current) => ({
      ...current,
      mode,
      logs: [event("SYSTEM", `${mode === "paper" ? "Paper" : "Live"} execution mode selected`, mode === "live" ? "Wallet and session key required" : "Trades settle locally with zero cost", mode === "live" ? "purple" : "cyan"), ...current.logs].slice(0, 30),
    }));
  },
  setTradeCollateral(amount: number) {
    setState((current) => ({ ...current, tradeCollateralUsd: Math.max(12, Math.min(100, amount)) }));
  },
  setWallet(walletAddress: string | null) {
    setState((current) => ({ ...current, walletAddress, liveStatus: walletAddress ? "Wallet connected; setup required" : "Wallet not connected" }));
  },
  setLiveReadiness(sessionReady: boolean, basketReady: boolean, liveStatus: string) {
    setState((current) => ({ ...current, sessionReady, basketReady, liveStatus }));
  },
  addLog(type: LogEvent["type"], message: string, detail: string, tone: LogEvent["tone"]) {
    setState((current) => ({ ...current, logs: [event(type, message, detail, tone), ...current.logs].slice(0, 30) }));
  },
  updateMarket(market: MarketSnapshot) {
    setState((current) => {
      const positions = current.positions.map((position) => {
        const currentPrice = position.asset === "SOL" ? market.solPrice : market.btcPrice;
        const direction = position.side === "LONG" ? 1 : -1;
        const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * direction;
        return { ...position, currentPrice, pnlPercent, pnl: position.sizeUsd * (pnlPercent / 100) };
      });
      const unrealized = positions.reduce((sum, position) => sum + position.pnl, 0);
      const realized = current.trades.filter((trade) => trade.status === "CLOSED").reduce((sum, trade) => sum + trade.pnl, 0);
      const equity = current.balance + unrealized;
      const peakEquity = Math.max(current.peakEquity, equity);
      const drawdown = peakEquity ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      return {
        ...current,
        market,
        marketDataLive: market.source === "flash",
        positions,
        peakEquity,
        priceHistory: [...current.priceHistory, { timestamp: market.timestamp, sol: market.solPrice, btc: market.btcPrice }].slice(-64),
        metrics: { ...current.metrics, totalPnL: realized + unrealized, drawdown },
      };
    });
  },
  setSignal(signal: TradingSignal) {
    setState((current) => ({
      ...current,
      currentSignal: signal,
      logs: [event("SIGNAL", signal.action.replaceAll("_", " "), `${signal.confidence}% confidence · ${signal.reason}`, "cyan"), ...current.logs].slice(0, 30),
    }));
  },
  openPosition(position: Position, trade: Trade) {
    setState((current) => ({
      ...current,
      positions: [...current.positions, position],
      trades: [trade, ...current.trades],
      logs: [event(position.isHedge ? "HEDGE" : "EXECUTED", `${position.side} ${position.asset} opened`, `$${position.sizeUsd.toFixed(0)} notional @ $${position.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, position.isHedge ? "purple" : "green"), ...current.logs].slice(0, 30),
    }));
  },
  syncPositions(positions: Position[]) {
    setState((current) => ({ ...current, positions }));
  },
  closeSolPositions() {
    setState((current) => {
      const closing = current.positions;
      const realizedPnl = closing.reduce((sum, position) => sum + position.pnl, 0);
      const closedIds = new Set(closing.map((position) => position.id));
      const trades = current.trades.map((trade) => {
        const position = closing.find((item) => item.id === trade.id);
        return position ? { ...trade, status: "CLOSED" as const, exitPrice: position.currentPrice, pnl: position.pnl } : trade;
      });
      const completed = trades.filter((trade) => trade.status === "CLOSED");
      const wins = completed.filter((trade) => trade.pnl > 0).length;
      return {
        ...current,
        positions: current.positions.filter((position) => !closedIds.has(position.id)),
        trades,
        balance: current.balance + realizedPnl,
        logs: [event("EXIT", "Portfolio positions closed", `${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)} realized PnL`, realizedPnl >= 0 ? "green" : "red"), ...current.logs].slice(0, 30),
        metrics: {
          ...current.metrics,
          completedTrades: completed.length,
          winRate: completed.length ? (wins / completed.length) * 100 : 0,
          signalAccuracy: completed.length ? (wins / completed.length) * 100 : 0,
        },
      };
    });
  },
};
