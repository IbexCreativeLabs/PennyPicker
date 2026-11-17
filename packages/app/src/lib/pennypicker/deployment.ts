/**
 * Public, committed identifiers of the shared PennyPicker Chipnet market.
 * These are on-chain identifiers, not secrets. Precedence in the app:
 * VITE_PENNYPICKER_* env vars > values saved in this browser > these defaults.
 *
 * Market v3 (2026-11-17): operated by the "PP Operator" Cashonize test wallet.
 * The v2 market (PUSD b9d9ef3c…, oracle 03f6c31a…, operator qq3gfs…nrf0) was
 * retired because its operator wallet is no longer available.
 * Oracle v4 (2026-11-17): the reference is the oracles.cash BCH/USD price, verified
 * on-chain; the v3 operator-typed oracle (88e2a9ee…) is retired.
 *
 */
export const CHIPNET_DEPLOYMENT = {
	/** PUSD genesis 9a1a960107d5de533a68659bd3b97b175f548c1d483beb7c7ff285b560316aba (identity at :0, supply at :1). */
	pusdCategory: '74167994a2d8e1e57188bae9a42035678e3526a1d8650ced756b2ffa4c078ab3' as string | undefined,
	/** Operator: bchtest:qz6fyv7h46g24nwlqmhua23hqumgj2zgcc0w05m3sx */
	oracleOperatorPkh: 'b49233d7ae90aacddf06efceaa370736892848c6',
	/** Oracle v4, fed by oracles.cash BCH/USD. Genesis 34533fc4635527016456e3965b1cc31e5a7037c0a4537282480feaf57a6d0e27 (210.99, message #1930547). */
	oracleCategory: 'adcf011756ad2726f8521c371ea950ae293fb1a1e6507bfdc13cbe2b2d4f74b5' as string | undefined
} as const;
