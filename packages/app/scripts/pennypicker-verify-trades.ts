/**
 * Read-only: decode PennyPicker trade transactions from Chipnet and check the
 * settlement arithmetic against the covenant rule. Run: pnpm dlx tsx scripts/pennypicker-verify-trades.ts <txid>...
 */
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { chipnetProvider } from '../src/lib/pennypicker/chain';
import { CHIPNET_DEPLOYMENT } from '../src/lib/pennypicker/deployment';
import { decodeOracleCommitment, formatPrice } from '../src/lib/pennypicker/contracts';

const provider = await chipnetProvider('bchtest:qz6fyv7h46g24nwlqmhua23hqumgj2zgcc0w05m3sx');
const tx = async (id: string) => { const d = decodeTransaction(hexToBin(await provider.getRawTransaction(id))); if (typeof d === 'string') throw new Error(d); return d; };
const pusd = CHIPNET_DEPLOYMENT.pusdCategory!;
for (const id of process.argv.slice(2)) {
	const t = await tx(id);
	console.log(`\n== ${id}`);
	for (const [i, inp] of t.inputs.entries()) {
		const prevId = binToHex(inp.outpointTransactionHash);
		const prev = (await tx(prevId)).outputs[inp.outpointIndex]!;
		const tok = prev.token ? (binToHex(prev.token.category) === pusd ? ` PUSD=${prev.token.amount}` : prev.token.nft ? ` oracle=${formatPrice(decodeOracleCommitment(prev.token.nft.commitment).price)}` : ' token') : '';
		console.log(`  in${i}  ${prevId.slice(0, 10)}:${inp.outpointIndex} ${prev.valueSatoshis} sats${tok} lock=${binToHex(prev.lockingBytecode).slice(0, 6)}`);
	}
	for (const [i, o] of t.outputs.entries()) {
		const tok = o.token ? (binToHex(o.token.category) === pusd ? ` PUSD=${o.token.amount}` : o.token.nft ? ` oracle=${formatPrice(decodeOracleCommitment(o.token.nft.commitment).price)}` : ' token') : '';
		console.log(`  out${i} ${o.valueSatoshis} sats${tok} lock=${binToHex(o.lockingBytecode).slice(0, 6)}`);
	}
}
process.exit(0);
