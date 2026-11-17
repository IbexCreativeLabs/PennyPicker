/**
 * Read-only Chipnet check: operator UTXOs, PUSD identity head, oracle state and
 * the identity-separation preview built from live data. Signs nothing.
 * Run: pnpm dlx tsx scripts/pennypicker-live-check.ts   (from packages/app)
 */
import { getAddressUtxos, getIdentityHead, getOracleState } from '../src/lib/pennypicker/chain';
import { buildIdentitySeparation } from '../src/lib/pennypicker/exchange';
import { markIdentityOutputs } from '../src/lib/pennypicker/identity';
import { formatPrice } from '../src/lib/pennypicker/contracts';
import { CHIPNET_DEPLOYMENT } from '../src/lib/pennypicker/deployment';

const OPERATOR = 'bchtest:qq3gfs2492tlz2nckgpq6wn28fcd80lucvlxe0nrf0';
const ORACLE_CATEGORY = '03f6c31a05b86b4278991ad9429049283f8a2bb84c27a4fc3d9aae898cd0a602';
const market = { pusdCategory: CHIPNET_DEPLOYMENT.pusdCategory, oracleOperatorPkh: CHIPNET_DEPLOYMENT.oracleOperatorPkh, oracleCategory: ORACLE_CATEGORY };

const utxos = await getAddressUtxos(OPERATOR);
const head = await getIdentityHead(market.pusdCategory, OPERATOR);
console.log('identity head', `${head.txid}:${head.vout}`, 'chain', head.chain.map((t) => t.slice(0, 8)).join(' → '));
const marked = markIdentityOutputs(utxos, [head]);
for (const u of marked) console.log(' utxo', `${u.txid.slice(0, 12)}…:${u.vout}`, u.satoshis, u.token ? `${u.token.category.slice(0, 8)} amt=${u.token.amount} nft=${u.token.nft?.capability ?? '-'}` : '', u.identityOf ? 'IDENTITY' : '', `h=${u.height}`);
const oracle = await getOracleState(market as never);
console.log('oracle', oracle ? `${formatPrice(oracle.state.price)} seq=${oracle.state.sequence} ts=${new Date(oracle.state.timestamp * 1000).toISOString()} at ${oracle.txid.slice(0, 12)}:${oracle.vout}` : 'NOT FOUND');
try {
	const sep = buildIdentitySeparation(market.pusdCategory, OPERATOR, marked, head);
	console.log('separation preview:'); sep.summary.forEach((l) => console.log('  ', l));
	sep.transaction.inputs.forEach((_, i) => console.log('   in', i, sep.sourceOutputs[i]!.valueSatoshis, sep.sourceOutputs[i]!.token?.amount ?? ''));
	sep.transaction.outputs.forEach((o, i) => console.log('   out', i, o.valueSatoshis, o.token?.amount ?? ''));
} catch (e) { console.log('separation not buildable:', (e as Error).message); }
process.exit(0);
