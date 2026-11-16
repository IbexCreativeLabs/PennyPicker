/**
 * Public, committed identifiers of the shared PennyPicker Chipnet market.
 * These are on-chain identifiers, not secrets. Precedence in the app:
 * VITE_PENNYPICKER_* env vars > values saved in this browser > these defaults.
 *
 * The oracle category is intentionally not hard-coded until oracle genesis is
 * confirmed. Until then, the app discovers it from the operator's oracle
 * contract and accepts it only if the operator's own address created it.
 */
export const CHIPNET_DEPLOYMENT = {
	/** PUSD genesis tx 46db72c8711ccda28de97e924e5edc12a6f5b1f124fc2df83433c4a2156b61e4 (confirmed). */
	pusdCategory: 'b9d9ef3c2cd4ad75354119824c79b068501f3f5f4131b4a246274b35d508a2ee',
	/** Operator: bchtest:qq3gfs2492tlz2nckgpq6wn28fcd80lucvlxe0nrf0 */
	oracleOperatorPkh: '2284c1552a97f12a78b2020d3a6a3a70d3bffcc3',
	oracleCategory: undefined as string | undefined
} as const;
