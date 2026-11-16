import {
	binToHex,
	cashAddressToLockingBytecode,
	decodeTransactionBch,
	hexToBin,
	hash256,
	swapEndianness,
	stringify,
	type TransactionBch
} from '@bitauth/libauth';
import { TestNetWatchWallet, type SourceOutput, type Utxo } from '@unspent/wallet';

export const PUSD_NAME = 'PennyPicker USD';
export const PUSD_SYMBOL = 'PUSD';
export const PUSD_DECIMALS = 2;
export const PUSD_INITIAL_SUPPLY = 1_000_000n;
export const PUSD_INITIAL_AMOUNT = PUSD_INITIAL_SUPPLY * 100n;
export const PUSD_TOKEN_OUTPUT_SATOSHIS = 1_000n;
export const PUSD_CATEGORY_STORAGE_KEY = 'pennypicker:chipnet:pusd-category';

export interface UnsignedPusdGenesis {
	wallet: TestNetWatchWallet;
	unsignedTransaction: string;
	sourceOutputs: SourceOutput[];
	/** Candidate category derived from the vout 0 genesis input; not deployed yet. */
	candidateCategory: string;
	genesisInput: Utxo;
	feeSatoshis: bigint;
	outputCount: number;
}

function decodeTransaction(rawHex: string): TransactionBch {
	const decoded = decodeTransactionBch(hexToBin(rawHex));
	if (typeof decoded === 'string') throw new Error(`Could not decode transaction: ${decoded}`);
	return decoded;
}

export async function buildUnsignedPusdGenesis(address: string): Promise<UnsignedPusdGenesis> {
	if (!address.startsWith('bchtest:')) {
		throw new Error('PUSD genesis is restricted to a Cashonize Chipnet address (bchtest:).');
	}

	const wallet = await TestNetWatchWallet.watchOnly(address);
	const utxos = await wallet.getUtxos();
	const genesisInput = utxos.find((utxo) => utxo.vout === 0 && !utxo.token);
	if (!genesisInput) {
		throw new Error(
			'No BCH-only vout 0 UTXO is available. Fund this Cashonize Chipnet address and check again.'
		);
	}

	const response = await wallet.tokenGenesis(
		{
			amount: PUSD_INITIAL_AMOUNT,
			value: PUSD_TOKEN_OUTPUT_SATOSHIS
		},
		[],
		{
			buildUnsigned: true,
			queryBalance: false,
			utxoIds: utxos,
			ensureUtxos: [genesisInput]
		}
	);
	if (!response.unsignedTransaction || !response.sourceOutputs?.length) {
		throw new Error('The wallet library did not return an unsigned genesis transaction.');
	}
	const transaction = decodeTransaction(response.unsignedTransaction);
	if (
		transaction.inputs.length === 0 ||
		response.sourceOutputs.length !== transaction.inputs.length
	) {
		throw new Error(
			'The unsigned transaction and Cashonize source outputs do not have matching input counts.'
		);
	}
	for (let index = 0; index < transaction.inputs.length; index++) {
		const input = transaction.inputs[index]!;
		const source = response.sourceOutputs[index]!;
		if (
			input.outpointIndex !== source.outpointIndex ||
			binToHex(input.outpointTransactionHash) !== binToHex(source.outpointTransactionHash)
		) {
			throw new Error('A Cashonize source output does not match its unsigned transaction input.');
		}
		if (input.unlockingBytecode.length !== 0) {
			throw new Error('The prepared genesis transaction unexpectedly contains a signed input.');
		}
	}
	const genesisIndex = transaction.inputs.findIndex(
		(input) =>
			input.outpointIndex === 0 &&
			swapEndianness(binToHex(input.outpointTransactionHash)) === genesisInput.txid
	);
	if (genesisIndex === -1) {
		throw new Error('The unsigned transaction does not spend the selected vout 0 genesis input.');
	}

	const tokenOutputs = transaction.outputs.filter((output) => output.token);
	if (tokenOutputs.length !== 1) throw new Error('Expected exactly one PUSD token output.');
	const tokenOutput = tokenOutputs[0]!;
	const candidateCategory = binToHex(tokenOutput.token!.category);
	if (candidateCategory !== genesisInput.txid) {
		throw new Error('The token category does not match the vout 0 genesis input transaction ID.');
	}
	if (tokenOutput.token!.amount !== PUSD_INITIAL_AMOUNT || tokenOutput.token!.nft) {
		throw new Error(
			'The genesis output does not match the fixed PUSD supply without an NFT baton.'
		);
	}
	if (tokenOutput.valueSatoshis !== PUSD_TOKEN_OUTPUT_SATOSHIS) {
		throw new Error('The PUSD genesis output does not have the configured BCH value.');
	}
	const destination = cashAddressToLockingBytecode(wallet.getTokenDepositAddress());
	if (typeof destination === 'string')
		throw new Error(`Could not validate the PUSD destination: ${destination}`);
	if (binToHex(tokenOutput.lockingBytecode) !== binToHex(destination.bytecode)) {
		throw new Error('The PUSD genesis output is not locked to the connected Cashonize address.');
	}

	const inputSatoshis = response.sourceOutputs.reduce(
		(total, output) => total + output.valueSatoshis,
		0n
	);
	const outputSatoshis = transaction.outputs.reduce(
		(total, output) => total + output.valueSatoshis,
		0n
	);
	if (inputSatoshis <= outputSatoshis)
		throw new Error('Genesis transaction does not leave a positive miner fee.');

	return {
		wallet,
		unsignedTransaction: response.unsignedTransaction,
		sourceOutputs: response.sourceOutputs,
		candidateCategory,
		genesisInput,
		feeSatoshis: inputSatoshis - outputSatoshis,
		outputCount: transaction.outputs.length
	};
}

function canonicalOutput(output: TransactionBch['outputs'][number]): string {
	return JSON.stringify({
		valueSatoshis: output.valueSatoshis.toString(),
		lockingBytecode: binToHex(output.lockingBytecode),
		token: output.token
			? {
					category: binToHex(output.token.category),
					amount: output.token.amount.toString(),
					nft: output.token.nft
						? {
								capability: output.token.nft.capability,
								commitment: binToHex(output.token.nft.commitment)
							}
						: undefined
				}
			: undefined
	});
}

export function verifyPusdGenesisSignature(
	unsignedTransaction: string,
	signedTransaction: string,
	expectedCategory: string,
	expectedHash: string
): void {
	const unsigned = decodeTransaction(unsignedTransaction);
	const signed = decodeTransaction(signedTransaction);
	if (unsigned.version !== signed.version || unsigned.locktime !== signed.locktime) {
		throw new Error('Cashonize returned a transaction with a different version or locktime.');
	}
	if (
		unsigned.inputs.length !== signed.inputs.length ||
		unsigned.outputs.length !== signed.outputs.length
	) {
		throw new Error('Cashonize returned a transaction with a different input or output count.');
	}
	for (let index = 0; index < unsigned.inputs.length; index++) {
		const before = unsigned.inputs[index]!;
		const after = signed.inputs[index]!;
		if (
			before.outpointIndex !== after.outpointIndex ||
			binToHex(before.outpointTransactionHash) !== binToHex(after.outpointTransactionHash) ||
			before.sequenceNumber !== after.sequenceNumber
		) {
			throw new Error('Cashonize returned a transaction that changes an input outpoint.');
		}
		if (!after.unlockingBytecode.length) {
			throw new Error('Cashonize returned a transaction with an unsigned input.');
		}
	}
	for (let index = 0; index < unsigned.outputs.length; index++) {
		if (canonicalOutput(unsigned.outputs[index]!) !== canonicalOutput(signed.outputs[index]!)) {
			throw new Error('Cashonize returned a transaction that changes an output.');
		}
	}
	const signedHash = swapEndianness(binToHex(hash256(hexToBin(signedTransaction))));
	if (signedHash !== expectedHash)
		throw new Error('Cashonize transaction hash did not match the signed transaction.');
	const tokenOutputs = signed.outputs.filter((output) => output.token);
	if (
		tokenOutputs.length !== 1 ||
		binToHex(tokenOutputs[0]!.token!.category) !== expectedCategory ||
		tokenOutputs[0]!.token!.amount !== PUSD_INITIAL_AMOUNT ||
		tokenOutputs[0]!.token!.nft
	) {
		throw new Error('Signed transaction no longer represents the configured fixed PUSD supply.');
	}
}

/** Convert libauth Uint8Array/BigInt fields to WalletConnect-safe extended JSON values. */
export function serializeCashonizeSourceOutputs(sourceOutputs: SourceOutput[]): unknown {
	return JSON.parse(stringify(sourceOutputs)) as unknown;
}
