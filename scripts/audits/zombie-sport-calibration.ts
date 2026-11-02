/** Database-only calibration inventory; no provider calls, mutations or acceptance signoffs. */
import { PrismaClient } from '@prisma/client'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { calibrationCoverage, describeMarginCrossings, inspectCalibrationRows, proposeFrequencyMatch, scoreDistribution, type CalibrationRow } from '../../lib/zombie/sportCalibration'
import { DEFAULT_ENGINE_WEAPONS, getAllSportKeys, getZombieSportConfig } from '../../lib/zombie/sportRulesConfig'
const requireLocal = createRequire(join(process.cwd(), 'package.json'))
const { identifyTarget } = requireLocal('./scripts/db-target-identity.cjs') as { identifyTarget(url: string): { kind: string } }
const starterSlots = (value: unknown): string[] => Array.isArray(value) ? value.filter((slot): slot is string => typeof slot === 'string') : []
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Explicit database connection required')
  const connection = new URL(url), production = identifyTarget(url).kind === 'production'
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname) && ['zombie_release', 'allfantasy_ci'].includes(connection.pathname.slice(1))
  if (!local && !(production && process.env.ALLOW_ZOMBIE_READONLY_PROD === '1')) throw new Error('Use approved loopback or the explicit known-production read-only guard')
  const rawSeasons = process.env.ZOMBIE_CALIBRATION_SEASONS ?? ''
  if (!/^\d{4}(,\d{4}){0,2}$/.test(rawSeasons)) throw new Error('Set one to three explicit calibration seasons')
  const seasons = [...new Set(rawSeasons.split(',').map(Number))]
  if (seasons.some(year => year < 2020 || year > 2200)) throw new Error('Invalid calibration seasons')
  const sports = getAllSportKeys().map(key => key.toUpperCase()), db = new PrismaClient({ datasources: { db: { url } } })
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '45000ms'")
      const facts = await tx.matchupFact.findMany({ where: { sport: { in: sports }, season: { in: seasons } }, take: 100001,
        select: { leagueId: true, sport: true, season: true, weekOrPeriod: true, teamA: true, teamB: true, scoreA: true, scoreB: true } })
      if (facts.length > 100000) throw new Error('Historical row bound exceeded; use a narrower explicit season range')
      const leagues = await tx.league.findMany({ where: { id: { in: [...new Set(facts.map(r => r.leagueId))] } },
        select: { id: true, platform: true, starters: true, leagueSize: true, scoring: true, scoringPresetId: true, settings: true } })
      const native = await tx.redraftMatchup.findMany({ where: { season: { sport: { in: sports }, season: { in: seasons } }, isMedianMatchup: false, awayRosterId: { not: null }, status: { in: ['final', 'complete', 'completed'] } }, take: 10001,
        select: { leagueId: true, week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, lineupSnapshots: true, season: { select: { sport: true, season: true } }, league: { select: { leagueVariant: true, starters: true, leagueSize: true, scoringPresetId: true } } } })
      if (native.length > 10000) throw new Error('Native row bound exceeded')
      const templates = await tx.zombieRulesTemplate.findMany({ select: { sport: true, bashingThreshold: true, maulingThreshold: true, weaponShieldThreshold: true, weaponAmbushThreshold: true } })
      const calendars = await tx.sportsGame.groupBy({ by: ['sport', 'season', 'source'], where: { sport: { in: sports }, season: { in: seasons }, startTime: { not: null } }, _count: true })
      const rows: Record<string, CalibrationRow[]> = Object.fromEntries(sports.map(sport => [sport, []]))
      const diagnostics = []
      for (const sport of sports) {
        const cfg = getZombieSportConfig(sport), template = templates.find(t => t.sport === sport), weapons = cfg.engineWeapons ?? DEFAULT_ENGINE_WEAPONS
        const cohorts = new Map<string, { platform: string; seasons: Set<number>; leagues: Set<string>; teamCount: number | null; starters: string[]; rows: CalibrationRow[] }>()
        for (const f of facts.filter(row => row.sport === sport)) {
          const league = leagues.find(l => l.id === f.leagueId), settings = object(league?.settings)
          const key = digest({ platform: league?.platform, starters: starterSlots(league?.starters), size: league?.leagueSize, scoring: league?.scoring, preset: league?.scoringPresetId, rules: settings.scoringSettings })
          let cohort = cohorts.get(key)
          if (!cohort) { cohort = { platform: league?.platform ?? 'unresolved', seasons: new Set(), leagues: new Set(), teamCount: league?.leagueSize ?? null, starters: starterSlots(league?.starters), rows: [] }; cohorts.set(key, cohort) }
          cohort.seasons.add(f.season!); cohort.leagues.add(f.leagueId)
          // Warehouse facts have no finality, period-completion, provider-proof or historical
          // roster/scoring snapshot. Positive points or a current preset cannot supply that proof.
          cohort.rows.push({ league: f.leagueId, season: f.season!, period: f.weekOrPeriod, teamA: f.teamA, teamB: f.teamB, scoreA: f.scoreA, scoreB: f.scoreB, baseScoreA: null, baseScoreB: null,
            configuration: key, final: false, providerVerified: false, lineupComplete: false, profileMatchesZombie: false, correctionHeld: false, synthetic: false })
        }
        const nativeRows = native.filter(m => m.season.sport === sport).map(m => {
          const snapshot = object(m.lineupSnapshots), scored = object(snapshot.redraftScoring), items = object(snapshot.zombieItems)
          return { league: m.leagueId, season: m.season.season, period: m.week, teamA: m.homeRosterId, teamB: m.awayRosterId, scoreA: m.homeScore, scoreB: m.awayScore,
            baseScoreA: typeof items.homeBaseScore === 'number' ? items.homeBaseScore : null, baseScoreB: typeof items.awayBaseScore === 'number' ? items.awayBaseScore : null,
            configuration: digest(m.league), final: true, providerVerified: false, lineupComplete: scored.isComplete === true && Array.isArray(scored.missingPlayerIds) && scored.missingPlayerIds.length === 0,
            profileMatchesZombie: m.league.leagueVariant === 'zombie', correctionHeld: false, synthetic: false }
        })
        rows[sport].push(...nativeRows, ...[...cohorts.values()].flatMap(c => c.rows))
        diagnostics.push({ sport, effectiveCombatThresholds: { bashing: sport === 'NFL' ? 60 : template?.bashingThreshold ?? cfg.bashingThreshold, mauling: sport === 'NFL' ? 60 : template?.maulingThreshold ?? cfg.maulingThreshold },
          itemPolicy: sport === 'NFL' ? { mode: 'beta_2025_exclusive_bands', bands: [100, 105, 110, 115, 120] } : { mode: 'legacy_threshold_and_achievement', knife: template?.weaponShieldThreshold ?? weapons.knifeScore, bow: template?.weaponAmbushThreshold ?? weapons.bowScore, axeMargin: weapons.axeWinMargin, documentedKnife: cfg.weaponThresholds.find(w => w.type === 'weapon_knife')?.minPoints ?? null },
          native: { rows: nativeRows.length, zombieRows: nativeRows.filter(m => m.profileMatchesZombie).length, completeLineupSnapshots: nativeRows.filter(m => m.lineupComplete).length, coverage: calibrationCoverage(nativeRows) },
          omittedOtherNflCohorts: sport === 'NFL' ? [...cohorts.values()].filter(c => c.teamCount !== 20).length : 0, historicalCohorts: [...cohorts.values()].filter(c => sport !== 'NFL' || c.teamCount === 20).map(c => { const inspected = inspectCalibrationRows(c.rows); return { platform: c.platform, seasons: [...c.seasons].sort(), leagues: c.leagues.size, managerCount: c.teamCount, rosterShape: c.starters, inputRows: c.rows.length,
            uniquePairings: inspected.diagnostic.length, duplicateRows: inspected.duplicateRows, conflictingPairings: inspected.reasons.conflicting_pairing ?? 0, unknownZeroPairs: inspected.diagnostic.filter(r => r.scoreA === 0 && r.scoreB === 0).length,
            diagnosticScoreDistribution: scoreDistribution(inspected.diagnostic.flatMap(r => [r.scoreA, r.scoreB])), qualification: 'unverified_finality_and_historical_configuration' } }),
          savedCalendars: calendars.filter(c => c.sport === sport).map(c => ({ season: c.season, source: c.source, rows: c._count })),
          coverage: calibrationCoverage(rows[sport]) })
      }
      const reference = rows.NFL.filter(r => r.season === 2025)
      const betaShapeLeagues = new Set(leagues.filter(l => l.leagueSize === 20 && starterSlots(l.starters).filter(s => !['BN','IR','TAXI','DEVY'].includes(s.toUpperCase())).length === 5 && starterSlots(l.starters).filter(s => s.toUpperCase() === 'FLEX').length === 4 && starterSlots(l.starters).some(s => ['SUPER_FLEX','SUPERFLEX','SF'].includes(s.toUpperCase()))).map(l => l.id))
      const historicalNFLBenchmark = describeMarginCrossings(reference.filter(r => betaShapeLeagues.has(r.league)))
      return { observedAt: new Date().toISOString(), target: production ? 'verified-production-read-only' : 'explicit-loopback-read-only', seasons,
        objective: 'Match approved NFL Beta 2025 event frequencies within comparable scoring/roster cohorts', historicalNFLBenchmark, diagnostics,
        comparisons: sports.filter(s => s !== 'NFL').map(sport => ({ sport, analysis: proposeFrequencyMatch(reference, rows[sport]) })),
        rulesChanged: false, acceptanceRecorded: false,
        limitations: ['No provider API calls, database writes, draft starts or signoffs.', 'Calendars/points alone do not establish finality or completeness.', 'Imported current settings do not prove historical scoring or lineup rules.', 'No intervals are claimed for dependent team-period observations.', 'Legacy non-NFL items require mechanics review before adopting NFL-style score bands.'] }
    }, { timeout: 90000 })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } finally { await db.$disconnect() }
}
main().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted connection]')); process.exitCode = 1 })