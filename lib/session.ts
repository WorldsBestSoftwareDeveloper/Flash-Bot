import { BN } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { Connection, Keypair, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

const SESSION_KEYS_PROGRAM = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const MAGIC_TRADE_PROGRAM = new PublicKey("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");
const STORAGE_KEY = "flash-trade-session";

export interface SessionWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}
export interface LoadedSession { keypair: Keypair; token: string; authority: string; validUntil: number }
interface StoredSession { secretKey: number[]; token: string; authority: string; validUntil: number }

export function loadSession(authority: string): LoadedSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredSession;
    if (stored.authority !== authority || stored.validUntil < Date.now() / 1000 + 60) return null;
    const keypair = Keypair.fromSecretKey(Uint8Array.from(stored.secretKey));
    const [expectedToken] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("session_token_v2"), MAGIC_TRADE_PROGRAM.toBytes(), keypair.publicKey.toBytes(), new PublicKey(authority).toBytes()],
      SESSION_KEYS_PROGRAM,
    );
    if (expectedToken.toBase58() !== stored.token) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { ...stored, keypair };
  } catch { return null; }
}

export function clearLocalSession() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

async function confirm(connection: Connection, signature: string) {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`Session transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Session confirmation timed out");
}

export async function createSession({ wallet, connection, validHours = 24, topUpSol = 0.01 }: { wallet: SessionWallet; connection: Connection; validHours?: number; topUpSol?: number }) {
  const keypair = Keypair.generate();
  const validUntil = Math.floor(Date.now() / 1000) + validHours * 3600;
  const [token] = PublicKey.findProgramAddressSync([new TextEncoder().encode("session_token_v2"), MAGIC_TRADE_PROGRAM.toBytes(), keypair.publicKey.toBytes(), wallet.publicKey.toBytes()], SESSION_KEYS_PROGRAM);
  const manager = new SessionTokenManager(wallet, connection);
  const tx = await manager.program.methods.createSessionV2(true, new BN(validUntil), new BN(Math.round(topUpSol * 1e9))).accountsPartial({
    sessionToken: token, sessionSigner: keypair.publicKey, feePayer: wallet.publicKey, authority: wallet.publicKey, targetProgram: MAGIC_TRADE_PROGRAM,
  }).transaction();
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.partialSign(keypair);
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  await confirm(connection, signature);
  const stored: StoredSession = { secretKey: Array.from(keypair.secretKey), token: token.toBase58(), authority: wallet.publicKey.toBase58(), validUntil };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return { signature, session: { keypair, token: stored.token, authority: stored.authority, validUntil } };
}

export async function revokeSession(session: LoadedSession, connection: Connection) {
  const wallet = { publicKey: session.keypair.publicKey, signTransaction: async <T,>(tx: T) => tx, signAllTransactions: async <T,>(txs: T[]) => txs } as SessionWallet;
  const manager = new SessionTokenManager(wallet, connection);
  const tx = await manager.program.methods.revokeSessionV2().accountsPartial({ sessionToken: new PublicKey(session.token), feePayer: session.keypair.publicKey, authority: new PublicKey(session.authority) }).transaction();
  tx.feePayer = session.keypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(session.keypair);
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await confirm(connection, signature);
  window.localStorage.removeItem(STORAGE_KEY);
  return signature;
}
