import type { NetworkId } from './network';

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

/** ParyonUSD (mainnet), 2 decimals like PennyPickerUSD. */
export const PARYONUSD_CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';

/**
 * Mainnet market against the real ParyonUSD. The price record (PennyPickerOracle)
 * was created on 2026-11-18 with the owner's approval. Trading stays off until
 * MAINNET_WRITES_COMMITTED is switched on (see DEPLOYMENT.md, "Going live on mainnet").
 */
export const MAINNET_DEPLOYMENT = {
	pusdCategory: PARYONUSD_CATEGORY as string | undefined,
	/** Operator: PP Mainnet Maker, bitcoincash:qrha2a6sntr3xgu3ay4zendhfeaxns8v7qru2jmsy0 */
	oracleOperatorPkh: 'efd577509ac7132391e92a2ccdb74e7a69c0ecf0' as string | undefined,
	/** Genesis 95734104aa53ada1642974ea3ea778c00da10bf9c42ef346bc395006693c5473 (2026-11-18, 207.73). */
	oracleCategory: 'f9a9812abc5f8de2847b10945c81a392ff86707f07eff25f091eda27a17503d6' as string | undefined
} as const;

/**
 * Master switch for mainnet transactions. While false, this build cannot sign or
 * broadcast anything on mainnet (enforced in chain.ts as well as in the UI).
 */
/** Opened by the project owner on 2026-11-18, with the 25 PUSD per-order cap and no keeper. */
const MAINNET_WRITES_COMMITTED = true;
/**
 * Effective switch. Besides the committed value, a local dev server may enable it for the one-time
 * mainnet setup with VITE_PENNYPICKER_MAINNET_WRITES=1; production builds never honour the override.
 */
export const MAINNET_WRITES_ENABLED: boolean =
	MAINNET_WRITES_COMMITTED || (import.meta.env?.DEV === true && import.meta.env?.VITE_PENNYPICKER_MAINNET_WRITES === '1');

/** Mainnet per-order cap until the contracts are independently audited: 25.00 PUSD (in cents). */
export const MAINNET_MAX_ORDER_UNITS = 2_500n;

export type DeploymentIds = { pusdCategory: string | undefined; oracleOperatorPkh: string | undefined; oracleCategory: string | undefined };

export const DEPLOYMENTS: Record<NetworkId, DeploymentIds> = { chipnet: CHIPNET_DEPLOYMENT, mainnet: MAINNET_DEPLOYMENT };

/** Public community links. Set the Telegram invite link here (t.me/…) once the group exists. */
export const COMMUNITY = {
	/** Companion project: the other component of the stablecoin design. */
	stakingArenaUrl: 'https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/?network=mainnet#/',
	telegramUrl: 'https://t.me/bethechange_global' as string,
	sourceUrl: 'https://github.com/IbexCreativeLabs/PennyPicker',
	forkedFromUrl: 'https://github.com/2qx/vox'
} as const;

export type MarketId = 'pennypickerusd' | 'paryonusd';

export interface StablecoinMarket {
	id: MarketId;
	name: string;
	symbol: string;
	network: NetworkId;
	/** 'live': trading enabled in this build. 'view-only': shown for information; no transactions. */
	status: 'live' | 'view-only';
	/** Why a view-only market cannot trade yet. */
	statusReason?: string;
	/** Per-order cap in stablecoin base units (cents), if any. */
	maxOrderUnits?: bigint;
	category: string | undefined;
	summary: string;
	links: { label: string; href: string }[];
}

/**
 * Stablecoin markets offered in the selector. Both use the same General Protocols
 * BCH/USD oracle (oracles.cash). A mainnet market trades only once its price record is
 * deployed and MAINNET_WRITES_ENABLED is on.
 */
function mainnetStatus(): Pick<StablecoinMarket, 'status' | 'statusReason'> {
	if (!MAINNET_DEPLOYMENT.oracleCategory || !MAINNET_DEPLOYMENT.oracleOperatorPkh) {
		return { status: 'view-only', statusReason: 'The mainnet price record has not been deployed yet.' };
	}
	if (!MAINNET_WRITES_ENABLED) return { status: 'view-only', statusReason: 'Mainnet trading is switched off in this build.' };
	return { status: 'live' };
}

export const MARKETS: StablecoinMarket[] = [
	{
		id: 'pennypickerusd',
		name: 'PennyPickerUSD',
		symbol: 'PPUSD',
		network: 'chipnet',
		status: 'live',
		category: CHIPNET_DEPLOYMENT.pusdCategory,
		summary: 'Experimental test stablecoin on BCH Chipnet: 1,000,000 fixed supply, priced as 1 USD, no backing. Trade it freely with test coins.',
		links: []
	},
	{
		id: 'paryonusd',
		name: 'ParyonUSD',
		symbol: 'PUSD',
		network: 'mainnet',
		...mainnetStatus(),
		category: PARYONUSD_CATEGORY,
		maxOrderUnits: MAINNET_MAX_ORDER_UNITS,
		summary: 'The BCH-collateralised USD stablecoin on Bitcoin Cash mainnet, priced by the same oracles.cash BCH/USD oracle as PennyPicker. Real money: orders are capped until the contracts are independently audited.',
		links: [
			{ label: 'paryonusd.com', href: 'https://paryonusd.com' },
			{ label: 'Cauldron', href: 'https://app.cauldron.quest/tokens' },
			{ label: 'Stats', href: 'https://stats.paryonusd.com/' }
		]
	}
];
