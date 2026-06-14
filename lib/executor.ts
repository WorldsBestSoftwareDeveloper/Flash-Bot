import type { BasketSnapshot, ClosePositionRequest, OpenPositionRequest } from "flash-v2";
import { flash } from "./flashClient";
import { calculateHedgeSize } from "./hedger";
import { store } from "./store";
import type { Asset, Position, Side, Trade, TradingSignal } from "./types";

const MAX_LIVE_COLLATERAL_USD = 100;

export interface SessionExecutionContext {
  owner: string;
  signer: string;
  sessionToken: string;
  sendTrade(transactionBase64: string): Promise<{ signature: string }>;
}

let liveSession: SessionExecutionContext | null = null;
let lastLiveOrderAt = 0;
const LIVE_ORDER_COOLDOWN_MS = 60_000;

export function configureLiveSession(session: SessionExecutionContext | null) {
  liveSession = session;
}

function createPosition(asset: Asset, side: Side, sizeUsd: number, price: number, isHedge: boolean): { position: Position; trade: Trade } {
  const id = crypto.randomUUID();
  const position: Position = { id, asset, side, sizeUsd, entryPrice: price, currentPrice: price, pnl: 0, pnlPercent: 0, isHedge, openedAt: Date.now() };
  const trade: Trade = { id, timestamp: Date.now(), asset, side, sizeUsd, entryPrice: price, pnl: 0, status: "OPEN", source: isHedge ? "HEDGE" : "SIGNAL" };
  return { position, trade };
}

async function submitLiveOpen(asset: Asset, side: Side, sizeUsd: number) {
  if (!liveSession) throw new Error("Live mode requires an authorized MagicBlock session key");
  const readiness = store.getSnapshot();
  if (!readiness.sessionReady || !readiness.basketReady) throw new Error("Complete Live Setup before sending automated orders");
  const collateral = sizeUsd / readiness.leverage;
  if (readiness.market.source !== "flash" || !readiness.marketDataLive || Date.now() - readiness.market.timestamp > 10_000) {
    throw new Error("Live entry requires a fresh Flash/Pyth oracle tick");
  }
  if (Date.now() - lastLiveOrderAt < LIVE_ORDER_COOLDOWN_MS) throw new Error("Live order cooldown active; wait one minute between entries");
  if (readiness.positions.some((position) => !position.isHedge)) throw new Error("A primary position is already open");
  if (collateral > MAX_LIVE_COLLATERAL_USD) throw new Error(`Live order exceeds the $${MAX_LIVE_COLLATERAL_USD} collateral safety cap`);
  const baseRequest: OpenPositionRequest = {
    inputTokenSymbol: "USDC",
    outputTokenSymbol: asset,
    inputAmountUi: collateral.toFixed(2),
    leverage: readiness.leverage,
    tradeType: side,
    orderType: "MARKET",
    slippagePercentage: "0.5",
  };
  const quote = await flash.openPosition(baseRequest);
  const markPrice = asset === "SOL" ? readiness.market.solPrice : readiness.market.btcPrice;
  const quotePrice = Number(quote.newEntryPrice);
  const quoteDeviation = Math.abs(quotePrice - markPrice) / markPrice;
  const entryFee = Number(quote.entryFee);
  if (!Number.isFinite(quotePrice) || quoteDeviation > 0.15) throw new Error("Quote spread exceeds the 15% safety limit");
  if (!Number.isFinite(entryFee) || entryFee > collateral * 0.1) throw new Error("Quoted entry fee exceeds the 10% safety limit");
  if (Number(quote.availableLiquidity) < sizeUsd) throw new Error("Insufficient FlashTrade market liquidity");
  const request: OpenPositionRequest = {
    ...baseRequest,
    owner: liveSession.owner,
    signer: liveSession.signer,
    sessionToken: liveSession.sessionToken,
  };
  const built = await flash.openPosition(request);
  if (!built.transactionBase64) throw new Error("FlashTrade did not return a transaction");
  const result = await liveSession.sendTrade(built.transactionBase64);
  lastLiveOrderAt = Date.now();
  return result;
}

export async function openPosition(asset: Asset, side: Side, sizeUsd?: number, isHedge = false) {
  const state = store.getSnapshot();
  const requestedSize = sizeUsd ?? state.tradeCollateralUsd * state.leverage;
  const price = asset === "SOL" ? state.market.solPrice : state.market.btcPrice;
  const created = createPosition(asset, side, requestedSize, price, isHedge);
  if (state.mode === "live") {
    const result = await submitLiveOpen(asset, side, requestedSize);
    created.trade.txSignature = result.signature;
  }
  store.openPosition(created.position, created.trade);
}

export async function closePosition() {
  if (store.getSnapshot().mode === "live") {
    if (!liveSession) throw new Error("Live close requires an authorized session key");
    const positions = store.getSnapshot().positions;
    for (const position of positions) {
      const request: ClosePositionRequest = {
        marketSymbol: position.asset,
        side: position.side,
        inputUsdUi: "0",
        withdrawTokenSymbol: "USDC",
        owner: liveSession.owner,
        signer: liveSession.signer,
        sessionToken: liveSession.sessionToken,
        slippagePercentage: "0.5",
      };
      const built = await flash.closePosition(request);
      if (!built.transactionBase64) throw new Error("FlashTrade did not return a close transaction");
      await liveSession.sendTrade(built.transactionBase64);
    }
  }
  store.closeSolPositions();
}

export async function openHedge() {
  const state = store.getSnapshot();
  const sol = state.positions.find((position) => position.asset === "SOL" && position.side === "LONG");
  if (!sol) return;
  const hedgeSize = calculateHedgeSize(sol);
  if (state.mode === "live" && hedgeSize / state.leverage < 12) {
    store.addLog("WARNING", "Hedge skipped at minimum size", "Increase trade collateral to 60 USDC to enable the 20% BTC hedge", "purple");
    return;
  }
  await openPosition("BTC", "SHORT", hedgeSize, true);
}

export async function executeTrade(signal: TradingSignal) {
  if (signal.action === "LONG_SOL") return openPosition("SOL", "LONG");
  if (signal.action === "SHORT_SOL") return openPosition("SOL", "SHORT");
  if (signal.action === "HEDGE_BTC_SHORT") return openHedge();
  if (signal.action === "EXIT_SOL") return closePosition();
}

export function syncLivePositions(snapshot: BasketSnapshot) {
  if (store.getSnapshot().mode !== "live") return;
  const positions = Object.entries(snapshot.positionMetrics ?? {}).map(([marketKey, item]): Position => {
    const asset = item.marketSymbol.toUpperCase() === "BTC" ? "BTC" : "SOL";
    const side = item.sideUi.toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    const entryPrice = Number(item.entryPriceUi);
    const currentPrice = asset === "SOL" ? store.getSnapshot().market.solPrice : store.getSnapshot().market.btcPrice;
    return {
      id: `live-${marketKey}-${side}`,
      asset,
      side,
      sizeUsd: Number(item.sizeUsdUi),
      entryPrice,
      currentPrice,
      pnl: Number(item.pnlWithFeeUsdUi),
      pnlPercent: Number(item.pnlPercentageWithFee),
      isHedge: asset === "BTC" && side === "SHORT",
      openedAt: Date.now(),
    };
  });
  store.syncPositions(positions);
}
