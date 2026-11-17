/**
 * Public, committed identifiers of the shared PennyPicker Chipnet market.
 * These are on-chain identifiers, not secrets. Precedence in the app:
 * VITE_PENNYPICKER_* env vars > values saved in this browser > these defaults.
 *
 * The oracle category is the confirmed oracle genesis on Chipnet.
 */
export const CHIPNET_DEPLOYMENT = {
	/** PUSD genesis tx 46db72c8711ccda28de97e924e5edc12a6f5b1f124fc2df83433c4a2156b61e4 (confirmed). */
	pusdCategory: 'b9d9ef3c2cd4ad75354119824c79b068501f3f5f4131b4a246274b35d508a2ee',
	/** Operator: bchtest:qq3gfs2492tlz2nckgpq6wn28fcd80lucvlxe0nrf0 */
	oracleOperatorPkh: '2284c1552a97f12a78b2020d3a6a3a70d3bffcc3',
	/** Oracle genesis tx c530a91072561915dd032da8d491fa98c6b612e27b47b06ee8711ddfcd1cee22 (block 334564). */
	oracleCategory: '03f6c31a05b86b4278991ad9429049283f8a2bb84c27a4fc3d9aae898cd0a602' as string | undefined
} as const;
