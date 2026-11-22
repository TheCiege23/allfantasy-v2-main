import type { C2CDraftSide } from '@/lib/parsePickLabel'
import type { SupportedSport } from '@/lib/sport-scope'

export const TRADE_REVIEW_TOKEN_RULE = 'ai_trade_analyzer_full_review'

export type TradeReviewAsset =
  | { kind: 'player'; name: string; position?: string | null; team?: string | null; age?: string }
  | { kind: 'pick'; year: number; round: number; tier?: 'early' | 'mid' | 'late'; draftSide?: C2CDraftSide }
  | { kind: 'faab'; amount: number }

export type TradeReviewDraft = {
  give: TradeReviewAsset[]
  get: TradeReviewAsset[]
  sport: SupportedSport
  format: 'dynasty' | 'keeper' | 'redraft'
  qbFormat?: 'sf' | '1qb'
  scoring?: 'PPR' | 'Half PPR' | 'Standard' | 'TE Premium' | 'Superflex' | 'Points' | 'Categories'
  asOfDate?: string
  leagueId?: string
  senderInfo?: { teamName: string; record: string; isProMember: boolean }
  receiverInfo?: { teamName: string; record: string; isProMember: boolean }
}

const STORAGE_KEY = 'af:trade-review-draft'
const RETAIN_MS = 24 * 60 * 60 * 1000

/** Keep the editable trade in this tab through sign-in and checkout. The URL carries only an identifier. */
export function saveTradeReviewDraft(draft: TradeReviewDraft, draftId?: string | null, ownerId?: string | null): string | null {
  try {
    const id = draftId || crypto.randomUUID()
    const keepAsset = (asset: TradeReviewAsset): TradeReviewAsset => {
      if (asset.kind === 'player') {
        const { kind, name, position, team, age } = asset
        return { kind, name, position, team, age }
      }
      if (asset.kind === 'pick') {
        const { kind, year, round, tier, draftSide } = asset
        return { kind, year, round, tier, draftSide }
      }
      return { kind: 'faab', amount: asset.amount }
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      id,
      ownerId: ownerId ?? null,
      draft: { ...draft, give: draft.give.map(keepAsset), get: draft.get.map(keepAsset) },
      savedAt: Date.now(),
    }))
    return id
  } catch {
    return null
  }
}

export function readTradeReviewDraft(draftId: string, viewerId?: string | null): TradeReviewDraft | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (stored?.id !== draftId || !(Date.now() - stored.savedAt < RETAIN_MS)) return null
    if (stored.ownerId && stored.ownerId !== viewerId) return null
    const draft = stored.draft as TradeReviewDraft | undefined
    return Array.isArray(draft?.give) && Array.isArray(draft?.get) ? draft : null
  } catch {
    return null
  }
}

export function tradeReviewPath(draftId?: string | null): string {
  const query = new URLSearchParams({ mode: 'league' })
  if (draftId) query.set('review', draftId)
  return `/trade-evaluator?${query}`
}
