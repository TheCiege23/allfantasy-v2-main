import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterEngineRegistry } from '@/lib/roster-engine'
import { getLeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { getEffectiveTaxiSettings } from '@/lib/taxi/TaxiSettingsService'
import { HEADLINE_STATS } from './explain'
import { dynastyRulesFromConfig, normalizeRosterSlots, ruleSnapshotFromLeague, taxiRulesFromEffective, type RulesLeagueRow } from './snapshot'
import { parseSettingsChangeEvents } from './view'
import type { RuleSnapshot, SettingsChangeEvent } from './types'

/**
 * The read path: the league row's rules plus the three config tables the row does not hold. Each
 * extra is best-effort — a failed read drops those lines from the popup, it never fails the page.
 * Database only; no sports data provider is called anywhere on this path.
 */
export async function loadRuleSnapshot(leagueId: string, row: RulesLeagueRow): Promise<RuleSnapshot> {
  const snapshot = ruleSnapshotFromLeague(row)
  const sport = snapshot.sport

  const [slots, scoring, guillotine, taxi, rookieDraft] = await Promise.all([
    (async () => {
      const registry = getRosterEngineRegistry()
      if (!registry.isSupported(sport as never)) return null
      return (await registry.getService(sport as never).getConfig(leagueId)).slots ?? null
    })().catch(() => null),
    getLeagueScoringConfig(leagueId).catch(() => null),
    snapshot.format === 'guillotine' ? getGuillotineConfig(leagueId).catch(() => null) : Promise.resolve(null),
    // The taxi squad lives in the dynasty config (Devy / C2C override the slot count), not on the row.
    snapshot.format === 'dynasty' ? getEffectiveTaxiSettings(leagueId).catch(() => null) : Promise.resolve(null),
    // The rookie draft's order, rounds and type, also on the dynasty config.
    snapshot.format === 'dynasty' && !snapshot.importedFrom
      ? prisma.dynastyLeagueConfig
          .findUnique({ where: { leagueId }, select: { rookiePickOrderMethod: true, rookieDraftRounds: true, rookieDraftType: true } })
          .then(dynastyRulesFromConfig)
          .catch(() => null)
      : Promise.resolve(null),
  ])
  if (rookieDraft) Object.assign(snapshot, rookieDraft)

  if (taxi) Object.assign(snapshot, taxiRulesFromEffective(taxi))

  const rosterSlots = normalizeRosterSlots(slots)
  if (rosterSlots) snapshot.rosterSlots = rosterSlots

  if (scoring?.categoryScoring) {
    snapshot.categories = scoring.categoryScoring.categories.map((c) => String(c.label ?? c.id)).filter(Boolean)
  } else if (scoring) {
    const wanted = new Set(HEADLINE_STATS[sport] ?? [])
    const values: Record<string, number> = {}
    for (const rule of scoring.rules) {
      if (!wanted.has(rule.statKey) || rule.enabled === false) continue
      if (typeof rule.pointsValue === 'number' && Number.isFinite(rule.pointsValue)) values[rule.statKey] = rule.pointsValue
    }
    snapshot.scoringValues = values
  }

  if (guillotine) {
    snapshot.teamsPerChop = guillotine.teamsPerChop
    snapshot.chopStartWeek = guillotine.eliminationStartWeek
    snapshot.chopEndWeek = guillotine.eliminationEndWeek ?? null
    snapshot.tiebreakers = [...guillotine.tiebreakerOrder]
    snapshot.statCorrectionHours = guillotine.statCorrectionHours
    snapshot.dangerMarginPoints = guillotine.dangerMarginPoints
    // `custom_time` has no editor or sentence; the rules page shows it as the default, and so does this.
    snapshot.releaseTiming = guillotine.rosterReleaseTiming === 'immediate' ? 'immediate' : 'next_waiver_run'
  }
  return snapshot
}

/** How far back the change history reaches. */
export const SETTINGS_EVENT_LOOKBACK = 60

export async function loadSettingsChangeEvents(leagueId: string): Promise<SettingsChangeEvent[]> {
  const rows = await prisma.leagueEvent.findMany({
    where: { leagueId, eventType: 'settings_changed' },
    orderBy: { createdAt: 'desc' },
    take: SETTINGS_EVENT_LOOKBACK,
    select: { id: true, createdAt: true, payload: true },
  })
  return parseSettingsChangeEvents(rows)
}
