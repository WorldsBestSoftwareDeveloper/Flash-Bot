# Flash Bot

Real-time autonomous perpetual trading agent built with Flash Trade V2, MagicBlock session keys, and Flash/Pyth market prices.

Flash Bot supports free paper execution and guarded Solana-mainnet execution. Live mode uses real funds.

## Features

- Real Flash/Pyth SOL and BTC prices
- Deterministic autonomous trading rules
- Paper and live execution modes
- SOL long and short signals
- Correlation-based BTC short hedging
- Profit-target, reversal, and volatility exits
- Live PnL, drawdown, win rate, and signal accuracy
- Line and candlestick charts
- 1-minute and 5-minute candle aggregation
- Phantom wallet connection
- MagicBlock 24-hour session keys
- FlashTrade basket, ledger, and delegation setup
- Explicit USDC deposits and two-step withdrawals
- Quote, fee, spread, liquidity, oracle, exposure, and cooldown safety checks
- Emergency stop and close-all control

## Requirements

- Node.js 20+
- Phantom browser wallet for Live mode
- Solana mainnet SOL and USDC for Live mode
- A domain-restricted mainnet RPC key from Helius, Triton, or QuickNode

## Environment

Copy `.env.example` to `.env.local`:

```env
NEXT_PUBLIC_FLASH_NETWORK=mainnet
NEXT_PUBLIC_BASE_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_DOMAIN_RESTRICTED_KEY
NEXT_PUBLIC_ER_RPC=https://flash.magicblock.xyz
NEXT_PUBLIC_FLASH_API_BASE=https://flashapi.trade/v2
```

Never commit `.env.local`. Public browser environment variables remain visible to users, so restrict the RPC key to localhost and your deployed domain.

## Local Development

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Paper Testing

Paper mode is free and never submits transactions.

1. Keep `PAPER` selected.
2. Click `START AGENT`.
3. Flash Bot reads real Flash/Pyth prices.
4. Production-rule signals execute locally.
5. After several neutral scans, a clearly labeled validation signal may test the paper execution flow without changing market prices.

## Minimum Mainnet Test

Flash Trade V2 operates on Solana mainnet. Use a separate wallet and only funds you can afford to lose.

Recommended initial wallet funding:

- `0.05 SOL` for account setup, rent, transaction fees, and the recoverable `0.01 SOL` session-key top-up
- `20 USDC` for a minimum-size trade and fee/spread headroom

The default minimum live trade is:

- `12 USDC` collateral
- `5x` leverage
- Approximately `60 USD` requested notional before FlashTrade spread adjustments

The 20% BTC hedge is skipped at minimum size because it would fall below the practical collateral floor. Set primary collateral to at least `60 USDC` to test automatic hedging.

## Live Flow

1. Confirm `MARKET STREAM` shows `FLASH LIVE`.
2. Connect Phantom.
3. Click `SETUP LIVE`.
4. Approve the session key, basket, deposit ledger, and MagicBlock delegation.
5. Enter a USDC amount and click `DEPOSIT USDC`.
6. Wait for the deposit to become tradable.
7. Select `LIVE`.
8. Click `START AGENT`.
9. Monitor the first trade continuously.
10. Use `STOP AGENT + CLOSE ALL POSITIONS` to stop and exit.
11. Request a USDC withdrawal.
12. Wait roughly 30–90 seconds.
13. Click `EXECUTE PENDING WITHDRAWAL`.
14. Click `REVOKE SESSION` when finished.

Live entries fail closed unless the oracle tick is fresh, setup is complete, no primary position is open, cooldown has elapsed, liquidity is sufficient, and the quote remains inside configured fee/spread limits.

## Fund Locations

- Wallet SOL and USDC remain in Phantom until explicitly approved.
- Deposited USDC moves into FlashTrade’s mainnet vault and is accounted to the wallet’s basket/deposit ledger.
- Position collateral remains locked while positions are open.
- Session-key authorization exists on Solana mainnet.
- The session signer private key is stored in browser local storage until revoked or expired.

Trading losses, spreads, fees, and consumed transaction fees are not recoverable.

## Withdrawal

Withdrawals require two wallet approvals:

1. `request-withdrawal` queues settlement from MagicBlock.
2. `execute-withdrawal` returns settled funds to the wallet.

The settlement receipt normally reaches Solana base chain within approximately 30–90 seconds. The execute action can be retried if settlement is still pending.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run build
```

## Vercel Deployment

1. Push the repository to GitHub.
2. Import it into Vercel as a Next.js project.
3. Add the four environment variables shown above.
4. Deploy.
5. Add the deployed Vercel domain to the RPC provider’s allowed-domain list.
6. Redeploy after updating RPC restrictions.

## Important Safety Notice

This software is experimental and does not guarantee profits or prevent losses. Start with the minimum test amount, verify the complete open, close, withdraw, and revoke lifecycle, and never expose unrestricted RPC keys or wallet secrets.
