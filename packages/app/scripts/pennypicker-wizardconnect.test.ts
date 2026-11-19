/**
 * WizardConnect connector (whole HD wallet): pure checks, no relay or network.
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
import {
	deriveAddress,
	discoverAddresses,
	HOME_PATH,
	inputPathsFor,
	scanPathNames,
	sourceOutputToRelay,
	tradingAddress
} from '../src/lib/wizardconnect/wizardconnect';
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
const xpubOf = (path: string) => {
	const node = deriveHdPublicNode(unwrap(deriveHdPath(root, path) as never) as Parameters<typeof deriveHdPublicNode>[0]);
	const encoded = encodeHdPublicKey({ network: 'mainnet', node } as never) as unknown as { hdPublicKey: string } | string;
	return { node, xpub: typeof encoded === 'string' ? encoded : encoded.hdPublicKey };
};
const { node: receivePublic, xpub } = xpubOf("m/44'/145'/0'/0");
const { node: changePublic, xpub: changeXpub } = xpubOf("m/44'/145'/0'/1");
check('test xpub encodes', xpub.startsWith('xpub'), xpub.slice(0, 12));

// Expected receive/0 public key, derived independently with libauth.
const child = unwrap(deriveHdPathRelative(receivePublic, '0') as never) as { publicKey: Uint8Array };
const expectedPkh = binToHex(hash160(child.publicKey));

// The connector derives the same key from the xpub the wallet shares (restoreSessionPaths = stored session path).
const manager = new DappConnectionManager('PennyPicker test', undefined, { session: false });
manager.restoreSessionPaths([{ name: 'receive', xpub }, { name: 'change', xpub: changeXpub }, { name: 'stealth_scan', xpub }]);
const chipnet = tradingAddress(manager, 'chipnet');
const mainnet = tradingAddress(manager, 'mainnet');
check('home key is receive/0 of the shared xpub', chipnet.pkh === expectedPkh, chipnet.pkh);
check('home path is receive/0', HOME_PATH.name === 'receive' && HOME_PATH.index === 0 && chipnet.path[0] === 'receive' && chipnet.path[1] === 0);
check('chipnet address uses bchtest', chipnet.address.startsWith('bchtest:q'), chipnet.address);
check('mainnet address uses bitcoincash', mainnet.address.startsWith('bitcoincash:q'), mainnet.address);
check('same key on both networks', chipnet.pkh === mainnet.pkh);
check(
	'address matches the app encoder',
	chipnet.address === lockingBytecodeToAddress(p2pkhLockingBytecode(expectedPkh), 'chipnet', false)
);

// Other paths and indexes derive like a BIP44 wallet: change/3 and receive/7.
const childPkh = (node: typeof receivePublic, index: number) =>
	binToHex(hash160((unwrap(deriveHdPathRelative(node, String(index)) as never) as { publicKey: Uint8Array }).publicKey));
const change3 = deriveAddress(manager, 'chipnet', 'change', 3);
const receive7 = deriveAddress(manager, 'chipnet', 'receive', 7);
check('change/3 derives from the change xpub', change3.pkh === childPkh(changePublic, 3));
check('receive/7 derives from the receive xpub', receive7.pkh === childPkh(receivePublic, 7));
check('scan paths: BIP44 chains only, receive first', JSON.stringify(scanPathNames(manager.getSessionPaths())) === JSON.stringify(['receive', 'change']), JSON.stringify(scanPathNames(manager.getSessionPaths())));

// Gap-limit discovery: receive/0, receive/4 and change/15 used; everything else empty (change/25 would sit beyond the gap).
const used = new Set([deriveAddress(manager, 'chipnet', 'receive', 4).address, deriveAddress(manager, 'chipnet', 'change', 15).address, deriveAddress(manager, 'chipnet', 'change', 41).address, chipnet.address]);
let queries = 0;
const found = await discoverAddresses((n, i) => deriveAddress(manager, 'chipnet', n, i), ['receive', 'change'], async (address) => {
	queries++;
	return used.has(address);
}, 20);
const foundPaths = found.map((a) => a.path.join('/'));
check('discovery finds every used address', JSON.stringify(foundPaths) === JSON.stringify(['receive/0', 'receive/4', 'change/15']), JSON.stringify(foundPaths));
check('discovery stops after 20 unused in a row (change/41 is beyond the gap)', queries === 80 && !foundPaths.includes('change/41'), `${queries} lookups`);
const empty = await discoverAddresses((n, i) => deriveAddress(manager, 'chipnet', n, i), ['receive', 'change'], async () => false, 20);
check('an unused wallet still has its home address', empty.length === 1 && empty[0]!.path.join('/') === 'receive/0');

// Input paths: each wallet input is signed with the path of the address it spends; contract inputs are skipped.
const mine = p2pkhLockingBytecode(expectedPkh);
const other = p2pkhLockingBytecode('11'.repeat(20));
const contract = hexToBin('aa20' + '33'.repeat(32) + '87'); // P2SH32 covenant
const so = (lockingBytecode: Uint8Array, unlocking = new Uint8Array()) => ({ lockingBytecode, unlockingBytecode: unlocking });
const known = new Map<string, [string, number]>(found.map((a) => [a.lockingHex, a.path]));
const r4 = hexToBin(found[1]!.lockingHex);
const c15 = hexToBin(found[2]!.lockingHex);
const paths = inputPathsFor([so(contract, Uint8Array.of(1)), so(mine), so(r4), so(contract, Uint8Array.of(1)), so(c15)], known);
check(
	'signs every wallet input with its own path',
	JSON.stringify(paths) === JSON.stringify([[1, 'receive', 0], [2, 'receive', 4], [4, 'change', 15]]),
	JSON.stringify(paths)
);
check('contract inputs get no path', !paths.some(([i]) => i === 0 || i === 3));
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
check('refuses an unknown address input', throws(() => inputPathsFor([so(contract, Uint8Array.of(1)), so(mine), so(other)], known)));
check('refuses a transaction with nothing for the wallet to sign', throws(() => inputPathsFor([so(contract, Uint8Array.of(1))], known)));

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
