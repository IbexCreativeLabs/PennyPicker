/** Read-only: print full Chipnet UTXOs for each address. Run: pnpm dlx tsx scripts/pennypicker-utxos-full.ts <addr>... */
import { getAddressUtxos, oracleAddress } from '../src/lib/pennypicker/chain';
const args = process.argv.slice(2).map((a) => (a.startsWith('oracle:') ? oracleAddress(a.slice(7)) : a));
for (const a of args) {
	console.log('#', a);
	for (const x of await getAddressUtxos(a)) console.log(`${x.txid}:${x.vout} ${x.satoshis} h=${x.height ?? 0}${x.token ? ` cat=${x.token.category} amt=${x.token.amount}${x.token.nft ? ` nft=${x.token.nft.capability}:${x.token.nft.commitment}` : ''}` : ''}`);
}
process.exit(0);
