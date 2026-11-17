/** Read-only: poll Chipnet until <txid> confirms. Run: pnpm dlx tsx scripts/pennypicker-wait-confirm.ts <txid> */
export {};
import { transactionHeight } from '../src/lib/pennypicker/chain';
const [txid] = process.argv.slice(2);
for (;;) {
	const h = await transactionHeight('bchtest:qze7r468d3qk2wnvzt7afwm2g7wzhgv0fgel4t7e50', txid!).catch(() => undefined);
	if (h && h > 0) { console.log(`confirmed ${txid.slice(0, 12)} at height ${h}`); process.exit(0); }
	await new Promise((r) => setTimeout(r, 20000));
}
