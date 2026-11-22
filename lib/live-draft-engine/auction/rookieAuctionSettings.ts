import type { RookieAuctionPickPolicy } from './rookieAuctionPickPolicy'

export const ROOKIE_AUCTION_SETTINGS_KEY = 'rookie_auction'
export type RookieAuctionSettings = { policy: RookieAuctionPickPolicy; budgetPerTeam: number; valuesByRound: Record<string, number> }
export const DEFAULT_ROOKIE_AUCTION_SETTINGS: RookieAuctionSettings = { policy: 'block', budgetPerTeam: 200, valuesByRound: {} }

export function parseRookieAuctionSettings(value: unknown): { ok: true; value: RookieAuctionSettings } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Choose valid rookie auction settings.' }
  const raw = value as Record<string, unknown>
  if (raw.policy !== 'block' && raw.policy !== 'budget' && raw.policy !== 'nominations') return { ok: false, error: 'Choose how to handle traded rookie picks.' }
  if (!Number.isSafeInteger(raw.budgetPerTeam) || (raw.budgetPerTeam as number) < 1 || (raw.budgetPerTeam as number) > 100000) return { ok: false, error: 'Auction budget must be a whole number between 1 and 100000.' }
  if (!raw.valuesByRound || typeof raw.valuesByRound !== 'object' || Array.isArray(raw.valuesByRound)) return { ok: false, error: 'Set auction values by rookie draft round.' }
  const valuesByRound: Record<string, number> = {}
  for (const [round, amount] of Object.entries(raw.valuesByRound)) {
    if (!/^(?:[1-9]|1[0-2])$/.test(round) || !Number.isSafeInteger(amount) || (amount as number) < 0 || (amount as number) > 100000) return { ok: false, error: 'Round values must be whole numbers from 0 to 100000.' }
    valuesByRound[round] = amount as number
  }
  return { ok: true, value: { policy: raw.policy, budgetPerTeam: raw.budgetPerTeam as number, valuesByRound } }
}

export function readRookieAuctionSettings(settings: unknown): RookieAuctionSettings {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>)[ROOKIE_AUCTION_SETTINGS_KEY] : undefined
  const parsed = parseRookieAuctionSettings(raw)
  return parsed.ok ? parsed.value : { ...DEFAULT_ROOKIE_AUCTION_SETTINGS, valuesByRound: {} }
}

/** Once a rookie draft exists, changing into or out of auction would bypass pick conversion. */
export function rookieAuctionStructureChangeError(
  session: { draftModeLabel?: string | null; draftType: string; rounds: number; auctionBudgetPerTeam: number | null } | null,
  patch: { draftType?: unknown; rounds?: unknown; auctionBudgetPerTeam?: unknown },
): string | null {
  if (session?.draftModeLabel !== 'rookie') return null
  const nextType = typeof patch.draftType === 'string' ? patch.draftType : session.draftType
  const touchesAuction = session.draftType === 'auction' || nextType === 'auction'
  if (!touchesAuction) return null
  if ((patch.draftType !== undefined && nextType !== session.draftType) ||
      (patch.rounds !== undefined && Number(patch.rounds) !== session.rounds) ||
      (patch.auctionBudgetPerTeam !== undefined && Number(patch.auctionBudgetPerTeam) !== session.auctionBudgetPerTeam)) {
    return 'This rookie draft already has pick rights assigned. Its auction type, rounds, and budget cannot be changed after creation.'
  }
  return null
}
