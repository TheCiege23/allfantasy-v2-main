/** Recorded provider replay. Only reads production; modeled rosters stay in memory. */
import { PrismaClient } from '@prisma/client'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { resolveFormatRosterDefaults } from '@/lib/league/roster-defaults'
import { getZombieCreationProfile } from '@/lib/zombie/creationPolicy'
import { getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'
import { replayBoxScores, replayRosterModel, summarizeRosterReplay, type RecordedBox, type ReplayWindow } from '@/lib/zombie/recordedBoxScoreReplay'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { weekWindowFromSeasonStart } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
const requireLocal = createRequire(join(process.cwd(), 'package.json'))
const { identifyTarget } = requireLocal('./scripts/db-target-identity.cjs') as { identifyTarget(url: string): { kind: string } }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const day = (d: Date) => d.toISOString().slice(0, 10)
const nextDay = (d: string) => day(new Date(Date.parse(`${d}T00:00:00Z`) + 86400000))
const easternDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const seasons: Array<[string, number]> = [['NFL',2025],['NBA',2026],['NHL',2026],['MLB',2026],['NCAAF',2026],['NCAAB',2025],['SOCCER',2025],['SOCCER',2026]]
async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url || identifyTarget(url).kind !== 'production' || process.env.ALLOW_ZOMBIE_READONLY_PROD !== '1') throw Error('Explicit known-production read-only approval required')
  const asOf = new Date().toISOString(), db = new PrismaClient({ datasources: { db: { url } } }), sports = []
  try {
    for (const [sport, season] of seasons) {
      const data = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '45000ms'")
        const raw = await tx.playerGameStat.findMany({ where: { sportType: sport, season }, orderBy: { id: 'asc' }, take: 150001,
          select: { playerId: true, gameId: true, providerPlayerId: true, providerGameId: true, gameDate: true, weekOrRound: true, normalizedStatMap: true, source: true } })
        if (raw.length > 150000) throw Error(`${sport} row bound exceeded`)
        const identities = await tx.playerIdentityMap.findMany({ where: { sport }, select: { id: true, position: true, sleeperId: true, cfbdId: true, rollingInsightsId: true } })
        const positions = new Map<string, string | null>(), canonical = new Map<string, string | null>()
        const remember = (key: string, id: string, position: string | null) => { if (canonical.has(key) && canonical.get(key) !== id) { canonical.set(key, null); positions.set(key, null) } else { canonical.set(key, id); positions.set(key, position) } }
        for (const p of identities) { remember(`id:${p.id}`, p.id, p.position); if (p.sleeperId) remember(`sleeper:${p.sleeperId}`, p.id, p.position); if (p.cfbdId) remember(`cfbd:${p.cfbdId}`, p.id, p.position); if (p.rollingInsightsId) remember(`ri:${p.rollingInsightsId}`, p.id, p.position) }
        const scheduleTypes = new Map<string, 'regular' | 'pre' | 'post' | null>(); let scheduleRecoveredLabels = 0
        let calendarSource = '', windows: ReplayWindow[] = [], expectedGames: number | null = null
        if (sport === 'NFL' || sport === 'NCAAF') {
          const source = sport === 'NFL' ? 'espn_draft_history_v1' : 'cfbd'
          const games = await tx.sportsGame.findMany({ where: { sport, season, source, week: { gte: 1, lte: getZombieCreationProfile(sport).scoringPeriods }, startTime: { not: null } }, select: { week: true, startTime: true, seasonType: true } })
          const byPeriod = new Map<number, string[]>()
          for (const game of games) { if (sport === 'NCAAF' && game.seasonType && !/^(regular|regular season|reg|2)$/i.test(game.seasonType)) continue; const list = byPeriod.get(game.week!) ?? []; list.push(easternDay(game.startTime!)); byPeriod.set(game.week!, list) }
          windows = [...byPeriod.entries()].map(([period, dates]) => ({ period, start: dates.sort()[0], end: nextDay(dates.sort().at(-1)!) })).sort((a, b) => a.period - b.period)
          calendarSource = `${source}: stored scheduled period bounds`; expectedGames = games.length
        } else {
          if (sport === 'NCAAB' && season === 2025) { /* Explicit replay-only opener verified against NCAA's published 2025-26 calendar. */ }
          else await ensureDailySportSeasonStart(sport, season, { db: tx, now: new Date(asOf) })
          for (let period = 1; period <= getZombieCreationProfile(sport).scoringPeriods; period++) { const w = sport === 'NCAAB' && season === 2025 ? weekWindowFromSeasonStart('2025-11-03T00:00:00Z', period) : resolveDailySportWeekWindow(sport, season, period); if (w) windows.push({ period, start: day(w.start), end: day(w.end) }) }
          calendarSource = sport === 'NCAAB' && season === 2025 ? 'Replay-only NCAA published 2025-11-03 opener' : 'production daily-sport/date-gameweek resolver'
          if (windows.length) { const cache = await readRiScheduleWindow(tx as never, { sport, season, window: { start: new Date(`${windows[0].start}T00:00:00Z`), end: new Date(`${windows.at(-1)!.end}T00:00:00Z`) } }); expectedGames = cache ? cache.filter(g => g.seasonType === 'regular').length : null; cache?.forEach(g => scheduleTypes.set(g.gameId, g.seasonType)) }
        }
        let unresolvedIdentityRows = 0
        const rows: RecordedBox[] = raw.map(r => {
          const meta = object(r.normalizedStatMap)
          const ns = sport === 'NCAAF' && (String(r.source).includes('cfbd') || Object.keys(meta).some(k => k.includes('.'))) ? 'cfbd' : sport === 'NFL' ? 'sleeper' : 'ri'
          const idKey = canonical.has(`id:${r.playerId}`) ? `id:${r.playerId}` : `${ns}:${r.providerPlayerId ?? r.playerId}`
          const resolved = canonical.get(idKey)
          if (!resolved) unresolvedIdentityRows++
          const position = typeof meta.position === 'string' ? meta.position : positions.get(idKey) ?? null
          const date = r.gameDate ? day(r.gameDate) : null
          let seasonType = resolveStoredSeasonType({ normalizedStatMap: meta, sport, season, gameDate: r.gameDate })
          if (seasonType == null && r.providerGameId && scheduleTypes.has(r.providerGameId)) { seasonType = scheduleTypes.get(r.providerGameId) ?? null; if (seasonType != null) scheduleRecoveredLabels++ }
          if (seasonType == null && ['NFL','NCAAF'].includes(sport) && date && windows.some(w => w.period === r.weekOrRound && date >= w.start && date < w.end)) seasonType = 'regular'
          return { player: resolved ?? `${ns}:${r.playerId}`, game: `${r.providerGameId ?? r.gameId}:${String(meta.group ?? 'all')}`, day: date, period: r.weekOrRound, position, identityResolved: Boolean(resolved), source: r.source, seasonType, stats: r.normalizedStatMap }
        })
        return { rows, calendarSource, windows, expectedGames, unresolvedIdentityRows, scheduleRecoveredLabels, sources: [...new Set(raw.map(r => r.source ?? 'legacy_source_unrecorded'))] }
      }, { timeout: 120000 })
      const replay = replayBoxScores(sport, data.rows, data.windows, asOf), roster = resolveFormatRosterDefaults({ sport, formatId: 'zombie' }), cfg = getZombieSportConfig(sport)
      const slots = Object.entries(roster.starterSlots).flatMap(([slot, n]) => Array.from({ length: n }, () => slot)), eligibility = Object.fromEntries(roster.flexDefinitions.map(f => [f.slotName, f.allowedPositions]))
      const models = [20, 4].flatMap(managers => [1, 7, 23].map(seed => ({ seed, ...summarizeRosterReplay(replayRosterModel({ sport, players: replay.players, windows: replay.windows, slots, bench: roster.benchSlots, managers, seed, eligibility }), cfg.bashingThreshold, cfg.maulingThreshold, 6 / 360) })))
      const digest = createHash('sha256'); for (const r of data.rows) digest.update(JSON.stringify([r.player, r.game, r.day, r.period, r.position, r.identityResolved, r.seasonType, r.stats]))
      sports.push({ sport, season, asOf, calendarSource: data.calendarSource, calendarWindows: data.windows, expectedRegularScheduleGames: data.expectedGames, sources: data.sources, unresolvedIdentityRows: data.unresolvedIdentityRows, scheduleRecoveredLabels: data.scheduleRecoveredLabels,
        recordedInputSha256: digest.digest('hex'), scoring: { label: replay.profile.label, weights: Object.fromEntries(replay.profile.categories.map(c => [c.key, replay.profile.overrides[c.key] ?? c.defaultPoints])) },
        roster: { starterSlots: roster.starterSlots, bench: roster.benchSlots, flexDefinitions: roster.flexDefinitions, authority: 'resolveFormatRosterDefaults(zombie)' }, diagnostics: replay.diagnostics, models,
        currentMarginThresholds: { bashing: cfg.bashingThreshold, mauling: cfg.maulingThreshold }, acceptedCalibration: false, productionChanges: false })
      process.stderr.write(`${sport}: ${replay.diagnostics.normalizedRegularRows} recorded stat lines re-scored; ${replay.diagnostics.observedPeriods} completed periods\n`)
    }
    process.stdout.write(JSON.stringify({ observedAt: new Date().toISOString(), target: 'verified-production-read-only', replayType: 'recorded-box-scores-with-modeled-training-only-rosters', referenceMarginRate: { crossings: 6, matchups: 360, rate: 6 / 360, kind: 'descriptive-imported-NFL-2025-raw-margin-reference' }, sports,
      limitations: ['No provider requests, production writes, real draft starts or acceptance records.', 'Modeled rosters and retrospective appearance knowledge are diagnostic, not manager behavior.', 'Rankings use two earlier completed periods only; later player positions may still reflect current identity records.', 'Scores and windows are replayed; full provider/game/lineup completeness is not inferred.', 'No real role/item inventory history is available: item shocks are counterfactual sensitivity only.', 'Seeds are tie-break scenarios, not independent leagues or confidence samples.', 'Non-NFL gameplay thresholds remain unchanged.'] }, null, 2) + '\n')
  } finally { await db.$disconnect() }
}
main().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted connection]')); process.exitCode = 1 })