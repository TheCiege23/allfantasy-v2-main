import { z } from 'zod'
import type { TradeGradeView } from './tradeGrade'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

const value = z.number().finite().nonnegative().nullable()
const asset = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player'), playerId: z.string().max(256).optional(), name: z.string().max(256).optional(), sportHint: z.string().max(32).optional(),
    providerIdentity: z.object({ provider: z.enum(['sleeper', 'yahoo']), id: z.string().max(128), position: z.string().max(32).optional(), team: z.string().max(64).optional() }).optional() }),
  z.object({ kind: z.literal('pick'), year: z.number().int(), round: z.number().int().positive(), tier: z.enum(['early', 'mid', 'late']).optional(), label: z.string().max(256).optional() }),
  z.object({ kind: z.literal('faab'), amount: z.number().finite().nonnegative() }),
])
const line = z.object({ side: z.enum(['give', 'get']), name: z.string().max(256), marketValue: value, leagueValue: value })
const move = z.object({ side: z.enum(['give', 'get']), name: z.string().max(256), base: z.number().finite(), leagueValue: z.number().finite(), reasons: z.array(z.string().max(6000)).max(30) })
const leagueTypeBasis = z.object({ type: z.string().max(64), label: z.string().max(256), source: z.enum(['confirmed', 'platform', 'assumed']), platform: z.string().max(64).nullable() }).nullable().optional()
const grade = z.discriminatedUnion('graded', [
  z.object({ graded: z.literal(true), letter: z.enum(['A', 'B', 'C', 'D', 'F']), partnerLetter: z.enum(['A', 'B', 'C', 'D', 'F']), percentDiff: z.number().finite(),
    basis: z.string().max(6000), giveValue: value, getValue: value, lines: z.array(line).max(48), scoringApplied: z.boolean(), needApplied: z.boolean(),
    leagueType: leagueTypeBasis, moves: z.array(move).max(48).optional(), needGap: z.string().max(6000).nullable().optional(),
    recommendation: z.string().max(6000).optional(),
    rosterFit: z.object({ giveValue: z.number().finite(), getValue: z.number().finite(), percentDiff: z.number().finite(), moves: z.array(move).max(48) }).nullable().optional(),
    // The roster-spot credit inside giveValue/getValue (`rosterSpotCharge.ts`); kept so a receipt still adds up.
    rosterSpot: z.object({ side: z.enum(['give', 'get']), spots: z.number().int().positive(), valuePerSpot: z.number().finite().nonnegative(), value: z.number().finite().nonnegative() }).nullable().optional(),
    // How the letter was taken (`withYourTeamLetter`, 2026-10-10) and, under a your-team headline, the
    // league-value grade beside it — so a saved receipt shows both letters it was shown with.
    letterBasis: z.enum(['market', 'your_team']).optional(),
    market: z.object({ letter: z.enum(['A', 'B', 'C', 'D', 'F']), partnerLetter: z.enum(['A', 'B', 'C', 'D', 'F']), percentDiff: z.number().finite(),
      label: z.string().max(256), giveValue: z.number().finite(), getValue: z.number().finite() }).nullable().optional() }),
  z.object({ graded: z.literal(false), reason: z.string().max(6000), basis: z.string().max(6000).nullable(), leagueType: leagueTypeBasis }),
])

/** An evaluation at capture time, never a claim that the source prices are equally fresh. */
export const evaluationReceiptSchema = z.object({
  version: z.literal(1), model: z.literal('trade-value-league-scoring-v1'), evaluatedAt: z.string().datetime(),
  sourceUpdatedAt: z.string().nullable(), origin: z.enum(['calculator', 'pending_email', 'completed_email']),
  league: z.object({ id: z.string().max(64), name: z.string().max(256), sport: z.string().max(32), leagueType: z.string().max(64).nullable(),
    leagueSize: z.number().int().nullable(), scoring: z.string().max(256).nullable(), isDynasty: z.boolean(),
    scoringRules: z.record(z.string(), z.number().finite()) }),
  input: z.object({ sportFilter: z.enum(['ALL', ...SUPPORTED_SPORTS]), leagueId: z.string().max(64), strategy: z.enum(['contender', 'rebuilder', 'win_now', 'long_term', 'neutral']),
    teamContext: z.enum(['my_team', 'team_a', 'team_b', 'neutral']), analysisTab: z.string().max(64),
    opponentTeamExternalId: z.string().max(128).nullable().optional(), sideGive: z.array(asset).max(24), sideGet: z.array(asset).max(24) }),
  grade, dataGaps: z.array(z.string().max(6000)).max(100), sources: z.array(z.string().max(256)).max(100),
  assetSources: z.array(z.object({ side: z.enum(['give', 'get']), index: z.number().int().nonnegative(), source: z.string().max(256),
    playerId: z.string().max(256).nullable(), position: z.string().max(32) })).max(48),
  contextNotes: z.object({ byeNotes: z.array(z.string().max(6000)).max(100), formatNotes: z.array(z.string().max(6000)).max(100) }).optional(),
})
export type TradeEvaluationReceipt = z.infer<typeof evaluationReceiptSchema>
export type SavedTradeEvaluation = { id: string; href: string; evaluatedAt: string }

// A receipt exposes the original free verdict only. Paid analysis, account ids,
// full provider settings and roster details cannot leak through this read path.
export function receiptGrade(view: TradeGradeView): TradeEvaluationReceipt['grade'] {
  return grade.parse(view)
}

export function receiptScoringRules(settings: unknown): Record<string, number> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  const record = settings as Record<string, unknown>
  const raw = record.scoring_settings ?? record.scoringSettings
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] =>
    entry[0].length <= 128 && typeof entry[1] === 'number' && Number.isFinite(entry[1])))
}

export function receiptHref(id: string, leagueId: string): string {
  return `/core/trades?league=${encodeURIComponent(leagueId)}&evaluation=${encodeURIComponent(id)}`
}
