import {
	createCashonizeClient,
	getApprovedChipnetSession,
	requestChipnetAddresses,
	type CashonizeClient,
	type CashonizeSession
} from '$lib/cashonize/walletconnect';
import { makerPkhFromChipnetAddress } from '$lib/pennypicker/orderCommitment';
import { getAddressUtxos } from '$lib/pennypicker/chain';
import type { ChainUtxo } from '$lib/pennypicker/exchange';

export interface ConnectedWallet {
	client: CashonizeClient;
	session: CashonizeSession;
	address: string;
	pkh: string;
}

/** Use the existing Cashonize Chipnet session (created on /cashonize). */
export async function connectCashonize(): Promise<ConnectedWallet> {
	const client = await createCashonizeClient();
	const session = getApprovedChipnetSession(client);
	if (!session) throw new Error('No Cashonize Chipnet session. Connect on the Cashonize page first.');
	const [address] = await requestChipnetAddresses(client, session);
	if (!address) throw new Error('Cashonize returned no Chipnet address.');
	return { client, session, address, pkh: makerPkhFromChipnetAddress(address) };
}

export interface Balances {
	/** BCH in BCH-only UTXOs (spendable as plain BCH). */
	bchSats: bigint;
	bchConfirmedSats: bigint;
	/** Satoshis carried by token-bearing UTXOs (any category), kept separate. */
	tokenUtxoSats: bigint;
	bchUtxoCount: number;
	tokenUtxoCount: number;
	pusdUnits: bigint;
	pusdConfirmedUnits: bigint;
}

export function balancesOf(utxos: ChainUtxo[], pusdCategory?: string): Balances {
	const confirmed = (utxo: ChainUtxo) => (utxo.height ?? 0) > 0;
	const bch = utxos.filter((utxo) => !utxo.token);
	const pusd = utxos.filter((utxo) => pusdCategory && utxo.token?.category === pusdCategory && !utxo.token.nft);
	const sum = (list: ChainUtxo[], f: (u: ChainUtxo) => bigint) => list.reduce((s, u) => s + f(u), 0n);
	const tokenBearing = utxos.filter((utxo) => !!utxo.token);
	return {
		tokenUtxoSats: sum(tokenBearing, (u) => u.satoshis),
		bchUtxoCount: bch.length,
		tokenUtxoCount: tokenBearing.length,
		bchSats: sum(bch, (u) => u.satoshis),
		bchConfirmedSats: sum(bch.filter(confirmed), (u) => u.satoshis),
		pusdUnits: sum(pusd, (u) => u.token!.amount),
		pusdConfirmedUnits: sum(pusd.filter(confirmed), (u) => u.token!.amount)
	};
}

export { getAddressUtxos };

/** PUSD per BCH, two decimals, from satoshis-per-PUSD × 1e8. */
export function formatPusdPerBch(rateScaled: bigint): string {
	if (rateScaled <= 0n) return '—';
	const cents = (10n ** 18n + rateScaled / 2n) / rateScaled;
	return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** Inverse of formatPusdPerBch for operator input ("512.34" PUSD per BCH). */
export function rateFromPusdPerBch(input: string): bigint {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
	if (!match) throw new Error('Enter PUSD per BCH with at most 2 decimals.');
	const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
	if (cents <= 0n) throw new Error('Price must be positive.');
	return 10n ** 18n / cents;
}

export function parsePusd(value: string): bigint {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!match) throw new Error('Enter a PUSD amount with at most 2 decimals.');
	return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
}

export function parseBch(value: string): bigint {
	const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
	if (!match) throw new Error('Enter a BCH amount with at most 8 decimals.');
	return BigInt(match[1]!) * 100_000_000n + BigInt((match[2] ?? '').padEnd(8, '0') || '0');
}

export function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
