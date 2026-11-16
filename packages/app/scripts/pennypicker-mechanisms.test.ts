/** Run: pnpm dlx tsx scripts/pennypicker-mechanisms.test.ts (from packages/app) */
import { quoteLiquidation, quoteRedemption, type BookOffer } from '../src/lib/pennypicker/mechanisms';
const RATE = 200_000n * 100_000_000n; // 500 PUSD/BCH
const book: BookOffer[] = [
	{ id: 'a1', side: 'sell-pusd', deltaBps: 150, remainingUnits: 20_000n },
	{ id: 'a2', side: 'sell-pusd', deltaBps: 40, remainingUnits: 10_000n },
	{ id: 'b1', side: 'buy-pusd', deltaBps: -30, remainingUnits: 50_000n, escrowSats: 30_000_000n },
	{ id: 'b2', side: 'buy-pusd', deltaBps: -200, remainingUnits: 50_000n, escrowSats: 500_000_000n }
];
let failures = 0;
const check = (n: string, ok: boolean, d = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${d}`); };
// Vault: 0.25 BCH collateral (125 PUSD at reference) backing 110 PUSD debt -> ratio ~113.6%.
const liq = quoteLiquidation({ collateralSats: 25_000_000n, debtUnits: 11_000n }, book, RATE, 15_000n, 1_000n);
check('ratio computed', liq.ratioBps === 11363n, `ratio=${liq.ratioBps}`);
check('eligible below 150%', liq.eligible);
check('routes cheapest ask first', liq.route.legs[0]!.offerId === 'a2' && liq.route.legs[0]!.units === 10_000n);
check('effective premium between 40 and 150 bps', liq.route.effectiveBps > 40 && liq.route.effectiveBps < 150, `eff=${liq.route.effectiveBps}`);
check('market liquidation cheaper than 10% fixed penalty', liq.collateralSpentSats < liq.fixedPenaltySpentSats, `${liq.collateralSpentSats} < ${liq.fixedPenaltySpentSats}`);
const red = quoteRedemption(20_000n, book, RATE, 50n);
check('redemption uses highest bid first, escrow-limited', red.route.legs[0]!.offerId === 'b1' && red.route.legs[0]!.units < 20_000n, JSON.stringify(red.route.legs.map(l => [l.offerId, String(l.units)])));
check('redemption fully routed', red.route.unfilledUnits === 0n);
check('effective fee negative bps', red.route.effectiveBps < 0, `eff=${red.route.effectiveBps}`);
process.exit(failures ? 1 : 0);
