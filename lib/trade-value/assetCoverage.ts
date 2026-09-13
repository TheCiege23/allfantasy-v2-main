/**
 * Compatibility import for existing trade-value callers. The verdict-shaped
 * implementation lives inside Decision OS, which is the platform authority for
 * trade decisions.
 */
export { assessTradeAssetCoverage } from '@/lib/decision-os/trade/assetCoverage'
