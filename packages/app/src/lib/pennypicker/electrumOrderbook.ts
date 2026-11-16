import { getAllMarketOrders } from '@unspent/catdex';
import { indexBpsOrderUtxos, type OrderbookIndexResult, type ScriptUtxo } from './orderbookIndex';

/** Query one reviewed PennyPicker covenant hash using the existing CatDex adapter. */
export async function loadBpsOrderbookFromElectrum(
	electrumClient: Parameters<typeof getAllMarketOrders>[0],
	queriedScriptHash: string,
	authCategory: string,
	assetCategory: string
): Promise<OrderbookIndexResult> {
	const results = await getAllMarketOrders(electrumClient, [queriedScriptHash]);
	return indexBpsOrderUtxos(
		queriedScriptHash,
		Array.from(results.values()) as ScriptUtxo[],
		authCategory,
		assetCategory
	);
}
