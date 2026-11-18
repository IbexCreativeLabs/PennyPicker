/**
 * Read-only mainnet readiness check. Connects to a mainnet Electrum server,
 * fetches the ParyonUSD authbase transaction (whose txid is the token category) and the live oracles.cash message,
 * and derives the mainnet oracle contract address. It never signs or broadcasts.
 * Run: pnpm dlx tsx scripts/pennypicker-mainnet-check.ts   (from packages/app)
 */
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { fetchLatestOracleMessage, loadMarketConfig, oracleAddress, providerFor } from '../src/lib/pennypicker/chain';
import { formatPrice, oracleStateFromMessage } from '../src/lib/pennypicker/contracts';
import { MAINNET_WRITES_ENABLED, MARKETS, PARYONUSD_CATEGORY } from '../src/lib/pennypicker/deployment';

const config = loadMarketConfig('mainnet');
const paryon = MARKETS.find((m) => m.id === 'paryonusd')!;
console.log(`Market: ${paryon.name} on ${paryon.network}, status ${paryon.status}${paryon.statusReason ? ` (${paryon.statusReason})` : ''}`);
console.log(`Writes enabled: ${MAINNET_WRITES_ENABLED}; cap ${config.maxOrderUnits} units`);

// Any mainnet address selects the mainnet Electrum provider; this one is derived, not a wallet.
const probe = oracleAddress('00'.repeat(19) + '01', undefined, 'mainnet');
console.log(`Example mainnet oracle contract address: ${probe}`);
const provider = await providerFor(probe);
const raw = await provider.getRawTransaction(PARYONUSD_CATEGORY);
const genesis = decodeTransaction(hexToBin(raw));
if (typeof genesis === 'string') throw new Error(genesis);
console.log(`ParyonUSD authbase transaction ${PARYONUSD_CATEGORY.slice(0, 12)}… found on mainnet (${genesis.outputs.length} outputs)`);

const message = await fetchLatestOracleMessage();
console.log(`oracles.cash BCH/USD: ${formatPrice(oracleStateFromMessage(message).price)} (message #${message.messageSequence}, signature verified)`);
await provider.disconnect?.().catch(() => undefined);
process.exit(0);
