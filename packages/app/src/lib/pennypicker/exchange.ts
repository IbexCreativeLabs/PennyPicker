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
	decodeCashAddress,
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
	askFillUnitsDue,
	assertOrderDelta,
	bidFillUnitsOut,
	concat,
	decodeOracleCommitment,
	encodeOracleCommitment,
	formatPrice,
	MAX_TOKEN_UNITS,
	oracleContract,
	oracleReadUnlocking,
	oracleUpdateUnlocking,
	oracleStateFromMessage,
	type OracleMessage,
	orderCancelUnlocking,
	orderContract,
	orderFillUnlocking,
	settlementSatisfied,
	type ContractInstance,
	type OracleState,
	type OrderContractParams,
	type OrderSide
} from './contracts';

export type { OrderSide };

export const CHIPNET_PREFIX = 'bchtest';
export const ORDER_ANNOUNCEMENT_PREFIX = utf8ToBin('PPKR');
export const ORDER_ANNOUNCEMENT_VERSION = 2;
/** Satoshis kept on token-carrying outputs and on the oracle state. */
export const TOKEN_OUTPUT_SATOSHIS = 1_000n;
export const ORACLE_OUTPUT_SATOSHIS = 1_000n;
export const MIN_CHANGE_SATOSHIS = 800n;
/** BCH every order UTXO keeps so its continuation output stays above dust. */
export const ORDER_RESERVE_SATOSHIS = 1_000n;
/** Smallest ask (BCH sold) and smallest fill, to avoid dust-sized trades. */
export const MIN_TRADE_SATOSHIS = 5_000n;
export const FEE_SATS_PER_BYTE = 1n;
/** Size allowance for a Schnorr P2PKH unlocking script the wallet adds. */
const P2PKH_UNLOCK_BYTES = 100n;
const FEE_MARGIN_BYTES = 30n;

export interface MarketConfig {
	pusdCategory: string;
	oracleCategory: string;
	/** Wallet that created the oracle; names the oracle contract instance. */
	oracleOperatorPkh: string;
	/** Price oracle whose signed messages update the state (default: oracles.cash BCH/USD). */
	oraclePublicKey?: string;
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
	/**
	 * Set when this output is (or, if the authchain could not be resolved, may be)
	 * a token identity output. Ordinary builders never spend it.
	 */
	identityOf?: string;
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
	kind: 'oracle-genesis' | 'oracle-update' | 'order-create' | 'order-fill' | 'order-cancel' | 'pusd-send' | 'identity-separation' | 'pusd-genesis';
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

function utxoToInput(utxo: ChainUtxo, unlockingBytecode: Uint8Array, allowIdentity = false): Input {
	if (utxo.identityOf && !allowIdentity) {
		// Backstop: selection helpers already skip identity outputs.
		throw new Error(
			`Refusing to spend ${utxo.txid.slice(0, 12)}…:${utxo.vout}: it holds a token identity (${utxo.identityOf.slice(0, 12)}…). Use the identity separation tool.`
		);
	}
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

/** Wallet outputs ordinary transactions may spend: never a token identity output. */
function spendable(utxos: ChainUtxo[]): ChainUtxo[] {
	return utxos.filter((utxo) => !utxo.identityOf);
}

function bchOnly(utxos: ChainUtxo[]): ChainUtxo[] {
	return sortLargestFirst(spendable(utxos).filter((utxo) => !utxo.token));
}

function pusdUtxos(utxos: ChainUtxo[], pusdCategory: string): ChainUtxo[] {
	return spendable(utxos)
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
				`Insufficient BCH in the connected wallet: short by ${(-available).toString()} satoshis (including fee). Get Chipnet tBCH from a faucet.`
			);
		}
		alreadyUsed.add(`${next.txid}:${next.vout}`);
		const input = utxoToInput(next, new Uint8Array());
		tx.inputs.push(input);
		sources.push(source(input, utxoToOutput(next, walletLocking)));
	}
}

/**
 * Oracle updates and order cancels are authorised by an ordinary P2PKH input
 * from the operator/maker placed directly after the contract input. The wallet
 * signs it like any other input; no contract-signature placeholders are needed.
 */
function addAuthorisationInput(
	tx: TransactionCommon,
	sources: WcSourceOutput[],
	walletUtxos: ChainUtxo[],
	walletLocking: Uint8Array,
	used: Set<string>,
	role: string
): void {
	const utxo = bchOnly(walletUtxos).find((candidate) => !used.has(`${candidate.txid}:${candidate.vout}`));
	if (!utxo) throw new Error(`The ${role} needs a BCH-only UTXO in the connected wallet to authorise this transaction.`);
	used.add(`${utxo.txid}:${utxo.vout}`);
	const input = utxoToInput(utxo, new Uint8Array());
	tx.inputs.push(input);
	sources.push(source(input, utxoToOutput(utxo, walletLocking)));
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
		(utxo) => utxo.token?.category === market.oracleCategory && utxo.token.nft?.capability === 'mutable'
	);
	if (matches.length > 1) throw new Error('More than one oracle-state NFT found; refusing to choose.');
	const match = matches[0];
	if (!match) return undefined;
	return { ...match, state: decodeOracleCommitment(hexToBin(match.token!.nft!.commitment)) };
}

/**
 * The oracle input/output pair every create and fill carries at index 0.
 * With a newer signed oracle message, the state is moved forward in the same
 * transaction (update); otherwise it is read and recreated unchanged.
 */
function oracleInput(oracle: OracleUtxo, market: MarketConfig, refresh?: OracleMessage) {
	const instance = oracleContract({ operatorPkh: market.oracleOperatorPkh, oraclePublicKey: market.oraclePublicKey });
	const prev = utxoToOutput(oracle, instance.lockingBytecode);
	if (refresh && refresh.messageSequence > oracle.state.sequence) {
		const state = oracleStateFromMessage(refresh);
		const input = utxoToInput(oracle, oracleUpdateUnlocking(instance, refresh.signature, refresh.message));
		return {
			input,
			source: source(input, prev, contractInfo(oracleArtifact, 'update', instance)),
			output: { ...prev, token: { ...prev.token!, nft: { capability: 'mutable' as const, commitment: encodeOracleCommitment(state) } } },
			state,
			refreshed: true
		};
	}
	const input = utxoToInput(oracle, oracleReadUnlocking(instance));
	return { input, source: source(input, prev, contractInfo(oracleArtifact, 'read', instance)), output: { ...prev }, state: oracle.state, refreshed: false };
}

/**
 * Create the oracle category: spends a confirmed wallet vout-0 BCH UTXO and
 * sends the category's only token, a mutable NFT holding the first price, to
 * the oracle contract. No minting baton is created.
 */
export function buildOracleGenesis(
	operatorAddress: string,
	operatorPkh: string,
	walletUtxos: ChainUtxo[],
	initial: OracleState,
	oraclePublicKey?: string
): UnsignedExchangeTransaction {
	const walletLocking = addressToLockingBytecode(operatorAddress);
	if (binToHex(walletLocking) !== binToHex(p2pkhLockingBytecode(operatorPkh))) {
		throw new Error('Operator hash does not match the connected P2PKH address.');
	}
	// Unconfirmed is fine: the category is the parent txid, which is fixed once signed.
	const genesisInput = genesisInputOf(walletUtxos);
	if (!genesisInput) {
		throw new Error('Oracle genesis needs a BCH-only UTXO at output index 0 in the connected wallet. Receive a payment (it lands at output 0) and try again.');
	}
	const category = genesisInput.txid;
	const instance = oracleContract({ operatorPkh, oraclePublicKey });
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
	// Spend only the genesis input; it must cover the oracle output and fee.
	const fee = fundWithWalletBch(tx, sources, [], walletLocking, used);
	assertTokenConservation(tx, sources, category);
	return {
		kind: 'oracle-genesis',
		transaction: tx,
		unsignedHex: binToHex(encodeTransaction(tx)),
		sourceOutputs: sources,
		feeSatoshis: fee,
		createdCategory: category,
		summary: [
			`Create the oracle with a reference price of ${formatPrice(initial.price)} PUSD per BCH (sequence ${initial.sequence})`,
			`Spends ${genesisInput.txid.slice(0, 12)}…:0 · new oracle category = that txid`,
			`One mutable NFT (the price record) goes to the oracle contract; no minting baton`,
			`Network fee ≈ ${fee.toString()} sats`
		]
	};
}

/**
 * Anyone moves the on-chain reference forward with a newer message signed by
 * the price oracle (oracles.cash). The wallet only pays the network fee.
 */
export function buildOracleRefresh(
	market: MarketConfig,
	oracle: OracleUtxo,
	payerAddress: string,
	walletUtxos: ChainUtxo[],
	message: OracleMessage
): UnsignedExchangeTransaction {
	if (message.messageSequence <= oracle.state.sequence) throw new Error('The on-chain price is already at this oracle message or newer.');
	const walletLocking = addressToLockingBytecode(payerAddress);
	const o = oracleInput(oracle, market, message);
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [o.input], outputs: [o.output] };
	const sources: WcSourceOutput[] = [o.source];
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, new Set());
	return finish('oracle-update', tx, sources, fee, [
		`Update the on-chain reference ${formatPrice(oracle.state.price)} → ${formatPrice(o.state.price)} PUSD per BCH from oracles.cash BCH/USD`,
		`Oracle message #${message.messageSequence} (${new Date(message.timestamp * 1000).toLocaleString()}), signature checked by the contract`
	]);
}

// ---------------------------------------------------------------- orders

export interface AnnouncedOrder {
	side: OrderSide;
	deltaBps: number;
	makerPkh: string;
	lockingBytecodeHex: string;
	address: string;
	/** Creation transaction, when known. */
	createdTxid?: string;
}

type OrderTerms = Pick<AnnouncedOrder, 'side' | 'deltaBps' | 'makerPkh'>;

export function orderParams(market: MarketConfig, order: OrderTerms): OrderContractParams {
	return {
		oracleCategory: market.oracleCategory,
		pusdCategory: market.pusdCategory,
		makerPkh: order.makerPkh,
		side: order.side,
		deltaBps: order.deltaBps
	};
}

export function describeOrder(market: MarketConfig, order: OrderTerms): AnnouncedOrder {
	const instance = orderContract(orderParams(market, order));
	return {
		side: order.side,
		deltaBps: order.deltaBps,
		makerPkh: order.makerPkh,
		lockingBytecodeHex: binToHex(instance.lockingBytecode),
		address: contractAddress(instance)
	};
}

/** OP_RETURN "PPKR" | version | side (0 ask, 1 bid) | deltaBps | makerPkh */
function announcement(order: OrderTerms): Output {
	return opReturn([
		ORDER_ANNOUNCEMENT_PREFIX,
		Uint8Array.of(ORDER_ANNOUNCEMENT_VERSION),
		bigIntToVmNumber(order.side === 'ask' ? 0n : 1n),
		bigIntToVmNumber(BigInt(order.deltaBps)),
		hexToBin(order.makerPkh)
	]);
}

/** Parse an order announcement OP_RETURN, or return undefined. */
export function parseAnnouncement(lockingBytecode: Uint8Array): OrderTerms | undefined {
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
		if (offset + length > lockingBytecode.length) return undefined;
		chunks.push(lockingBytecode.slice(offset, offset + length));
		offset += length;
	}
	if (chunks.length !== 5) return undefined;
	const [prefix, version, side, delta, maker] = chunks as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
	if (binToHex(prefix) !== binToHex(ORDER_ANNOUNCEMENT_PREFIX)) return undefined;
	if (version.length !== 1 || version[0] !== ORDER_ANNOUNCEMENT_VERSION) return undefined;
	const sideValue = vmNumberToBigInt(side, { requireMinimalEncoding: true });
	const deltaValue = vmNumberToBigInt(delta, { requireMinimalEncoding: true });
	if (typeof sideValue === 'string' || typeof deltaValue === 'string') return undefined;
	if (sideValue !== 0n && sideValue !== 1n) return undefined;
	if (maker.length !== 20) return undefined;
	const parsed: OrderTerms = {
		side: sideValue === 0n ? 'ask' : 'bid',
		deltaBps: Number(deltaValue),
		makerPkh: binToHex(maker)
	};
	try {
		assertOrderDelta(parsed.side, parsed.deltaBps);
	} catch {
		return undefined;
	}
	return parsed;
}

export interface CreateOrderRequest {
	side: OrderSide;
	deltaBps: number;
	/** Ask: satoshis of BCH to sell. Bid: PUSD base units to spend. */
	amount: bigint;
}

/**
 * Create an order. Reads the oracle (so the order is indexed with the market),
 * locks the escrow in a fresh order contract and announces its terms.
 * Asks escrow BCH (plus a reserve); bids escrow PUSD (plus the reserve).
 */
export function buildCreateOrder(
	market: MarketConfig,
	oracle: OracleUtxo,
	makerAddress: string,
	makerPkh: string,
	walletUtxos: ChainUtxo[],
	request: CreateOrderRequest,
	refresh?: OracleMessage
): UnsignedExchangeTransaction {
	const walletLocking = addressToLockingBytecode(makerAddress);
	if (binToHex(walletLocking) !== binToHex(p2pkhLockingBytecode(makerPkh))) {
		throw new Error('Maker hash does not match the connected P2PKH address.');
	}
	assertOrderDelta(request.side, request.deltaBps);
	const terms = { side: request.side, deltaBps: request.deltaBps, makerPkh };
	const order = describeOrder(market, terms);
	const oracleRead = oracleInput(oracle, market, refresh);
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [oracleRead.input], outputs: [oracleRead.output] };
	const sources: WcSourceOutput[] = [oracleRead.source];
	const used = new Set<string>();
	const orderLocking = hexToBin(order.lockingBytecodeHex);
	const limit = (oracleRead.state.price * (10_000n + BigInt(request.deltaBps))) / 10_000n;
	const summary: string[] = [];

	if (request.side === 'bid') {
		if (request.amount <= 0n || request.amount > MAX_TOKEN_UNITS) throw new Error('Enter a positive PUSD amount.');
		let gathered = 0n;
		for (const utxo of pusdUtxos(walletUtxos, market.pusdCategory)) {
			if (gathered >= request.amount) break;
			const input = utxoToInput(utxo, new Uint8Array());
			tx.inputs.push(input);
			sources.push(source(input, utxoToOutput(utxo, walletLocking)));
			used.add(`${utxo.txid}:${utxo.vout}`);
			gathered += utxo.token!.amount;
		}
		if (gathered < request.amount) throw new Error('Insufficient PUSD in the connected wallet for this bid. Get PUSD by selling BCH into a bid, or ask a teammate to send some (Wallet → Send PUSD).');
		tx.outputs.push({
			lockingBytecode: orderLocking,
			valueSatoshis: ORDER_RESERVE_SATOSHIS,
			token: { category: hexToBin(market.pusdCategory), amount: request.amount }
		});
		tx.outputs.push(announcement(terms));
		if (gathered > request.amount) {
			tx.outputs.push({
				lockingBytecode: walletLocking,
				valueSatoshis: TOKEN_OUTPUT_SATOSHIS,
				token: { category: hexToBin(market.pusdCategory), amount: gathered - request.amount }
			});
		}
		summary.push(
			`Bid: buy BCH with ${formatUnits(request.amount)} PUSD at ${request.deltaBps} BPS (limit now ${formatPrice(limit)} PUSD/BCH)`,
			`Escrows ${formatUnits(request.amount)} PUSD in order contract ${order.address.slice(0, 24)}…`
		);
	} else {
		if (request.amount < MIN_TRADE_SATOSHIS) {
			throw new Error(`Asks must sell at least ${MIN_TRADE_SATOSHIS.toString()} sats of BCH.`);
		}
		tx.outputs.push({ lockingBytecode: orderLocking, valueSatoshis: request.amount + ORDER_RESERVE_SATOSHIS });
		tx.outputs.push(announcement(terms));
		summary.push(
			`Ask: sell ${formatSats(request.amount)} BCH at +${request.deltaBps} BPS (limit now ${formatPrice(limit)} PUSD/BCH)`,
			`Escrows ${formatSats(request.amount + ORDER_RESERVE_SATOSHIS)} BCH (incl. ${ORDER_RESERVE_SATOSHIS} sats reserve) in ${order.address.slice(0, 24)}…`
		);
	}
	summary.push('Reads the oracle (input 0) and announces the order terms in an OP_RETURN');
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
	return finish('order-create', tx, sources, fee, summary, { order });
}

/** A live order UTXO with its decoded terms and balances. */
export interface OpenOrder extends AnnouncedOrder {
	utxo: ChainUtxo;
	/** PUSD base units held by the order UTXO (bid escrow, or ask proceeds). */
	heldUnits: bigint;
	/** Ask: BCH still for sale (sats). Bid: 0. */
	availableSats: bigint;
	/** Bid: PUSD still available to buy BCH with. Ask: 0. */
	availableUnits: bigint;
	/** Maker proceeds collected so far: ask → PUSD units, bid → sats. */
	proceeds: bigint;
	/** True when nothing more can be traded against this order. */
	exhausted: boolean;
}

export function toOpenOrder(order: AnnouncedOrder, utxo: ChainUtxo, market: MarketConfig): OpenOrder | undefined {
	if (utxo.token && (utxo.token.category !== market.pusdCategory || utxo.token.nft)) return undefined;
	const heldUnits = utxo.token?.amount ?? 0n;
	const spare = utxo.satoshis > ORDER_RESERVE_SATOSHIS ? utxo.satoshis - ORDER_RESERVE_SATOSHIS : 0n;
	if (order.side === 'ask') {
		return { ...order, utxo, heldUnits, availableSats: spare, availableUnits: 0n, proceeds: heldUnits, exhausted: spare < MIN_TRADE_SATOSHIS };
	}
	return { ...order, utxo, heldUnits, availableSats: 0n, availableUnits: heldUnits, proceeds: spare, exhausted: heldUnits === 0n };
}

/** A taker leg: trade `sats` of BCH with one order (buy from an ask, sell to a bid). */
export interface FillLeg {
	order: OpenOrder;
	sats: bigint;
}

export interface LegQuote {
	/** PUSD base units the taker pays (ask) or receives (bid). */
	units: bigint;
	nextValue: bigint;
	nextUnits: bigint;
}

/** Quote one leg at the current oracle price with exact covenant rounding. */
export function quoteLeg(leg: FillLeg, price: bigint): LegQuote {
	const { order, sats } = leg;
	if (sats < MIN_TRADE_SATOSHIS) throw new Error(`Each fill must be at least ${MIN_TRADE_SATOSHIS.toString()} sats.`);
	if (order.side === 'ask') {
		if (sats > order.availableSats) throw new Error('That is more BCH than the ask has for sale.');
		const units = askFillUnitsDue(sats, price, order.deltaBps);
		const quote = { units, nextValue: order.utxo.satoshis - sats, nextUnits: order.heldUnits + units };
		if (!settlementSatisfied(-sats, units, price, order.deltaBps)) throw new Error('Internal settlement check failed.');
		return quote;
	}
	const units = bidFillUnitsOut(sats, price, order.deltaBps);
	if (units <= 0n) throw new Error('Fill too small: it would receive 0 PUSD.');
	if (units > order.availableUnits) throw new Error('That bid does not hold enough PUSD for this amount of BCH.');
	if (!settlementSatisfied(sats, -units, price, order.deltaBps)) throw new Error('Internal settlement check failed.');
	return { units, nextValue: order.utxo.satoshis + sats, nextUnits: order.heldUnits - units };
}

/**
 * Fill one or more orders on the same side. Taking asks buys BCH with PUSD;
 * taking bids sells BCH for PUSD.
 */
export function buildFillOrders(
	market: MarketConfig,
	oracle: OracleUtxo,
	takerAddress: string,
	walletUtxos: ChainUtxo[],
	legs: FillLeg[],
	refresh?: OracleMessage
): UnsignedExchangeTransaction {
	if (legs.length === 0) throw new Error('Select at least one order to fill.');
	const side = legs[0]!.order.side;
	if (legs.some((leg) => leg.order.side !== side)) throw new Error('All filled orders must be on the same side.');
	const walletLocking = addressToLockingBytecode(takerAddress);
	const oracleRead = oracleInput(oracle, market, refresh);
	const price = oracleRead.state.price;
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
			throw new Error('Order terms do not match its contract address.');
		}
		const quote = quoteLeg(leg, price);
		const input = utxoToInput(leg.order.utxo, orderFillUnlocking(instance));
		tx.inputs.push(input);
		sources.push(source(input, utxoToOutput(leg.order.utxo, instance.lockingBytecode), contractInfo(orderArtifact, 'fill', instance)));
		tx.outputs.push({
			lockingBytecode: instance.lockingBytecode,
			valueSatoshis: quote.nextValue,
			...(quote.nextUnits > 0n ? { token: { category: pusd, amount: quote.nextUnits } } : {})
		});
		totalUnits += quote.units;
		totalSats += leg.sats;
		summary.push(
			`${side === 'ask' ? 'Buy' : 'Sell'} ${formatSats(leg.sats)} BCH ${side === 'ask' ? 'from ask' : 'to bid'} at ${leg.order.deltaBps > 0 ? '+' : ''}${leg.order.deltaBps} BPS for ${formatUnits(quote.units)} PUSD`
		);
	}
	const used = new Set<string>();
	if (side === 'ask') {
		// Taker pays PUSD; receives the BCH released by the asks via BCH change.
		let gathered = 0n;
		for (const utxo of pusdUtxos(walletUtxos, market.pusdCategory)) {
			if (gathered >= totalUnits) break;
			const input = utxoToInput(utxo, new Uint8Array());
			tx.inputs.push(input);
			sources.push(source(input, utxoToOutput(utxo, walletLocking)));
			used.add(`${utxo.txid}:${utxo.vout}`);
			gathered += utxo.token!.amount;
		}
		if (gathered < totalUnits) throw new Error(`Insufficient PUSD: this purchase costs ${formatUnits(totalUnits)} PUSD. Get PUSD by selling BCH into a bid, or ask a teammate to send some (Wallet → Send PUSD).`);
		if (gathered > totalUnits) {
			tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category: pusd, amount: gathered - totalUnits } });
		}
		summary.push(`Total: you pay ${formatUnits(totalUnits)} PUSD and receive ${formatSats(totalSats)} BCH (in your BCH change)`);
	} else {
		// Taker pays BCH from the wallet; receives PUSD from the bids.
		tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category: pusd, amount: totalUnits } });
		summary.push(`Total: you sell ${formatSats(totalSats)} BCH and receive ${formatUnits(totalUnits)} PUSD`);
	}
	summary.push(
		oracleRead.refreshed
			? `Priced at ${formatPrice(price)} PUSD/BCH: this transaction also updates the on-chain reference from oracles.cash (message #${oracleRead.state.sequence})`
			: `Priced against the on-chain reference ${formatPrice(price)} PUSD/BCH (message #${oracle.state.sequence})`
	);
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
	const used = new Set<string>();
	addAuthorisationInput(tx, sources, walletUtxos, walletLocking, used, 'maker');
	if (order.heldUnits > 0n) {
		tx.outputs.push({
			lockingBytecode: walletLocking,
			valueSatoshis: TOKEN_OUTPUT_SATOSHIS,
			token: { category: hexToBin(market.pusdCategory), amount: order.heldUnits }
		});
	}
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
	return finish('order-cancel', tx, sources, fee, [
		`Cancel ${order.side} at ${order.deltaBps > 0 ? '+' : ''}${order.deltaBps} BPS and withdraw everything it holds`,
		`Returns ${formatSats(order.utxo.satoshis)} BCH${order.heldUnits > 0n ? ` and ${formatUnits(order.heldUnits)} PUSD` : ''} to your address`,
		'Authorised by your own address (input 1), signed in Cashonize'
	]);
}

// ---------------------------------------------------------------- PUSD transfer

export interface PusdRecipient {
	address: string;
	units: bigint;
}

/** Decode a Chipnet (bchtest:) P2PKH/P2SH address; rejects mainnet and other prefixes. */
export function chipnetRecipientLocking(address: string): { lockingBytecode: Uint8Array; tokenAware: boolean } {
	const trimmed = address.trim();
	const withPrefix = trimmed.includes(':') ? trimmed : `${CHIPNET_PREFIX}:${trimmed}`;
	const decoded = decodeCashAddress(withPrefix);
	if (typeof decoded === 'string') throw new Error(`Invalid address ${trimmed.slice(0, 20)}…: ${decoded}`);
	if (decoded.prefix !== CHIPNET_PREFIX) throw new Error(`Only Chipnet (${CHIPNET_PREFIX}:) addresses are accepted.`);
	return { lockingBytecode: addressToLockingBytecode(withPrefix), tokenAware: decoded.type.endsWith('WithTokens') };
}

/**
 * Send PUSD to one or more Chipnet addresses (for seeding teammates' test
 * wallets). Each recipient output carries the token amount plus 1,000 sats;
 * token change returns to the sender. `reserved` outpoints (e.g. a confirmed
 * vout-0 UTXO kept for a pending genesis) are never spent.
 */
export function buildPusdTransfer(
	pusdCategory: string,
	senderAddress: string,
	walletUtxos: ChainUtxo[],
	recipients: PusdRecipient[],
	reserved: string[] = []
): UnsignedExchangeTransaction {
	if (recipients.length === 0) throw new Error('Add at least one recipient.');
	if (recipients.length > 20) throw new Error('At most 20 recipients per transaction.');
	const walletLocking = addressToLockingBytecode(senderAddress);
	const category = hexToBin(pusdCategory);
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [], outputs: [] };
	const sources: WcSourceOutput[] = [];
	const used = new Set<string>(reserved);
	const summary: string[] = [];
	let total = 0n;
	let plainAddresses = 0;
	for (const recipient of recipients) {
		if (recipient.units <= 0n) throw new Error('Every recipient needs a positive PUSD amount.');
		const { lockingBytecode, tokenAware } = chipnetRecipientLocking(recipient.address);
		if (binToHex(lockingBytecode) === binToHex(walletLocking)) throw new Error('A recipient is your own address.');
		if (!tokenAware) plainAddresses += 1;
		total += recipient.units;
		tx.outputs.push({ lockingBytecode, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category, amount: recipient.units } });
		summary.push(`Send ${formatUnits(recipient.units)} PUSD to ${lockingBytecodeToChipnetAddress(lockingBytecode, true)}`);
	}
	if (total > MAX_TOKEN_UNITS) throw new Error('Amount too large.');
	summary.unshift(`Send ${formatUnits(total)} PUSD to ${recipients.length} address${recipients.length === 1 ? '' : 'es'}`);
	let gathered = 0n;
	for (const utxo of pusdUtxos(walletUtxos, pusdCategory)) {
		if (gathered >= total) break;
		if (used.has(`${utxo.txid}:${utxo.vout}`)) continue;
		const input = utxoToInput(utxo, new Uint8Array());
		tx.inputs.push(input);
		sources.push(source(input, utxoToOutput(utxo, walletLocking)));
		used.add(`${utxo.txid}:${utxo.vout}`);
		gathered += utxo.token!.amount;
	}
	if (gathered < total) {
		const locked = walletUtxos.some((utxo) => utxo.identityOf && utxo.token?.category === pusdCategory);
		throw new Error(
			`Insufficient PUSD: the wallet holds ${formatUnits(gathered)} spendable, ${formatUnits(total)} needed.` +
				(locked ? ' Some PUSD sits on the token identity output; separate the identity first (Token page).' : '')
		);
	}
	if (gathered > total) {
		tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category, amount: gathered - total } });
		summary.push(`${formatUnits(gathered - total)} PUSD change returns to your address`);
	}
	if (plainAddresses > 0) {
		summary.push(`${plainAddresses} recipient address(es) are not token-aware (z…); the PUSD still arrives at the same key`);
	}
	if (reserved.length > 0) summary.push('Leaves your genesis-ready vout-0 UTXO untouched');
	try {
		const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
		return finish('pusd-send', tx, sources, fee, summary);
	} catch (cause) {
		if (reserved.length > 0 && cause instanceof Error && cause.message.startsWith('Insufficient BCH')) {
			throw new Error(`${cause.message} Your only spare BCH is the vout-0 UTXO reserved for oracle genesis. Create the oracle first, then send PUSD from the change.`);
		}
		throw cause;
	}
}

// ---------------------------------------------------------------- identity separation

export const IDENTITY_OUTPUT_SATOSHIS = 1_000n;

/** A BCH-only, non-identity wallet output at index 0 (confirmed preferred). */
function genesisInputOf(walletUtxos: ChainUtxo[]): ChainUtxo | undefined {
	const candidates = bchOnly(walletUtxos).filter((utxo) => utxo.vout === 0);
	return candidates.find((utxo) => (utxo.height ?? 0) > 0) ?? candidates[0];
}

/**
 * Create a fixed-supply fungible token (PUSD) with the identity kept apart from
 * the supply, so ordinary sends never touch it:
 *   output 0: BCH-only identity output to the creator (BCMR authchain head);
 *   output 1: the entire supply to the creator's token-aware address;
 *   output 2: BCH change.
 * No minting baton and no NFTs are created, so the supply can never grow.
 */
export function buildPusdGenesis(creatorAddress: string, walletUtxos: ChainUtxo[], supplyUnits: bigint): UnsignedExchangeTransaction {
	if (!creatorAddress.startsWith('bchtest:')) throw new Error('PUSD genesis is restricted to a Chipnet (bchtest:) address.');
	if (supplyUnits <= 0n || supplyUnits > MAX_TOKEN_UNITS) throw new Error('Supply must be a positive CashToken amount.');
	const walletLocking = addressToLockingBytecode(creatorAddress);
	if (walletLocking.length !== 25) throw new Error('Genesis must be created from a P2PKH wallet address.');
	const genesisInput = genesisInputOf(walletUtxos);
	if (!genesisInput) {
		throw new Error('PUSD genesis needs a BCH-only UTXO at output index 0 in the connected wallet. Receive a payment (it lands at output 0) and try again.');
	}
	const category = genesisInput.txid;
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [], outputs: [] };
	const sources: WcSourceOutput[] = [];
	const input = utxoToInput(genesisInput, new Uint8Array());
	tx.inputs.push(input);
	sources.push(source(input, utxoToOutput(genesisInput, walletLocking)));
	tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: IDENTITY_OUTPUT_SATOSHIS });
	tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: TOKEN_OUTPUT_SATOSHIS, token: { category: hexToBin(category), amount: supplyUnits } });
	const used = new Set([`${genesisInput.txid}:${genesisInput.vout}`]);
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);
	if (tx.outputs[0]!.token || tx.outputs.filter((output) => output.token).length !== 1) {
		throw new Error('Internal check failed: output 0 must be BCH-only and exactly one output must carry the supply.');
	}
	if (tx.outputs.some((output) => binToHex(output.lockingBytecode) !== binToHex(walletLocking))) {
		throw new Error('Internal check failed: every output must pay the creator.');
	}
	assertTokenConservation(tx, sources, category);
	const own = lockingBytecodeToChipnetAddress(walletLocking, true);
	const ownPlain = lockingBytecodeToChipnetAddress(walletLocking, false);
	return {
		kind: 'pusd-genesis',
		transaction: tx,
		unsignedHex: binToHex(encodeTransaction(tx)),
		sourceOutputs: sources,
		feeSatoshis: fee,
		createdCategory: category,
		summary: [
			`Create ${formatUnits(supplyUnits)} PUSD (fixed supply, 2 decimals, no minting baton, no NFTs)`,
			`Spends ${genesisInput.txid.slice(0, 12)}…:0 · new PUSD category = that txid`,
			`Output 0: token identity, BCH only, to ${ownPlain}`,
			`Output 1: the whole supply to ${own}`,
			`Network fee ≈ ${fee.toString()} sats`
		]
	};
}

/**
 * One-time fix for a token identity output that also carries fungible tokens
 * (PUSD genesis put the whole supply on the identity output). Spends exactly that
 * output and returns:
 *   output 0: the identity, as a BCH-only output to the owner's own address;
 *   output 1: every token it carried, to the owner's own address;
 *   later:    BCH change.
 * Nothing leaves the owner's address; only the fee is paid.
 */
export function buildIdentitySeparation(
	tokenCategory: string,
	ownerAddress: string,
	walletUtxos: ChainUtxo[],
	identity: { txid: string; vout: number }
): UnsignedExchangeTransaction {
	const walletLocking = addressToLockingBytecode(ownerAddress);
	if (identity.vout !== 0) throw new Error('An identity output is always output 0 of its transaction.');
	const utxo = walletUtxos.find((candidate) => candidate.txid === identity.txid && candidate.vout === identity.vout);
	if (!utxo) throw new Error('The identity output is not an unspent output of the connected wallet.');
	if (!utxo.token) throw new Error('The identity output already holds no tokens: nothing to separate.');
	if (utxo.token.category !== tokenCategory || utxo.token.nft || utxo.token.amount <= 0n) {
		throw new Error('The identity output does not hold plain fungible tokens of this category; refusing to build.');
	}
	const category = hexToBin(tokenCategory);
	const input = utxoToInput(utxo, new Uint8Array(), true);
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [input], outputs: [] };
	const sources: WcSourceOutput[] = [source(input, utxoToOutput(utxo, walletLocking))];
	tx.outputs.push({ lockingBytecode: walletLocking, valueSatoshis: IDENTITY_OUTPUT_SATOSHIS });
	tx.outputs.push({
		lockingBytecode: walletLocking,
		valueSatoshis: TOKEN_OUTPUT_SATOSHIS,
		token: { category, amount: utxo.token.amount }
	});
	const used = new Set([`${utxo.txid}:${utxo.vout}`]);
	const fee = fundWithWalletBch(tx, sources, walletUtxos, walletLocking, used);

	// Invariants, checked on the built transaction rather than assumed.
	const out0 = tx.outputs[0]!;
	if (binToHex(out0.lockingBytecode) !== binToHex(walletLocking) || out0.token) {
		throw new Error('Internal check failed: output 0 must be a BCH-only output to your own address.');
	}
	const tokenOut = tx.outputs.filter((output) => output.token);
	if (
		tokenOut.length !== 1 ||
		binToHex(tokenOut[0]!.lockingBytecode) !== binToHex(walletLocking) ||
		binToHex(tokenOut[0]!.token!.category) !== tokenCategory ||
		tokenOut[0]!.token!.amount !== utxo.token.amount
	) {
		throw new Error('Internal check failed: every token must return to your own address in one output.');
	}
	if (tx.outputs.some((output) => binToHex(output.lockingBytecode) !== binToHex(walletLocking))) {
		throw new Error('Internal check failed: every output must pay your own address.');
	}
	const own = lockingBytecodeToChipnetAddress(walletLocking, true);
	return finish('identity-separation', tx, sources, fee, [
		`Separate the token identity from the ${formatUnits(utxo.token.amount)} PUSD supply. Everything stays at your address`,
		`Input 0: identity output ${utxo.txid}:${utxo.vout} (${formatUnits(utxo.token.amount)} PUSD, ${formatSats(utxo.satoshis)} BCH)`,
		`Output 0: the identity, as ${formatSats(IDENTITY_OUTPUT_SATOSHIS)} BCH with no tokens, to ${own}`,
		`Output 1: all ${formatUnits(utxo.token.amount)} PUSD (category ${tokenCategory.slice(0, 12)}…) to ${own}`,
		...(tx.outputs.length > 2 ? [`Output 2: BCH change to ${own}`] : []),
		'Afterwards ordinary PUSD sends and trades no longer touch the identity'
	]);
}

export function formatSats(sats: bigint): string {
	const negative = sats < 0n;
	const abs = negative ? -sats : sats;
	return `${negative ? '-' : ''}${abs / 100_000_000n}.${(abs % 100_000_000n).toString().padStart(8, '0')}`;
}

export function formatUnits(units: bigint): string {
	const negative = units < 0n;
	const abs = negative ? -units : units;
	return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
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
