import { getDefaultScoringTemplate } from '@/lib/scoring-defaults/ScoringDefaultsRegistry'
import { z } from 'zod'
import { buildSeasonBlueprint } from './seasonBlueprint'
import { assessSeasonRules } from './seasonRules'
import { buildSeasonLeagueLayout } from './seasonLeagueLayout'

const member = z.object({ id: z.string().min(1), userId: z.string().min(1), displayName: z.string(), avatarUrl: z.string().nullable(), draftSlot: z.number().int().positive(), waiverPriority: z.number().int().positive() })
export const openingManifestSchema = z.object({
  version: z.literal(1), algorithm: z.literal('crypto_fisher_yates_v1'), hashAlgorithm: z.literal('canonical_sha256_v1'),
  publicationId: z.string().min(1), rulesHash: z.string().min(1), manifestHash: z.string().regex(/^[a-f0-9]{64}$/), config: z.unknown(),
  leagues: z.array(z.object({ key: z.string(), name: z.string(), division: z.string().nullable(), slots: z.number().int().positive(), members: z.array(member) })),
})
export function readOpeningManifest(input: unknown) {
  const manifest = openingManifestSchema.parse(input)
  const plan = buildSeasonBlueprint(manifest.config)
  const readiness = assessSeasonRules(plan.config)
  if (!readiness.ready) throw new Error('The frozen contract is incomplete: ' + readiness.blockers.join(' '))
  const expected = buildSeasonLeagueLayout(plan.config)[0]!.leagues
  const members = manifest.leagues.flatMap(l => l.members)
  if (manifest.leagues.length !== expected.length || members.length !== plan.config.participants || new Set(members.map(m => m.id)).size !== members.length || new Set(members.map(m => m.userId)).size !== members.length) throw new Error('The frozen field is inconsistent.')
  manifest.leagues.forEach((league, i) => {
    const layout = expected[i]!
    if (league.key !== layout.key || league.name !== layout.name || league.division !== layout.division || league.slots !== layout.slots || league.members.length !== league.slots || league.members.some((m, j) => m.draftSlot !== j + 1 || m.waiverPriority !== league.slots - j)) throw new Error('The frozen league assignment is inconsistent.')
  })
  return { ...manifest, config: plan.config }
}
export type OpeningManifest = ReturnType<typeof readOpeningManifest>
export const seasonSetupBlocked = (settings: unknown) => !!(settings && typeof settings === 'object' && 'seasonTournament' in settings)

/** Full contract is retained alongside the fields the existing native resolvers read. */
export function nativeSeasonSettings(manifest: OpeningManifest, tournamentId: string, freezeId: string, key: string) {
  const c = manifest.config, r = c.rules!
  const slots = { ...Object.fromEntries(r.starters.map(s => [s.position, s.count])), BN: r.bench, IR: r.ir }
  return {
    seasonTournament: { version: 1, tournamentId, freezeId, key, stage: 1, rulesHash: manifest.rulesHash, manifestHash: manifest.manifestHash, launchBlocked: true, contract: c },
    rosterPositions: Object.entries(slots).flatMap(([slot, count]) => Array.from({ length: count }, () => slot)),
    [c.sport.toLowerCase() + '_roster_config']: { slots },
    scoringSettings: Object.fromEntries(r.weights.map(w => [w.statKey, w.points])),
    draftSettings: { draftType: c.draftType, rounds: c.rosterSize, timerSeconds: r.draftPolicy!.pickClockSeconds, ...r.draftPolicy },
    waiverSettings: { ...r.waivers, ...r.transactionPolicy },
    lineupSettings: { lock: r.lineupLock, nbaGames: r.nbaGames },
    tradeSettings: { enabled: c.trades, deadlineHoursBeforeCut: r.tradeDeadlineHoursBeforeCut, reviewHours: r.tradeReviewHours },
  }
}

export function nativeSeasonScoring(manifest: OpeningManifest) {
  const c = manifest.config, weights = c.rules!.weights
  const preset = getDefaultScoringTemplate(c.sport, c.scoring === 'nba_points' ? 'points' : c.scoring)
  // Missing published weights mean zero; never inherit a registry default silently.
  return preset.rules.map(stat => ({ statKey: stat.statKey, pointsValue: weights.find(w => w.statKey === stat.statKey)?.points ?? 0, enabled: true }))
}
export function nativeSeasonWaivers(manifest: OpeningManifest) {
  const r = manifest.config.rules!
  return { waiverType: r.waivers.mode === 'faab' ? 'faab' : 'rolling', processingTimeUtc: String(r.waivers.processingHourUtc).padStart(2, '0') + ':00', faabBudget: r.waivers.mode === 'faab' ? r.waivers.budget : null, faabResetType: 'redraft', waiverOrderResetPolicy: 'reverse_draft_order', tiebreakRule: 'rolling_priority', lockType: r.lineupLock, processingDays: [0, 1, 2, 3, 4, 5, 6], waiverEngineConfig: { minimum_waiver_time_hours: r.waivers.holdHours, faab_min_bid: r.transactionPolicy!.zeroDollarBids ? 0 : 1, allow_zero_faab_bid: r.transactionPolicy!.zeroDollarBids, faab_tiebreaker: 'rolling', transactionPolicy: r.transactionPolicy!, launchBlocked: true } }
}
