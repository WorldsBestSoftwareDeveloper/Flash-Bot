"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, CircleDollarSign, Crosshair,
  Gauge, Link2, Pause, Play, Radio, ShieldCheck, Sparkles, Wallet, Zap,
} from "lucide-react";
import { startAgentLoop, stopAgentLoop } from "@/lib/agent";
import { closePosition } from "@/lib/executor";
import { connectLiveWallet, depositUsdc, disableLiveTrading, executeUsdcWithdrawal, requestUsdcWithdrawal, setupLiveTrading } from "@/lib/live";
import { store } from "@/lib/store";
import type { LogEvent, Position } from "@/lib/types";
import { MarketChart, type ChartMode, type ChartTimeframe } from "./MarketChart";

const noopSubscribe = () => () => undefined;

function fmtUsd(value: number, digits = 2) {
  return `${value >= 0 ? "" : "-"}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function MiniMetric({ label, value, detail, tone = "cyan" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="metric">
      <span className="eyebrow">{label}</span>
      <strong className={`metric-value ${tone}`}>{value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function PositionCard({ position }: { position: Position }) {
  const positive = position.pnl >= 0;
  return (
    <article className="position-card">
      <div className="position-top">
        <div className={`asset-mark ${position.asset.toLowerCase()}`}>{position.asset.slice(0, 1)}</div>
        <div><strong>{position.asset}-PERP</strong><span>{position.isHedge ? "CORRELATION HEDGE" : "PRIMARY POSITION"}</span></div>
        <span className={`side ${position.side.toLowerCase()}`}>{position.side}</span>
      </div>
      <div className="position-grid">
        <div><span>ENTRY</span><b>${position.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
        <div><span>SIZE</span><b>${position.sizeUsd.toLocaleString()}</b></div>
        <div><span>LIVE PNL</span><b className={positive ? "green" : "red"}>{positive ? "+" : ""}{position.pnlPercent.toFixed(2)}%</b></div>
      </div>
      <div className="exposure-track"><i style={{ width: position.isHedge ? "20%" : "76%" }} /></div>
    </article>
  );
}

function ExecutionRow({ item }: { item: LogEvent }) {
  return (
    <div className="execution-row">
      <span className="log-time">{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <span className={`log-type ${item.tone}`}>{item.type}</span>
      <span className="log-message">{item.message}<small>{item.detail}</small></span>
      <span className={`log-dot ${item.tone}`} />
    </div>
  );
}

export function TradingDashboard() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [depositAmount, setDepositAmount] = useState("30");
  const [withdrawAmount, setWithdrawAmount] = useState("12");
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("1m");

  useEffect(() => {
    startAgentLoop();
    return stopAgentLoop;
  }, []);

  async function connectWallet() {
    try {
      await connectLiveWallet();
    } catch (error) {
      store.addLog("WARNING", "Wallet connection failed", error instanceof Error ? error.message : String(error), "red");
    }
  }

  async function activateLive() {
    try {
      await setupLiveTrading();
    } catch (error) {
      store.addLog("WARNING", "Live setup stopped", error instanceof Error ? error.message : String(error), "red");
    }
  }

  async function revokeLive() {
    try {
      await disableLiveTrading();
    } catch (error) {
      store.addLog("WARNING", "Session revoke failed", error instanceof Error ? error.message : String(error), "red");
    }
  }

  async function fundBasket() {
    try {
      await depositUsdc(Number(depositAmount));
    } catch (error) {
      store.addLog("WARNING", "Deposit stopped", error instanceof Error ? error.message : String(error), "red");
    }
  }

  async function withdrawBasket() {
    try {
      await requestUsdcWithdrawal(Number(withdrawAmount));
    } catch (error) {
      store.addLog("WARNING", "Withdrawal request stopped", error instanceof Error ? error.message : String(error), "red");
    }
  }

  async function executeWithdrawal() {
    try {
      await executeUsdcWithdrawal();
    } catch {
      store.addLog("WARNING", "Withdrawal execution pending", "Settlement may need 30–90 seconds before retrying", "purple");
    }
  }

  async function emergencyClose() {
    store.setAgentActive(false);
    try {
      await closePosition();
    } catch (error) {
      store.addLog("WARNING", "Close all failed", error instanceof Error ? error.message : String(error), "red");
    }
  }

  const signal = state.currentSignal;
  const solMove = state.market.solPriceChange1m;
  const btcMove = state.market.btcPriceChange1m;

  return (
    <main className="terminal-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar glass">
        <div className="brand">
          <div className="logo"><Zap size={19} fill="currentColor" /></div>
          <div><strong>FLASH <span>BOT</span></strong><small>AUTONOMOUS PERPETUAL INTELLIGENCE</small></div>
          <div className="version">MAGICBLOCK × FLASH TRADE V2</div>
        </div>
        <div className="top-actions">
          <div className="mode-toggle">
            <button className={state.mode === "paper" ? "active" : ""} onClick={() => store.setMode("paper")}>PAPER</button>
            <button className={state.mode === "live" ? "active live" : ""} onClick={() => store.setMode("live")}>LIVE</button>
          </div>
          <button className="wallet-button" onClick={() => void connectWallet()}><Wallet size={15} />{state.walletAddress ?? "CONNECT WALLET"}</button>
          {state.walletAddress && !state.sessionReady ? <button className="wallet-button setup-button" onClick={() => void activateLive()}><ShieldCheck size={15} />SETUP LIVE</button> : null}
          {state.sessionReady ? <button className="wallet-button revoke-button" onClick={() => void revokeLive()}>REVOKE SESSION</button> : null}
          <button className={`agent-button ${state.agentActive ? "stop" : ""}`} onClick={() => store.setAgentActive(!state.agentActive)}>
            {state.agentActive ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            {state.agentActive ? "STOP AGENT" : "START AGENT"}
          </button>
        </div>
      </header>

      <section className="market-strip glass">
        <div className="market-pair"><div className="asset-mark sol">S</div><div><span>SOL / USD</span><strong>${state.market.solPrice.toFixed(2)}</strong></div><em className={solMove >= 0 ? "green" : "red"}>{solMove >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{solMove.toFixed(2)}%</em></div>
        <div className="market-pair"><div className="asset-mark btc">B</div><div><span>BTC / USD</span><strong>${state.market.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div><em className={btcMove >= 0 ? "green" : "red"}>{btcMove >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{btcMove.toFixed(2)}%</em></div>
          <div className="stream-health"><Radio size={14} /><span>MARKET STREAM</span><b>{state.marketDataLive ? "FLASH LIVE" : "SIMULATION"}</b></div>
        <div className="stream-health"><Link2 size={14} /><span>LIVE EXECUTION</span><b className={state.sessionReady && state.basketReady ? "green" : "purple"}>{state.sessionReady && state.basketReady ? "READY" : "LOCKED"}</b></div>
      </section>

      <section className="dashboard-grid">
        <aside className="left-stack">
          <section className="panel glass agent-panel">
            <div className="panel-heading"><span><Bot size={15} /> AGENT CONTROL</span><span className={`status ${state.agentActive ? "active" : ""}`}><i />{state.agentActive ? "ACTIVE AGENT" : "STANDBY"}</span></div>
            <div className="agent-orb"><div><Sparkles size={22} /><strong>{state.agentActive ? "SCANNING" : "READY"}</strong><span>{state.agentActive ? "Analyzing spread delta" : "Awaiting command"}</span></div></div>
            <div className="scan-row"><span>LOOP INTERVAL</span><b>2.5 SEC</b></div>
            <div className="scan-row"><span>EXECUTION ROUTE</span><b>{state.mode === "paper" ? "SIMULATED" : "FLASH V2 / ER"}</b></div>
            <div className="scan-row"><span>SESSION AUTH</span><b className={state.sessionReady ? "green" : "purple"}>{state.sessionReady ? "AUTHORIZED" : "ARMED"}</b></div>
            <div className="scan-row"><span>LIVE STATUS</span><b className={state.sessionReady && state.basketReady ? "green" : "purple"}>{state.liveStatus}</b></div>
            <div className="sizing-control">
              <label>TRADE COLLATERAL <b>{state.tradeCollateralUsd.toFixed(0)} USDC</b></label>
              <input type="range" min="12" max="100" step="1" value={state.tradeCollateralUsd} onChange={(event) => store.setTradeCollateral(Number(event.target.value))} />
              <span>{state.leverage}× leverage · ${(state.tradeCollateralUsd * state.leverage).toFixed(0)} notional</span>
            </div>
            {state.basketReady ? <div className="fund-controls">
              <div className="deposit-control"><input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} inputMode="decimal" /><button onClick={() => void fundBasket()}>DEPOSIT USDC</button></div>
              <div className="deposit-control withdraw"><input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} inputMode="decimal" /><button onClick={() => void withdrawBasket()}>WITHDRAW USDC</button></div>
              <button className="execute-withdrawal" onClick={() => void executeWithdrawal()}>EXECUTE / RECOVER PENDING WITHDRAWAL</button>
            </div> : null}
          </section>

          <section className="panel glass signal-panel">
            <div className="panel-heading"><span><Crosshair size={15} /> CURRENT SIGNAL</span><span className="timestamp">NOW</span></div>
            <div className="signal-main">
              <div><span>ACTION</span><strong>{signal?.action.replaceAll("_", " ") ?? "MONITORING"}</strong></div>
              <div className="confidence-ring" style={{ "--score": `${signal?.confidence ?? 0}%` } as React.CSSProperties}><span>{signal?.confidence ?? 0}<small>%</small></span></div>
            </div>
            <p>{signal?.reason ?? "Market conditions are inside neutral thresholds."}</p>
            <div className="risk-line"><span>RISK PROFILE</span><div><i /><i /><i className={signal?.risk === "HIGH" ? "hot" : ""} /></div><b>{signal?.risk ?? "LOW"}</b></div>
          </section>
        </aside>

        <section className="center-stack">
          <section className="panel glass chart-panel">
            <div className="chart-header">
              <div><span className="eyebrow">REAL-TIME PRICE ACTION</span><h1>SOL <span>PERPETUAL</span></h1></div>
              <div className="chart-legend"><span><i className="sol-line" /> SOL</span><span><i className="btc-line" /> BTC OVERLAY</span><button className={chartMode === "line" ? "selected" : ""} onClick={() => setChartMode("line")}>LINE</button><button className={chartMode === "candles" ? "selected" : ""} onClick={() => setChartMode("candles")}>CANDLES</button><button className={chartTimeframe === "1m" ? "selected" : ""} onClick={() => setChartTimeframe("1m")}>1M</button><button className={chartTimeframe === "5m" ? "selected" : ""} onClick={() => setChartTimeframe("5m")}>5M</button></div>
            </div>
            <MarketChart points={state.priceHistory} mode={chartMode} timeframe={chartTimeframe} />
            <div className="chart-stats">
              <div><span>SOL MOMENTUM</span><b className={solMove >= 0 ? "green" : "red"}>{solMove >= 0 ? "+" : ""}{solMove.toFixed(2)}%</b></div>
              <div><span>BTC MOMENTUM</span><b className={btcMove >= 0 ? "green" : "red"}>{btcMove >= 0 ? "+" : ""}{btcMove.toFixed(2)}%</b></div>
              <div><span>VOLATILITY INDEX</span><b>{state.market.volatilityIndex.toFixed(1)}</b></div>
              <div><span>SOL/BTC CORRELATION</span><b>{state.market.solBtcCorrelation.toFixed(2)}</b></div>
            </div>
          </section>

          <section className="metrics-row">
            <MiniMetric label="LIVE PNL" value={`${state.metrics.totalPnL >= 0 ? "+" : ""}${fmtUsd(state.metrics.totalPnL)}`} detail="Realized + unrealized" tone={state.metrics.totalPnL >= 0 ? "green" : "red"} />
            <MiniMetric label="SIGNAL ACCURACY" value={`${state.metrics.signalAccuracy.toFixed(1)}%`} detail={`${state.metrics.completedTrades} evaluated signals`} />
            <MiniMetric label="WIN RATE" value={`${state.metrics.winRate.toFixed(1)}%`} detail="Closed positions" tone="purple" />
            <MiniMetric label="MAX DRAWDOWN" value={`${state.metrics.drawdown.toFixed(2)}%`} detail="From peak equity" tone="red" />
          </section>
        </section>

        <aside className="right-stack">
          <section className="panel glass positions-panel">
            <div className="panel-heading"><span><CircleDollarSign size={15} /> OPEN POSITIONS</span><span className="count">{state.positions.length}</span></div>
            <div className="position-list">
              {state.positions.length ? state.positions.map((position) => <PositionCard position={position} key={position.id} />) : (
                <div className="empty-position"><Gauge size={28} /><strong>NO OPEN EXPOSURE</strong><span>Start the agent to deploy the first position</span></div>
              )}
            </div>
            <div className="portfolio-summary">
              <div><span>TOTAL EXPOSURE</span><b>${state.positions.reduce((sum, position) => sum + position.sizeUsd, 0).toLocaleString()}</b></div>
              <div><span>HEDGE COVERAGE</span><b className="purple">{state.positions.some((position) => position.isHedge) ? "20.0%" : "0.0%"}</b></div>
            </div>
            {state.positions.length ? <button className="close-all" onClick={() => void emergencyClose()}>STOP AGENT + CLOSE ALL POSITIONS</button> : null}
          </section>
          <section className="panel glass hedge-panel">
            <ShieldCheck size={20} /><div><strong>AUTO-HEDGE ENGINE</strong><span>Correlation-aware risk offset</span></div><div className={`switch ${state.agentActive ? "on" : ""}`}><i /></div>
          </section>
        </aside>
      </section>

      <section className="panel glass execution-panel">
        <div className="panel-heading"><span><Activity size={15} /> EXECUTION FEED</span><span className="feed-live"><i /> LIVE EVENT STREAM</span></div>
        <div className="execution-feed">{state.logs.slice(0, 6).map((item) => <ExecutionRow item={item} key={item.id} />)}</div>
      </section>

      {state.logs[0]?.type === "EXECUTED" || state.logs[0]?.type === "HEDGE" || state.logs[0]?.type === "EXIT" ? (
        <div className={`toast ${state.logs[0].tone}`}><Zap size={15} /><div><strong>{state.logs[0].message}</strong><span>{state.logs[0].detail}</span></div></div>
      ) : null}

      <footer className="ticker"><div><span>LIVE MARKET INTELLIGENCE STREAM</span><b>SOL {solMove >= 0 ? "+" : ""}{solMove.toFixed(2)}%</b><b>BTC {btcMove >= 0 ? "+" : ""}{btcMove.toFixed(2)}%</b><b>VOL {state.market.volatilityIndex > 70 ? "HIGH" : "STABLE"}</b><b>AGENT {state.agentActive ? "ACTIVE" : "STANDBY"}</b><b>HEDGE {state.positions.some((position) => position.isHedge) ? "ON" : "ARMED"}</b><b>SOLANA FINALITY 48MS</b></div></footer>
    </main>
  );
}
