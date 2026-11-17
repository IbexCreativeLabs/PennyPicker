/** Read-only: list txids touching the oracle contract. Run: pnpm dlx tsx scripts/pennypicker-oracle-history.ts */
import { chipnetProvider, oracleAddress } from '../src/lib/pennypicker/chain';
import { CHIPNET_DEPLOYMENT } from '../src/lib/pennypicker/deployment';
const address = oracleAddress(CHIPNET_DEPLOYMENT.oracleOperatorPkh);
const provider = await chipnetProvider(address);
const history = await (provider as unknown as { getHistory(a: string): Promise<{ tx_hash: string; height: number }[]> }).getHistory(address);
for (const h of history) console.log(h.tx_hash, h.height);
process.exit(0);
