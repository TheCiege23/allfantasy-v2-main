import type { PickedAsset } from './TradeAssetPicker'

/** A league ID alone cannot identify the account that owns a browser draft. */
export function tradeDeviceDraftKey(viewerId: string | null | undefined, leagueId: string | null | undefined, working = false): string | null {
  if (!viewerId?.trim() || !leagueId?.trim()) return null
  return `af-trade-${working ? 'working-' : ''}draft:v2:${encodeURIComponent(viewerId)}:${encodeURIComponent(leagueId)}`
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const textOrNull = (x: unknown) => x == null || typeof x === 'string'
function asset(x: unknown): x is PickedAsset {
  if (!record(x)) return false
  if (x.kind === 'faab') return finite(x.amount) && x.amount >= 0
  if (x.kind === 'pick') return finite(x.year) && Number.isInteger(x.year) && finite(x.round) && Number.isInteger(x.round) && x.round >= 1 && typeof x.label === 'string'
  if (x.kind !== 'player' || typeof x.name !== 'string' || !x.name.trim() || !textOrNull(x.playerId)
    || !textOrNull(x.position) || !textOrNull(x.team) || !(x.value == null || finite(x.value))) return false
  return x.providerIdentity == null || record(x.providerIdentity) && ['sleeper', 'yahoo'].includes(String(x.providerIdentity.provider))
    && typeof x.providerIdentity.id === 'string' && !!x.providerIdentity.id.trim()
}

/** Refuse a malformed whole proposal, rather than silently dropping one asset. */
export function decodeTradeDraft(value: unknown): { give: PickedAsset[]; get: PickedAsset[]; partnerRosterId: string | null } | null {
  if (!record(value) || !Array.isArray(value.give) || !Array.isArray(value.get)
    || !value.give.every(asset) || !value.get.every(asset)) return null
  return { give: value.give, get: value.get, partnerRosterId: typeof value.partnerRosterId === 'string' ? value.partnerRosterId : null }
}
