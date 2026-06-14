"use client";

import { Connection, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { decodeTransaction, FlashV2Client, signAndSend, type BasketSnapshot } from "flash-v2";
import { configureLiveSession, syncLivePositions } from "./executor";
import { store } from "./store";
import { createSession, loadSession, revokeSession, type LoadedSession, type SessionWallet } from "./session";

export interface BrowserWallet extends SessionWallet {
  connect(): Promise<{ publicKey: PublicKey }>;
  isPhantom?: boolean;
}

export const flash = new FlashV2Client();
export const baseConnection = new Connection(flash.network.baseRpc, "confirmed");
let activeSession: LoadedSession | null = null;
let activeWallet: BrowserWallet | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;

async function assertBaseRpcReady() {
  try {
    await baseConnection.getLatestBlockhash("confirmed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/403|forbidden/i.test(message)) {
      throw new Error("Base RPC rejected the request (403). Verify the Helius API key and allow this site origin, including http://localhost:3000 for local testing");
    }
    if (/401|unauthorized/i.test(message)) {
      throw new Error("Base RPC rejected the API key (401). Replace NEXT_PUBLIC_BASE_RPC with an active Solana mainnet RPC URL");
    }
    throw new Error(`Base RPC is unavailable: ${message}`);
  }
}

async function submitBase(tx: Transaction | VersionedTransaction) {
  const signature = await baseConnection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await baseConnection.confirmTransaction(signature, "confirmed");
  return signature;
}

async function signAndSubmit(wallet: BrowserWallet, transactionBase64: string) {
  const signed = await wallet.signTransaction(decodeTransaction(transactionBase64));
  return submitBase(signed);
}

export async function connectLiveWallet(): Promise<BrowserWallet> {
  const injected = window as typeof window & {
    solana?: BrowserWallet;
    phantom?: { solana?: BrowserWallet };
  };
  const wallet = injected.phantom?.solana ?? injected.solana;
  if (!wallet) {
    throw new Error("No injected Solana wallet found. Open Flash Bot in Chrome/Brave with Phantom enabled, then refresh the page");
  }
  const connected = await wallet.connect();
  activeWallet = wallet;
  const owner = connected.publicKey.toBase58();
  store.setWallet(owner);
  store.addLog("SYSTEM", "Wallet connected", `${owner.slice(0, 5)}...${owner.slice(-5)} · Solana mainnet`, "green");
  const session = loadSession(owner);
  if (session) activateSession(session);
  const snapshot = await flash.owner(owner).catch(() => null);
  store.setLiveReadiness(Boolean(session), Boolean(snapshot?.basketPubkey), session && snapshot?.basketPubkey ? "Live execution ready" : "Run live setup");
  startOwnerSync(owner);
  return wallet;
}

function activateSession(session: LoadedSession) {
  activeSession = session;
  configureLiveSession({
    owner: session.authority,
    signer: session.keypair.publicKey.toBase58(),
    sessionToken: session.token,
    sendTrade: (transactionBase64) => signAndSend(flash.network.erRpc, transactionBase64, session.keypair, { skipPreflight: true }),
  });
}

export async function setupLiveTrading() {
  const wallet = activeWallet;
  if (!wallet) throw new Error("Connect a Solana wallet first");
  await assertBaseRpcReady();
  const owner = wallet.publicKey.toBase58();
  let snapshot: BasketSnapshot | null = await flash.owner(owner).catch(() => null);
  let session = loadSession(owner);
  if (!session) {
    store.addLog("SYSTEM", "Approve session key setup", "Creates a 24-hour automated signer with a recoverable 0.01 SOL top-up", "purple");
    session = (await createSession({ wallet, connection: baseConnection, validHours: 24, topUpSol: 0.01 })).session;
    activateSession(session);
  }
  if (!snapshot?.basketPubkey) {
    store.addLog("SYSTEM", "Approve FlashTrade account setup", "Basket, deposit ledger, and MagicBlock delegation; no USDC moves", "purple");
    const basket = await flash.initBasket({ owner });
    await signAndSubmit(wallet, basket.transactionBase64);
    const ledger = await flash.initDepositLedger({ owner });
    await signAndSubmit(wallet, ledger.transactionBase64);
    const delegation = await flash.delegateBasket({ payer: owner, owner });
    await signAndSubmit(wallet, delegation.transactionBase64);
    snapshot = await flash.owner(owner).catch(() => null);
  }
  store.setLiveReadiness(true, Boolean(snapshot?.basketPubkey), snapshot?.basketPubkey ? "Live ready; deposit USDC separately if unfunded" : "Setup incomplete");
  store.addLog("SYSTEM", "Live execution activated", "Session key and FlashTrade basket are ready", "green");
  startOwnerSync(owner);
}

export async function disableLiveTrading() {
  if (activeSession) await revokeSession(activeSession, baseConnection);
  activeSession = null;
  configureLiveSession(null);
  store.setLiveReadiness(false, store.getSnapshot().basketReady, "Session revoked; live automation disabled");
}

export async function depositUsdc(amount: number) {
  if (!activeWallet) throw new Error("Connect a Solana wallet first");
  if (!Number.isFinite(amount) || amount < 12) throw new Error("Minimum test deposit is 12 USDC");
  const tokens = await flash.tokens();
  const usdc = tokens.find((token) => token.symbol.toUpperCase() === "USDC");
  if (!usdc) throw new Error("USDC is unavailable in the active FlashTrade pool");
  store.addLog("SYSTEM", "Approve USDC deposit", `${amount.toFixed(2)} USDC will move into your FlashTrade basket`, "purple");
  const built = await flash.depositDirect({ owner: activeWallet.publicKey.toBase58(), tokenMint: usdc.mintKey, amount: amount.toFixed(2) });
  const signature = await signAndSubmit(activeWallet, built.transactionBase64);
  store.addLog("EXECUTED", "USDC deposit submitted", `${amount.toFixed(2)} USDC · ${signature.slice(0, 8)}...`, "green");
  return signature;
}

async function usdcMint() {
  const tokens = await flash.tokens();
  const usdc = tokens.find((token) => token.symbol.toUpperCase() === "USDC");
  if (!usdc) throw new Error("USDC is unavailable in the active FlashTrade pool");
  return usdc.mintKey;
}

export async function requestUsdcWithdrawal(amount: number) {
  if (!activeWallet) throw new Error("Connect a Solana wallet first");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid USDC withdrawal amount");
  if (store.getSnapshot().positions.length > 0) throw new Error("Close all positions before requesting a withdrawal");
  const mint = await usdcMint();
  store.addLog("SYSTEM", "Approve withdrawal request", `${amount.toFixed(2)} USDC will be queued from the MagicBlock rollup`, "purple");
  const built = await flash.requestWithdrawal({ owner: activeWallet.publicKey.toBase58(), tokenMint: mint, amount: amount.toFixed(2) });
  const signature = await signAndSubmit(activeWallet, built.transactionBase64);
  store.addLog("SYSTEM", "Withdrawal settlement pending", "Wait roughly 30–90 seconds, then execute the withdrawal", "purple");
  return signature;
}

export async function executeUsdcWithdrawal() {
  if (!activeWallet) throw new Error("Connect a Solana wallet first");
  const mint = await usdcMint();
  store.addLog("SYSTEM", "Approve withdrawal execution", "This returns settled USDC to your wallet", "purple");
  const built = await flash.executeWithdrawal({ owner: activeWallet.publicKey.toBase58(), tokenMint: mint });
  const signature = await signAndSubmit(activeWallet, built.transactionBase64);
  store.addLog("EXECUTED", "USDC withdrawal completed", `Funds returned to wallet · ${signature.slice(0, 8)}...`, "green");
  return signature;
}

async function refreshOwner(owner: string) {
  const snapshot = await flash.owner(owner).catch(() => null);
  if (snapshot) syncLivePositions(snapshot);
}

export function startOwnerSync(owner: string) {
  if (syncTimer) clearInterval(syncTimer);
  void refreshOwner(owner);
  syncTimer = setInterval(() => void refreshOwner(owner), 3000);
}
