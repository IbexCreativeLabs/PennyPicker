/**
 * PennyPicker exchange transaction builders (pure; no network access).
 *
 * Every builder returns an UNSIGNED transaction plus the libauth source outputs
 * a WalletConnect wallet (Cashonize) needs to sign. Wallet-owned P2PKH inputs
 * carry empty unlocking bytecode; contract inputs that need the wallet's key
 * carry CashScript's zero-filled signature/public-key placeholders. Nothing here
 * signs or broadcasts.
 *
 * Transaction layout conventions (enforced by the covenants):
 *   input 0 / output 0  the oracle-state UTXO (read or update), recreated in place
 *   inputs 1..n         order contracts being filled, continuing at outputs 1..n
 *
 * Order creation also reads the oracle, so every order-creation transaction is in
 * the oracle address history. Together with the OP_RETURN announcement, that
 * makes all orders discoverable from one Electrum address subscription.
 */
import {
	bigIntToVmNumber,
	binToHex,
	cashAddressToLockingBytecode,
	decodeTransaction,
	encodeDataPush,
	encodeTransaction,
	hashTransaction,
	hexToBin,
	lockingBytecodeToCashAddress,
	utf8ToBin,
	vmNumberToBigInt,
	type Input,
	type Output,
	type TransactionCommon
} from '@bitauth/libauth';
import orderArtifact from './contracts/PennyPickerOrder.json';
import oracleArtifact from './contracts/PennyPickerOracle.json';
import {
	buyFillTakeSats,
	concat,
	decodeOracleCommitment,
	encodeOracleCommitment,
	oracleContract,
	oracleReadUnlocking,
	oracleUpdateUnlocking,
	orderCancelUnlocking,
	orderContract,
	orderFillUnlocking,
	sellFillPaymentSats,
	settlementSatisfied,
	type ContractInstance,
	type OracleState,
	type OrderContractParams
} from './contracts';
import { assertSideDelta, MAX_TOKEN_UNITS, type OrderSide } from './market';

export const CHIPNET_PREFIX = 'bchtest';
export const ORDER_ANNOUNCEMENT_PREFIX = utf8ToBin('PPKR');
export const ORDER_ANNOUNCEMENT_VERSION = 1;
/** Satoshis kept on token-carrying outputs and on the oracle state. */
export const TOKEN_OUTPUT_SATOSHIS = 1_000n;
export const ORACLE_OUTPUT_SATOSHIS = 1_000n;
export const MIN_CHANGE_SATOSHIS = 800n;
/** Minimum BCH escrow for a buy order (covers continuation dust after fills). */
export const MIN_BUY_ESCROW_SATOSHIS = 10_000n;
export const FEE_SATS_PER_BYTE = 1n;
/** Size allowance for a Schnorr P2PKH unlocking script the wallet adds. */
const P2PKH_UNLOCK_BYTES = 100n;
const FEE_MARGIN_BYTES = 30n;

export interface MarketConfig {
	pusdCategory: string;
	oracleCategory: string;
	oracleOperatorPkh: string;
}

/** A spendable output with its outpoint, as returned by Electrum listunspent. */
export interface ChainUtxo {
	txid: string;
	vout: number;
	satoshis: bigint;
	height?: number;
	token?: {
		category: string;
		amount: bigint;
		nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string };
	};
}

export interface ContractInfo {
	abiFunction: { name: string; inputs: { name: string; type: string }[] };
	redeemScript: Uint8Array;
	artifact: {
		contractName: string;
		constructorInputs: { name: string; type: string }[];
		abi: { name: string; inputs: { name: string; type: string }[] }[];
		compiler: { name: string; version: string };
		updatedAt: string;
	};
}

export type WcSourceOutput = Input & Output & { contract?: ContractInfo };

export interface UnsignedExchangeTransaction {
	kind: 'oracle-genesis' | 'oracle-update' | 'order-create' | 'order-fill' | 'order-cancel';
	transaction: TransactionCommon;
	unsignedHex: string;
	sourceOutputs: WcSourceOutput[];
	feeSatoshis: bigint;
	summary: string[];
	/** Category created by a genesis transaction (display hex). */
	createdCategory?: string;
	order?: AnnouncedOrder;
}

// ---------------------------------------------------------------- helpers

export function p2pkhLockingBytecode(pkh: string): Uint8Array {
	return concat([Uint8Array.of(0x76, 0xa9, 0x14), hexToBin(pkh), Uint8Array.of(0x88, 0xac)]);
}

export function addressToLockingBytecode(address: string): Uint8Array {
	const decoded = cashAddressToLockingBytecode(address);
	if (typeof decoded === 'string') throw new Error(`Invalid address: ${decoded}`);
	return decoded.bytecode;
}

export function lockingBytecodeToChipnetAddress(bytecode: Uint8Array, tokenSupport = false): string {
	const result = lockingBytecodeToCashAddress({ prefix: CHIPNET_PREFIX, bytecode, tokenSupport });
	if (typeof result === 'string') throw new Error(`Cannot encode address: ${result}`);
	return result.address;
}

export function contractAddress(instance: ContractInstance, tokenSupport = true): string {
	return lockingBytecodeToChipnetAddress(instance.lockingBytecode, tokenSupport);
}

function utxoToOutput(utxo: ChainUtxo, lockingBytecode: Uint8Array): Output {
	return {
		lockingBytecode,
		valueSatoshis: utxo.satoshis,
		...(utxo.token
			? {
					token: {
						category: hexToBin(utxo.token.category),
						amount: utxo.token.amount,
						...(utxo.token.nft
							? {
									nft: {
										capability: utxo.token.nft.capability,
										commitment: hexToBin(utxo.token.nft.commitment)
									}
								}
							: {})
					}
				}
			: {})
	};
}

function utxoToInput(utxo: ChainUtxo, unlockingBytecode: Uint8Array): Input {
	return {
		outpointTransactionHash: hexToBin(utxo.txid),
		outpointIndex: utxo.vout,
		sequenceNumber: 0,
		unlockingBytecode
	};
}

function source(input: Input, output: Output, contract?: ContractInfo): WcSourceOutput {
	return { ...input, ...output, ...(contract ? { contract } : {}) };
}

function contractInfo(
	artifact: typeof orderArtifact | typeof oracleArtifact,
	functionName: string,
	instance: ContractInstance
): ContractInfo {
	const abiFunction = artifact.abi.find((entry) => entry.name === functionName);
	if (!abiFunction) throw new Error(`Unknown contract function ${functionName}.`);
	return {
		abiFunction,
		redeemScript: instance.redeemScript,
		artifact: {
			contractName: artifact.contractName,
			constructorInputs: artifact.constructorInputs,
			abi: artifact.abi,
			compiler: artifact.compiler,
			updatedAt: artifact.updatedAt
		}
	};
}

function opReturn(chunks: Uint8Array[]): Output {
	return {
		lockingBytecode: concat([Uint8Array.of(0x6a), ...chunks.map((chunk) => encodeDataPush(chunk))]),
		valueSatoshis: 0n
	};
}

function sumValue(items: { valueSatoshis: bigint }[]): bigint {
	return items.reduce((sum, item) => sum + item.valueSatoshis, 0n);
}

function sortLargestFirst(utxos: ChainUtxo[]): ChainUtxo[] {
	return [...utxos].sort((a, b) => (a.satoshis === b.satoshis ? 0 : a.satoshis > b.satoshis ? -1 : 1));
}

function bchOnly(utxos: ChainUtxo[]): ChainUtxo[] {
	return sortLargestFirst(utxos.filter((utxo) => !utxo.token));
}

function pusdUtxos(utxos: ChainUtxo[], pusdCategory: string): ChainUtxo[] {
	return utxos
		.filter((utxo) => utxo.token?.category === pusdCategory && !utxo.token.nft && utxo.token.amount > 0n)
		.sort((a, b) => (a.token!.amount === b.token!.amount ? 0 : a.token!.amount > b.token!.amount ? -1 : 1));
}

/**
 * Add wallet BCH inputs and a change output until the transaction pays its fee.
 * Fee estimate: serialized size with empty P2PKH unlocking scripts plus a fixed
 * allowance per wallet signature.
 */
function fundWithWalletBch(
	tx: TransactionCommon,
	sources: WcSourceOutput[],
	walletUtxos: ChainUtxo[],
	walletLocking: Uint8Array,
	alreadyUsed: Set<string>
): bigint {
	const candidates = bchOnly(walletUtxos).filter((utxo) => !alreadyUsed.has(`${utxo.txid}:${utxo.vout}`));
	const changeOutput: Output = { lockingBytecode: walletLocking, valueSatoshis: 0n };
	tx.outputs.push(changeOutput);
	for (;;) {
		const walletInputs = sources.filter((entry) => !entry.contract).length;
		const size =
			BigInt(encodeTransaction(tx).length) + BigInt(walletInputs) * P2PKH_UNLOCK_BYTES + FEE_MARGIN_BYTES;
		const fee = size * FEE_SATS_PER_BYTE;
		const outputsWithoutChange = sumValue(tx.outputs) - changeOutput.valueSatoshis;
		const available = sumValue(sources) - outputsWithoutChange - fee;
		if (available >= MIN_CHANGE_SATOSHIS) {
			changeOutput.valueSatoshis = available;
			return fee;
		}
		if (available >= 0n) {
			// Change would be dust: give it to the fee instead.
			tx.outputs.splice(tx.outputs.indexOf(changeOutput), 1);
			return available + fee;
		}
		const next = candidates.shift();
		if (!next) {
			throw new Error(
				`Insufficient BCH in the connected wallet: short by ${(-available).toString()} satoshis (including fee).`
			);
		}
		alreadyUsed.add(`${next.txid}:${next.vout}`);
		const input = utxoToInput(next, new Uint8Array());
		tx.inputs.push(input);
		sources.push(source(input, utxoToOutput(next, walletLocking)));
	}
}

function finish(
	kind: UnsignedExchangeTransaction['kind'],
	tx: TransactionCommon,
	sources: WcSourceOutput[],
	fee: bigint,
	summary: string[],
	extra: Partial<UnsignedExchangeTransaction> = {}
): UnsignedExchangeTransaction {
	if (tx.inputs.length !== sources.length) throw new Error('Input and source-output counts differ.');
	assertTokenConservation(tx, sources);
	return {
		kind,
		transaction: tx,
		unsignedHex: binToHex(encodeTransaction(tx)),
		sourceOutputs: sources,
		feeSatoshis: fee,
		summary: [...summary, `Network fee ≈ ${fee.toString()} sats`],
		...extra
	};
}

/** Fungible amounts may only be burned explicitly; this builder never burns. */
function assertTokenConservation(tx: TransactionCommon, sources: Output[], allowGenesisOf?: string) {
	const totals = new Map<string, bigint>();
	for (const entry of sources) {
		if (!entry.token) continue;
		const key = binToHex(entry.token.category);
		totals.set(key, (totals.get(key) ?? 0n) + entry.token.amount);
	}
	for (const output of tx.outputs) {
		if (!output.token) continue;
		const key = binToHex(output.token.category);
		if (key === allowGenesisOf) continue;
		totals.set(key, (totals.get(key) ?? 0n) - output.token.amount);
	}
	for (const [category, remaining] of totals) {
		if (remaining !== 0n) {
			throw new Error(`Token amounts for ${category.slice(0, 12)}… are not conserved (${remaining.toString()}).`);
		}
	}
}

// ---------------------------------------------------------------- oracle

export interface OracleUtxo extends ChainUtxo {
	state: OracleState;
}

/** Locate the authentic oracle state among UTXOs at the oracle contract address. */
export function findOracleUtxo(utxos: ChainUtxo[], market: MarketConfig): OracleUtxo | undefined {
	const matches = utxos.filter(
		(utxo) =>
			utxo.token?.category === market.oracleCategory &&
			utxo.token.nft?.capability === 'mutable'
	);
	if (matches.length > 1) throw new Error('More than one oracle-state NFT found; refusing to choose.');
	const match = matches[0];
	if (!match) return undefined;
	return { ...match, state: decodeOracleCommitment(hexToBin(match.token!.nft!.commitment)) };
}

function oracleReadInput(oracle: OracleUtxo, market: MarketConfig) {
	const instance = oracleContract({ operatorPkh: market.oracleOperatorPkh });
	const input = utxoToInput(oracle, oracleReadUnlocking(instance));
	const output = utxoToOutput(oracle, instance.lockingBytecode);
	return {
		input,
		source: source(input, output, contractInfo(oracleArtifact, 'read', instance)),
		output: { ...output }
	};
}

/**
 * Create the oracle category: spends a wallet vout-0 BCH UTXO and sends the
 * category's only token, a mutable NFT holding the first price, to the oracle
 * contract. No minting baton is created.
 */
export function buildOracleGenesis(
	operatorAddress: string,
	operatorPkh: string,
	walletUtxos: ChainUtxo[],
	initial: OracleState
): UnsignedExchangeTransaction {
	const walletLocking = addressToLockingBytecode(operatorAddress);
	if (binToHex(walletLocking) !== binToHex(p2pkhLockingBytecode(operatorPkh))) {
		throw new Error('Operator hash does not match the connected P2PKH address.');
	}
	const genesisInput = bchOnly(walletUtxos).find((utxo) => utxo.vout === 0);
	if (!genesisInput) {
		throw new Error('Oracle genesis needs a BCH-only UTXO at output index 0 in the connected wallet.');
	}
	const category = genesisInput.txid;
	const instance = oracleContract({ operatorPkh });
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [], outputs: [] };
	const sources: WcSourceOutput[] = [];
	const input = utxoToInput(genesisInput, new Uint8Array());
	tx.inputs.push(input);
	sources.push(source(input, utxoToOutput(genesisInput, walletLocking)));
	tx.outputs.push({
		lockingBytecode: instance.lockingBytecode,
		valueSatoshis: ORACLE_OUTPUT_SATOSHIS,
		token: {
			category: hexToBin(category),
			amount: 0n,
			nft: { capability: 'mutable', commitment: encodeOracleCommitment(initial) }
		}
	});
	const used = new Set([`${genesisInput.txid}:${genesisInput.vout}`]);
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
	// Genesis output is new; exclude it from conservation.
	assertTokenConservation(tx, sources, category);
	return {
		kind: 'oracle-genesis',
		transaction: tx,
		unsignedHex: binToHex(encodeTransaction(tx)),
		sourceOutputs: sources,
		feeSatoshis: fee,
		createdCategory: category,
		summary: [
			`Create oracle category ${category}`,
			`Mutable NFT → oracle contract ${contractAddress(instance)}`,
			`Initial rate ${initial.rateSatsPerPusdScaled.toString()} (sats/PUSD × 1e8), sequence ${initial.sequence}`,
			'No minting baton is created.',
			`Network fee ≈ ${fee.toString()} sats`
		]
	};
}

/** Operator publishes a new reference price (wallet signs the placeholder). */
export function buildOracleUpdate(
	market: MarketConfig,
	oracle: OracleUtxo,
	operatorAddress: string,
	walletUtxos: ChainUtxo[],
	next: OracleState
): UnsignedExchangeTransaction {
	if (next.sequence <= oracle.state.sequence) throw new Error('Sequence must increase.');
	if (next.timestamp < oracle.state.timestamp) throw new Error('Timestamp cannot move backwards.');
	const walletLocking = addressToLockingBytecode(operatorAddress);
	if (binToHex(walletLocking) !== binToHex(p2pkhLockingBytecode(market.oracleOperatorPkh))) {
		throw new Error('The connected address is not the oracle operator.');
	}
	const instance = oracleContract({ operatorPkh: market.oracleOperatorPkh });
	const input = utxoToInput(oracle, oracleUpdateUnlocking(instance));
	const prev = utxoToOutput(oracle, instance.lockingBytecode);
	const tx: TransactionCommon = {
		version: 2,
		locktime: 0,
		inputs: [input],
		outputs: [
			{
				...prev,
				token: { ...prev.token!, nft: { capability: 'mutable', commitment: encodeOracleCommitment(next) } }
			}
		]
	};
	const sources = [source(input, prev, contractInfo(oracleArtifact, 'update', instance))];
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, new Set());
	return finish('oracle-update', tx, sources, fee, [
		`Update reference rate ${oracle.state.rateSatsPerPusdScaled.toString()} → ${next.rateSatsPerPusdScaled.toString()} (sats/PUSD × 1e8)`,
		`Sequence ${oracle.state.sequence} → ${next.sequence}`
	]);
}

// ---------------------------------------------------------------- orders

export interface AnnouncedOrder {
	side: OrderSide;
	deltaBps: number;
	targetUnits: bigint;
	makerPkh: string;
	lockingBytecodeHex: string;
	address: string;
	/** Creation outpoint, when known. */
	createdTxid?: string;
}

export function orderParams(market: MarketConfig, order: Pick<AnnouncedOrder, 'side' | 'deltaBps' | 'targetUnits' | 'makerPkh'>): OrderContractParams {
	return {
		oracleCategory: market.oracleCategory,
		pusdCategory: market.pusdCategory,
		makerPkh: order.makerPkh,
		side: order.side,
		deltaBps: order.deltaBps,
		targetUnits: order.targetUnits
	};
}

export function describeOrder(market: MarketConfig, order: Pick<AnnouncedOrder, 'side' | 'deltaBps' | 'targetUnits' | 'makerPkh'>): AnnouncedOrder {
	const instance = orderContract(orderParams(market, order));
	return {
		...order,
		lockingBytecodeHex: binToHex(instance.lockingBytecode),
		address: contractAddress(instance)
	};
}

function announcement(order: AnnouncedOrder): Output {
	return opReturn([
		ORDER_ANNOUNCEMENT_PREFIX,
		Uint8Array.of(ORDER_ANNOUNCEMENT_VERSION),
		Uint8Array.of(order.side === 'buy-pusd' ? 0 : 1),
		bigIntToVmNumber(BigInt(order.deltaBps)),
		bigIntToVmNumber(order.targetUnits),
		hexToBin(order.makerPkh)
	]);
}

/** Parse an order announcement OP_RETURN, or return undefined. */
export function parseAnnouncement(lockingBytecode: Uint8Array): Omit<AnnouncedOrder, 'lockingBytecodeHex' | 'address'> | undefined {
	if (lockingBytecode[0] !== 0x6a) return undefined;
	const chunks: Uint8Array[] = [];
	let offset = 1;
	while (offset < lockingBytecode.length) {
		const opcode = lockingBytecode[offset]!;
		offset++;
		let length: number;
		if (opcode === 0) length = 0;
		else if (opcode >= 1 && opcode <= 75) length = opcode;
		else if (opcode === 0x4c) length = lockingBytecode[offset++]!;
		else if (opcode >= 0x51 && opcode <= 0x60) {
			chunks.push(Uint8Array.of(opcode - 0x50));
			continue;
		} else if (opcode === 0x4f) {
			chunks.push(Uint8Array.of(0x81));
			continue;
		} else return undefined;
		chunks.push(lockingBytecode.slice(offset, offset + length));
		offset += length;
	}
	if (chunks.length !== 6) return undefined;
	const [prefix, version, side, delta, target, maker] = chunks as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
	if (binToHex(prefix) !== binToHex(ORDER_ANNOUNCEMENT_PREFIX)) return undefined;
	if (version.length !== 1 || version[0] !== ORDER_ANNOUNCEMENT_VERSION) return undefined;
	// OP_0 pushes an empty chunk for the buy side; OP_1 is encoded as 0x01.
	const sideValue = side.length === 0 ? 0 : side.length === 1 ? side[0] : -1;
	if (sideValue !== 0 && sideValue !== 1) return undefined;
	if (maker.length !== 20) return undefined;
	const deltaNumber = vmNumberToBigInt(delta, { requireMinimalEncoding: true });
	const targetNumber = vmNumberToBigInt(target, { requireMinimalEncoding: true });
	if (typeof deltaNumber === 'string' || typeof targetNumber === 'string') return undefined;
	const parsed = {
		side: sideValue === 0 ? ('buy-pusd' as const) : ('sell-pusd' as const),
		deltaBps: Number(deltaNumber),
		targetUnits: targetNumber,
		makerPkh: binToHex(maker)
	};
	try {
		assertSideDelta(parsed.side, parsed.deltaBps);
	} catch {
		return undefined;
	}
	if (parsed.targetUnits <= 0n || parsed.targetUnits > MAX_TOKEN_UNITS) return undefined;
	return parsed;
}

export interface CreateOrderRequest {
	side: OrderSide;
	deltaBps: number;
	/** PUSD base units: offered (sell) or wanted (buy). */
	quantityUnits: bigint;
	/** Buy orders: BCH escrow in satoshis. Ignored for sell orders. */
	escrowSatoshis?: bigint;
}

/**
 * Create an order. Reads the oracle (so the order is indexed with the market),
 * locks the escrow in a fresh order contract and announces its parameters.
 */
export function buildCreateOrder(
	market: MarketConfig,
	oracle: OracleUtxo,
	makerAddress: string,
	makerPkh: string,
	walletUtxos: ChainUtxo[],
	request: CreateOrderRequest
): UnsignedExchangeTransaction {
	const walletLocking = addressToLockingBytecode(makerAddress);
	if (binToHex(walletLocking) !== binToHex(p2pkhLockingBytecode(makerPkh))) {
		throw new Error('Maker hash does not match the connected P2PKH address.');
	}
	assertSideDelta(request.side, request.deltaBps);
	if (request.quantityUnits <= 0n || request.quantityUnits > MAX_TOKEN_UNITS) {
		throw new Error('Order quantity must be positive.');
	}
	const order = describeOrder(market, {
		side: request.side,
		deltaBps: request.deltaBps,
		targetUnits: request.quantityUnits,
		makerPkh
	});
	const oracleRead = oracleReadInput(oracle, market);
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [oracleRead.input], outputs: [oracleRead.output] };
	const sources: WcSourceOutput[] = [oracleRead.source];
	const used = new Set<string>();
	const orderLocking = hexToBin(order.lockingBytecodeHex);
	const summary: string[] = [];

	if (request.side === 'sell-pusd') {
		let gathered = 0n;
		for (const utxo of pusdUtxos(walletUtxos, market.pusdCategory)) {
			if (gathered >= request.quantityUnits) break;
			const input = utxoToInput(utxo, new Uint8Array());
			tx.inputs.push(input);
			sources.push(source(input, utxoToOutput(utxo, walletLocking)));
			used.add(`${utxo.txid}:${utxo.vout}`);
			gathered += utxo.token!.amount;
		}
		if (gathered < request.quantityUnits) {
			throw new Error('Insufficient PUSD in the connected wallet for this sell order.');
		}
		tx.outputs.push({
			lockingBytecode: orderLocking,
			valueSatoshis: TOKEN_OUTPUT_SATOSHIS,
			token: { category: hexToBin(market.pusdCategory), amount: request.quantityUnits }
		});
		tx.outputs.push(announcement(order));
		if (gathered > request.quantityUnits) {
			tx.outputs.push({
				lockingBytecode: walletLocking,
				valueSatoshis: TOKEN_OUTPUT_SATOSHIS,
				token: { category: hexToBin(market.pusdCategory), amount: gathered - request.quantityUnits }
			});
		}
		summary.push(`Escrow ${request.quantityUnits.toString()} PUSD units in sell order ${order.address}`);
	} else {
		const escrow = request.escrowSatoshis ?? 0n;
		if (escrow < MIN_BUY_ESCROW_SATOSHIS) {
			throw new Error(`Buy orders need at least ${MIN_BUY_ESCROW_SATOSHIS.toString()} sats of BCH escrow.`);
		}
		tx.outputs.push({ lockingBytecode: orderLocking, valueSatoshis: escrow });
		tx.outputs.push(announcement(order));
		summary.push(`Escrow ${escrow.toString()} sats BCH in buy order ${order.address}`);
	}
	summary.unshift(
		`${request.side === 'buy-pusd' ? 'Buy' : 'Sell'} ${request.quantityUnits.toString()} PUSD units at ${request.deltaBps >= 0 ? '+' : ''}${request.deltaBps} BPS from the oracle reference`
	);
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
	return finish('order-create', tx, sources, fee, summary, { order });
}

/** A live order UTXO with its decoded parameters. */
export interface OpenOrder extends AnnouncedOrder {
	utxo: ChainUtxo;
	/** PUSD units held by the order UTXO. */
	heldUnits: bigint;
	/** PUSD units still fillable. */
	remainingUnits: bigint;
}

export function toOpenOrder(order: AnnouncedOrder, utxo: ChainUtxo, market: MarketConfig): OpenOrder | undefined {
	if (utxo.token && (utxo.token.category !== market.pusdCategory || utxo.token.nft)) return undefined;
	const heldUnits = utxo.token?.amount ?? 0n;
	const remainingUnits =
		order.side === 'sell-pusd' ? heldUnits : order.targetUnits > heldUnits ? order.targetUnits - heldUnits : 0n;
	return { ...order, utxo, heldUnits, remainingUnits };
}

export interface FillLeg {
	order: OpenOrder;
	units: bigint;
}

/** Quote one leg against the current oracle rate (exact covenant rounding). */
export function quoteLeg(leg: FillLeg, oracleRate: bigint): { satoshis: bigint; nextValue: bigint; nextUnits: bigint } {
	const { order, units } = leg;
	if (units <= 0n || units > order.remainingUnits) throw new Error('Fill quantity exceeds the order’s remaining quantity.');
	if (order.side === 'sell-pusd') {
		const pay = sellFillPaymentSats(units, oracleRate, order.deltaBps);
		const nextValue = order.utxo.satoshis + pay;
		const nextUnits = order.heldUnits - units;
		if (!settlementSatisfied(pay, -units, oracleRate, order.deltaBps)) throw new Error('Internal settlement check failed.');
		return { satoshis: pay, nextValue, nextUnits };
	}
	const take = buyFillTakeSats(units, oracleRate, order.deltaBps);
	const nextValue = order.utxo.satoshis - take;
	if (nextValue < TOKEN_OUTPUT_SATOSHIS) {
		throw new Error('This buy order’s BCH escrow cannot cover that quantity at the current reference price.');
	}
	if (!settlementSatisfied(-take, units, oracleRate, order.deltaBps)) throw new Error('Internal settlement check failed.');
	return { satoshis: take, nextValue, nextUnits: order.heldUnits + units };
}

/**
 * Fill one or more orders on the same side. Taking sell orders buys PUSD with
 * BCH; taking buy orders sells PUSD for BCH.
 */
export function buildFillOrders(
	market: MarketConfig,
	oracle: OracleUtxo,
	takerAddress: string,
	walletUtxos: ChainUtxo[],
	legs: FillLeg[]
): UnsignedExchangeTransaction {
	if (legs.length === 0) throw new Error('Select at least one order to fill.');
	const side = legs[0]!.order.side;
	if (legs.some((leg) => leg.order.side !== side)) throw new Error('All filled orders must be on the same side.');
	const walletLocking = addressToLockingBytecode(takerAddress);
	const rate = oracle.state.rateSatsPerPusdScaled;
	const oracleRead = oracleReadInput(oracle, market);
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [oracleRead.input], outputs: [oracleRead.output] };
	const sources: WcSourceOutput[] = [oracleRead.source];
	const pusd = hexToBin(market.pusdCategory);
	let totalUnits = 0n;
	let totalSats = 0n;
	const summary: string[] = [];
	const seen = new Set<string>();
	for (const leg of legs) {
		const key = `${leg.order.utxo.txid}:${leg.order.utxo.vout}`;
		if (seen.has(key)) throw new Error('The same order cannot be filled twice in one transaction.');
		seen.add(key);
		const instance = orderContract(orderParams(market, leg.order));
		if (binToHex(instance.lockingBytecode) !== leg.order.lockingBytecodeHex) {
			throw new Error('Order parameters do not match its contract address.');
		}
		const quote = quoteLeg(leg, rate);
		const input = utxoToInput(leg.order.utxo, orderFillUnlocking(instance));
		tx.inputs.push(input);
		sources.push(source(input, utxoToOutput(leg.order.utxo, instance.lockingBytecode), contractInfo(orderArtifact, 'fill', instance)));
		tx.outputs.push({
			lockingBytecode: instance.lockingBytecode,
			valueSatoshis: quote.nextValue,
			...(quote.nextUnits > 0n ? { token: { category: pusd, amount: quote.nextUnits } } : {})
		});
		totalUnits += leg.units;
		totalSats += quote.satoshis;
		summary.push(
			`${side === 'sell-pusd' ? 'Buy' : 'Sell'} ${leg.units.toString()} PUSD units ${side === 'sell-pusd' ? 'from' : 'to'} order ${leg.order.address.slice(0, 22)}… for ${quote.satoshis.toString()} sats`
		);
	}
	const used = new Set<string>();
	if (side === 'sell-pusd') {
		// Taker receives the PUSD released by the orders; pays BCH from the wallet.
		tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category: pusd, amount: totalUnits } });
		summary.push(`You receive ${totalUnits.toString()} PUSD units and pay ${totalSats.toString()} sats`);
	} else {
		// Taker delivers PUSD from the wallet and receives BCH released by the orders (via change).
		let gathered = 0n;
		for (const utxo of pusdUtxos(walletUtxos, market.pusdCategory)) {
			if (gathered >= totalUnits) break;
			const input = utxoToInput(utxo, new Uint8Array());
			tx.inputs.push(input);
			sources.push(source(input, utxoToOutput(utxo, walletLocking)));
			used.add(`${utxo.txid}:${utxo.vout}`);
			gathered += utxo.token!.amount;
		}
		if (gathered < totalUnits) throw new Error('Insufficient PUSD in the connected wallet to fill these buy orders.');
		if (gathered > totalUnits) {
			tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category: pusd, amount: gathered - totalUnits } });
		}
		summary.push(`You deliver ${totalUnits.toString()} PUSD units and receive ${totalSats.toString()} sats (in change)`);
	}
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
	return finish('order-fill', tx, sources, fee, summary);
}

/** Maker withdraws an order's escrow and proceeds back to the maker address. */
export function buildCancelOrder(
	market: MarketConfig,
	order: OpenOrder,
	makerAddress: string,
	walletUtxos: ChainUtxo[]
): UnsignedExchangeTransaction {
	const walletLocking = addressToLockingBytecode(makerAddress);
	if (binToHex(walletLocking) !== binToHex(p2pkhLockingBytecode(order.makerPkh))) {
		throw new Error('Only the maker’s address can cancel this order.');
	}
	const instance = orderContract(orderParams(market, order));
	const input = utxoToInput(order.utxo, orderCancelUnlocking(instance));
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [input], outputs: [] };
	const sources: WcSourceOutput[] = [
		source(input, utxoToOutput(order.utxo, instance.lockingBytecode), contractInfo(orderArtifact, 'cancel', instance))
	];
	if (order.heldUnits > 0n) {
		tx.outputs.push({
			lockingBytecode: walletLocking,
			valueSatoshis: TOKEN_OUTPUT_SATOSHIS,
			token: { category: hexToBin(market.pusdCategory), amount: order.heldUnits }
		});
	}
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, new Set());
	return finish('order-cancel', tx, sources, fee, [
		`Cancel order ${order.address}`,
		`Return ${order.utxo.satoshis.toString()} sats and ${order.heldUnits.toString()} PUSD units to ${makerAddress}`
	]);
}

// ---------------------------------------------------------------- signing checks

/**
 * Confirm a wallet-signed transaction spends exactly the previewed outpoints and
 * creates exactly the previewed outputs. Returns the transaction id.
 */
export function verifySignedMatchesUnsigned(unsigned: UnsignedExchangeTransaction, signedHex: string, walletHash: string): string {
	const signed = decodeSigned(signedHex);
	const a = unsigned.transaction;
	if (signed.version !== a.version || signed.locktime !== a.locktime) throw new Error('Signed version/locktime differ from the preview.');
	if (signed.inputs.length !== a.inputs.length) throw new Error('Signed input count differs from the preview.');
	signed.inputs.forEach((input, index) => {
		const expected = a.inputs[index]!;
		if (
			binToHex(input.outpointTransactionHash) !== binToHex(expected.outpointTransactionHash) ||
			input.outpointIndex !== expected.outpointIndex ||
			input.sequenceNumber !== expected.sequenceNumber
		) {
			throw new Error(`Signed input ${index} differs from the preview.`);
		}
	});
	const outputs = (tx: TransactionCommon) => binToHex(encodeTransaction({ ...tx, inputs: [] }));
	if (outputs(signed) !== outputs(a)) throw new Error('Signed outputs differ from the preview.');
	const txid = hashTransaction(hexToBin(signedHex));
	if (txid !== walletHash) throw new Error('Wallet-reported transaction hash does not match the signed bytes.');
	return txid;
}

function decodeSigned(hex: string): TransactionCommon {
	const decoded = decodeTransaction(hexToBin(hex));
	if (typeof decoded === 'string') throw new Error(`Cannot decode signed transaction: ${decoded}`);
	return decoded;
}
