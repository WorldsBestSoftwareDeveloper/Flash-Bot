"use client";

import { executeTrade } from "./executor";
import { getLiveMarketData } from "./marketData";
import { rulesEngine } from "./rulesEngine";
import { store } from "./store";

let timer: ReturnType<typeof setInterval> | null = null;
let executing = false;
let neutralPaperScans = 0;

async function tick() {
  const current = store.getSnapshot();
  const market = await getLiveMarketData(current.market);
  store.updateMarket(market);
  if (!current.agentActive || executing) return;
  const next = store.getSnapshot();
  if (next.mode === "live" && market.source !== "flash") {
    if (next.agentActive) {
      store.setAgentActive(false);
      store.addLog("WARNING", "Live agent stopped", "Flash/Pyth oracle unavailable; simulated prices are display-only", "red");
    }
    return;
  }
  let signal = rulesEngine(market, next.positions);
  if (!signal && next.mode === "paper" && next.positions.length === 0) {
    neutralPaperScans += 1;
    if (neutralPaperScans >= 4) {
      signal = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        action: market.solPriceChange1m >= 0 ? "LONG_SOL" : "SHORT_SOL",
        confidence: 62,
        reason: "Paper validation signal using the current Flash/Pyth price direction",
        risk: "LOW",
      };
      neutralPaperScans = 0;
    }
  } else if (signal) {
    neutralPaperScans = 0;
  }
  if (!signal) return;
  store.setSignal(signal);
  executing = true;
  try {
    await executeTrade(signal);
  } catch (error) {
    store.addLog("WARNING", "Execution blocked", error instanceof Error ? error.message : String(error), "red");
  } finally {
    executing = false;
  }
}

export function startAgentLoop() {
  if (timer) return;
  timer = setInterval(() => void tick(), 2500);
}

export function stopAgentLoop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
