/** Read-only: print Chipnet UTXOs for each address. Run: pnpm dlx tsx scripts/pennypicker-balances.ts <addr>... */
import { getAddressUtxos } from '../src/lib/pennypicker/chain';
for (const a of process.argv.slice(2)) {
  const u = await getAddressUtxos(a);
  console.log(a.slice(0, 20), u.map((x) => `${x.txid.slice(0, 10)}:${x.vout} ${x.satoshis} h=${x.height ?? 0}${x.token ? ` tok=${x.token.category.slice(0, 6)}/${x.token.amount}${x.token.nft ? '/nft' : ''}` : ''}`).join(' | ') || '(empty)');
}
process.exit(0);
