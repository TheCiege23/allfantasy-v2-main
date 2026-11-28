/**
 * The C2C summary a league's chat, Chimmy and status chips read — for BOTH kinds of C2C league.
 *
 * Two setup tables exist on purpose:
 *  - `C2CLeague` (legacy): written by the C2C pair import and `POST /api/c2c`; it drives the campus/canton
 *    bucket engine (`lib/c2c/rosterEngine.ts`) and its own scorer (`lib/c2c/scoringEngine.ts`).
 *  - `C2CLeagueConfig` (native): written by league creation; native leagues are scored by the redraft engine
 *    plus the campus lineup (`lib/c2c/campusScoring.ts`).
 *
 * Before 2026-11-24 every chat, Chimmy and status reader looked only at `C2CLeague`, so a C2C league made in
 * the create wizard answered "C2C not configured" everywhere. Readers now come here. Engines do NOT: the
 * legacy bucket engine and scorer must keep keying on `C2CLeague`, or a native league would be moved onto a
 * scorer that ignores its scoring settings (see `leagueUsesC2CEngine`).
 */
import { prisma } from '@/lib/prisma'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'

export type C2CLeagueSettings = {
  source: 'legacy' | 'native'
  leagueId: string
  sportPair: string
  scoringMode: string
  campusScoreWeight: number
  cantonScoreWeight: number
  campusStarterSlots: number
  cantonStarterSlots: number
  benchSlots: number
  taxiSlots: number
  devySlots: number
  irSlots: number
  devyScoringEnabled: boolean
  startupDraftFormat: string
  futureDraftFormat: string
  taxiRookieOnly: boolean
  taxiMaxExperienceYears: number
  taxiLockDeadline: Date | null
  taxiPointsVisible: boolean
  basketballLineupFreq: string
  season: number
}

const sumSlots = (slots: Record<string, number> | null | undefined): number =>
  Object.values(slots ?? {}).reduce((total, n) => total + (Number.isFinite(n) && n > 0 ? n : 0), 0)

/** Native `standingsModel` in the legacy vocabulary the C2C copy already explains. */
export function nativeScoringMode(standingsModel: string | null | undefined): string {
  if (standingsModel === 'separate') return 'dual_track'
  if (standingsModel === 'hybrid') return 'weighted_combined'
  return 'combined_total'
}

export async function loadC2CLeagueSettings(leagueId: string): Promise<C2CLeagueSettings | null> {
  if (!leagueId) return null
  const legacy = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (legacy) {
    return {
      source: 'legacy',
      leagueId,
      sportPair: legacy.sportPair,
      scoringMode: legacy.scoringMode,
      campusScoreWeight: legacy.campusScoreWeight,
      cantonScoreWeight: legacy.cantonScoreWeight,
      campusStarterSlots: legacy.campusStarterSlots,
      cantonStarterSlots: legacy.cantonStarterSlots,
      benchSlots: legacy.benchSlots,
      taxiSlots: legacy.taxiSlots,
      devySlots: legacy.devySlots,
      irSlots: legacy.irSlots,
      devyScoringEnabled: legacy.devyScoringEnabled,
      startupDraftFormat: legacy.startupDraftFormat,
      futureDraftFormat: legacy.futureDraftFormat,
      taxiRookieOnly: legacy.taxiRookieOnly,
      taxiMaxExperienceYears: legacy.taxiMaxExperienceYears,
      taxiLockDeadline: legacy.taxiLockDeadline,
      taxiPointsVisible: legacy.taxiPointsVisible,
      basketballLineupFreq: legacy.basketballLineupFreq,
      season: legacy.season,
    }
  }

  const native = await getC2CConfig(leagueId).catch(() => null)
  if (!native) return null
  const proWeight = Math.min(100, Math.max(0, Number(native.hybridProWeight ?? 60))) / 100
  const season = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { season: true } })
    .then((l) => (typeof l?.season === 'number' ? l.season : new Date().getFullYear()))
    .catch(() => new Date().getFullYear())
  return {
    source: 'native',
    leagueId,
    sportPair: String(native.sport).toUpperCase() === 'NBA' ? 'NBA_CBB' : 'NFL_CFB',
    scoringMode: nativeScoringMode(native.standingsModel),
    campusScoreWeight: 1 - proWeight,
    cantonScoreWeight: proWeight,
    campusStarterSlots: sumSlots(native.collegeActiveLineupSlots),
    cantonStarterSlots: sumSlots(native.proLineupSlots),
    benchSlots: native.proBenchSize,
    taxiSlots: native.taxiSize,
    devySlots: native.collegeRosterSize,
    irSlots: native.proIRSize,
    // Native C2C scores the campus lineup; there is no separate stash-only devy bucket.
    devyScoringEnabled: true,
    startupDraftFormat: native.startupFormat === 'separate' ? 'split_campus_canton' : 'combined',
    futureDraftFormat: native.mergedRookieCollegeDraft ? 'combined' : 'split_campus_canton',
    taxiRookieOnly: true,
    taxiMaxExperienceYears: 1,
    taxiLockDeadline: null,
    taxiPointsVisible: true,
    basketballLineupFreq: 'weekly',
    season,
  }
}

/** True for a league of either kind. */
export async function isAnyC2CLeague(leagueId: string): Promise<boolean> {
  return (await loadC2CLeagueSettings(leagueId)) != null
}
