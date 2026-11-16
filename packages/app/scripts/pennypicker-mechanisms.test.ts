/** Run: pnpm dlx tsx scripts/pennypicker-mechanisms.test.ts (from packages/app) */
import { quoteLiquidation, quoteRedemption, type BookOffer } from '../src/lib/pennypicker/mechanisms';

const PRICE = 500n * 100_000_000n; // 500.00 PUSD per BCH
const book: BookOffer[] = [
	{ id: 'bid-40', side: 'bid', deltaBps: -40, availableUnits: 5_000n },
	{ id: 'bid-150', side: 'bid', deltaBps: -150, availableUnits: 20_000n },
	{ id: 'ask-30', side: 'ask', deltaBps: 30, availableSats: 3_000_000n },
	{ id: 'ask-200', side: 'ask', deltaBps: 200, availableSats: 500_000_000n }
];
let failures = 0;
const check = (n: string, ok: boolean, d = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${d}`);
};

// Vault: 0.25 BCH (125 PUSD at reference) backing 110 PUSD debt -> ratio 113.63%.
const liq = quoteLiquidation({ collateralSats: 25_000_000n, debtUnits: 11_000n }, book, PRICE, 15_000n, 1_000n);
check('ratio computed', liq.ratioBps === 11_363n, `ratio=${liq.ratioBps}`);
check('eligible below 150%', liq.eligible);
check('sells into the best (smallest-discount) bid first', liq.route.legs[0]!.offerId === 'bid-40' && liq.route.legs[0]!.units === 5_000n);
check('debt fully bought back', liq.route.units === 11_000n && liq.fullyCovered, `units=${liq.route.units}`);
check('effective discount between -40 and -150 bps', liq.route.effectiveBps < -40 && liq.route.effectiveBps > -150, `eff=${liq.route.effectiveBps}`);
check('market liquidation spends less than a 10% fixed penalty', liq.collateralSpentSats < liq.fixedPenaltySpentSats, `${liq.collateralSpentSats} < ${liq.fixedPenaltySpentSats}`);

const red = quoteRedemption(20_000n, book, PRICE, 50n);
check('redemption buys from the cheapest ask first, limited by its BCH', red.route.legs[0]!.offerId === 'ask-30' && red.route.legs[0]!.sats === 3_000_000n);
check('redemption spends the whole budget (to within one unit)', red.route.unspentUnits <= 1n, `unspent=${red.route.unspentUnits}`);
check('effective premium positive', red.route.effectiveBps > 0, `eff=${red.route.effectiveBps}`);
process.exit(failures ? 1 : 0);
