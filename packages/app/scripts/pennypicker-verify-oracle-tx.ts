/** Read-only: show the oracle state change and the oracles.cash message carried by a transaction. Run: pnpm dlx tsx scripts/pennypicker-verify-oracle-tx.ts <txid> */
import { binToHex, decodeTransaction, hexToBin, secp256k1, sha256 } from '@bitauth/libauth';
import { chipnetProvider } from '../src/lib/pennypicker/chain';
import { decodeOracleCommitment, formatPrice, GP_BCH_USD_ORACLE, parseOracleMessage } from '../src/lib/pennypicker/contracts';
const provider = await chipnetProvider('bchtest:qz6fyv7h46g24nwlqmhua23hqumgj2zgcc0w05m3sx');
const tx = (id: string) => { return provider.getRawTransaction(id).then((raw) => { const d = decodeTransaction(hexToBin(raw)); if (typeof d === 'string') throw new Error(d); return d; }); };
for (const id of process.argv.slice(2)) {
	const t = await tx(id);
	const in0 = t.inputs[0]!;
	const prev = (await tx(binToHex(in0.outpointTransactionHash))).outputs[in0.outpointIndex]!;
	const before = decodeOracleCommitment(prev.token!.nft!.commitment);
	const after = decodeOracleCommitment(t.outputs[0]!.token!.nft!.commitment);
	// Unlocking: <message 16B> <signature 64B> <selector> <redeem>: pushes are 0x10 + 16 bytes, 0x40 + 64 bytes.
	const u = in0.unlockingBytecode;
	let msg = '';
	if (u[0] === 0x10 && u[17] === 0x40) {
		const m = parseOracleMessage(binToHex(u.slice(1, 17)), binToHex(u.slice(18, 82)));
		const ok = secp256k1.verifySignatureSchnorr(m.signature, hexToBin(GP_BCH_USD_ORACLE.publicKey), sha256.hash(m.message));
		msg = `carries oracles.cash message #${m.messageSequence} price ${m.price} cents @${new Date(m.timestamp * 1000).toISOString()}, GP signature valid=${ok}`;
	} else msg = 'read only (no message)';
	console.log(`${id.slice(0, 12)}: oracle ${formatPrice(before.price)} #${before.sequence} → ${formatPrice(after.price)} #${after.sequence}; ${msg}`);
}
process.exit(0);
