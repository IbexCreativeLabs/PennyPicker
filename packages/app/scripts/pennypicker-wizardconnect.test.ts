/**
 * WizardConnect connector (phase 1, one trading address): pure checks, no relay or network.
 * Run: pnpm dlx tsx scripts/pennypicker-wizardconnect.test.ts   (from packages/app)
 */
import {
	binToHex,
	deriveHdPath,
	deriveHdPathRelative,
	deriveHdPrivateNodeFromSeed,
	deriveHdPublicNode,
	encodeHdPublicKey,
	hash160,
	hexToBin
} from '@bitauth/libauth';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { inputPathsFor, sourceOutputToRelay, tradingAddress, TRADING_PATH } from '../src/lib/wizardconnect/wizardconnect';
import { lockingBytecodeToAddress, p2pkhLockingBytecode, type WcSourceOutput } from '../src/lib/pennypicker/exchange';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const unwrap = <T>(value: T | string): T => {
	if (typeof value === 'string') throw new Error(value);
	return value;
};

// A deterministic test HD wallet (fixed seed; never used on any chain).
const seed = hexToBin('000102030405060708090a0b0c0d0e0f'.repeat(4));
const root = unwrap(deriveHdPrivateNodeFromSeed(seed, { throwErrors: false } as never) as never) as Parameters<typeof deriveHdPath>[0];
const receiveAccount = unwrap(deriveHdPath(root, "m/44'/145'/0'/0") as never) as Parameters<typeof deriveHdPublicNode>[0];
const receivePublic = deriveHdPublicNode(receiveAccount);
const xpubResult = encodeHdPublicKey({ network: 'mainnet', node: receivePublic } as never) as unknown as { hdPublicKey: string } | string;
const xpub = typeof xpubResult === 'string' ? xpubResult : xpubResult.hdPublicKey;
check('test xpub encodes', xpub.startsWith('xpub'), xpub.slice(0, 12));

// Expected receive/0 public key, derived independently with libauth.
const child = unwrap(deriveHdPathRelative(receivePublic, '0') as never) as { publicKey: Uint8Array };
const expectedPkh = binToHex(hash160(child.publicKey));

// The connector derives the same key from the xpub the wallet shares (restoreSessionPaths = stored session path).
const manager = new DappConnectionManager('PennyPicker test', undefined, { session: false });
manager.restoreSessionPaths([{ name: 'receive', xpub }]);
const chipnet = tradingAddress(manager, 'chipnet');
const mainnet = tradingAddress(manager, 'mainnet');
check('trading key is receive/0 of the shared xpub', chipnet.pkh === expectedPkh, chipnet.pkh);
check('trading path is receive/0', TRADING_PATH.name === 'receive' && TRADING_PATH.index === 0);
check('chipnet address uses bchtest', chipnet.address.startsWith('bchtest:q'), chipnet.address);
check('mainnet address uses bitcoincash', mainnet.address.startsWith('bitcoincash:q'), mainnet.address);
check('same key on both networks', chipnet.pkh === mainnet.pkh);
check(
	'address matches the app encoder',
	chipnet.address === lockingBytecodeToAddress(p2pkhLockingBytecode(expectedPkh), 'chipnet', false)
);

// Input paths: only inputs spending the trading address are signed by the wallet.
const mine = p2pkhLockingBytecode(expectedPkh);
const other = p2pkhLockingBytecode('11'.repeat(20));
const contract = hexToBin('aa20' + '33'.repeat(32) + '87'); // P2SH32 covenant
const so = (lockingBytecode: Uint8Array) => ({ lockingBytecode, unlockingBytecode: new Uint8Array() });
const paths = inputPathsFor([so(contract), so(mine), so(contract), so(mine)], expectedPkh);
check('signs only the trading-address inputs', JSON.stringify(paths) === JSON.stringify([[1, 'receive', 0], [3, 'receive', 0]]), JSON.stringify(paths));
check('contract and foreign inputs get no path', !paths.some(([i]) => i === 0 || i === 2));
let threw = false;
try {
	inputPathsFor([so(contract), so(other)], expectedPkh);
} catch {
	threw = true;
}
check('refuses a transaction with nothing to sign from the trading address', threw);

// Relay JSON: hex strings and <bigint: Xn>, the format @wizardconnect/core's sourceOutputToRelay produces.
const sample: WcSourceOutput = {
	outpointTransactionHash: hexToBin('ab'.repeat(32)),
	outpointIndex: 1,
	sequenceNumber: 0,
	unlockingBytecode: new Uint8Array(),
	lockingBytecode: mine,
	valueSatoshis: 12345n,
	token: { category: hexToBin('cd'.repeat(32)), amount: 500n, nft: { capability: 'mutable', commitment: hexToBin('0102') } }
};
const relay = sourceOutputToRelay(sample) as Record<string, any>;
check('relay JSON round-trips through JSON.stringify', JSON.parse(JSON.stringify(relay)).outpointIndex === 1);
check('value as <bigint: Xn>', relay.valueSatoshis === '<bigint: 12345n>');
check('bytes as hex', relay.lockingBytecode === binToHex(mine) && relay.outpointTransactionHash === 'ab'.repeat(32));
check('token amount and NFT kept', relay.token.amount === '<bigint: 500n>' && relay.token.nft.capability === 'mutable' && relay.token.nft.commitment === '0102');

if (failures) {
	console.log(`${failures} WizardConnect check(s) failed.`);
	process.exit(1);
}
console.log('All WizardConnect checks passed.');
process.exit(0);
