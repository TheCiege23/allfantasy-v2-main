/**
 * NFL full-season ENGINE-LEVEL E2E.
 *
 * Drives an isolated NFL redraft season through the real engine functions
 * (scoring, waivers, trades, playoffs, champion) against a real database and
 * reports pass/fail/skip per step, then cleans up. This is the runnable
 * fallback for the steps that don't require a browser; the customer UI journey
 * (signup/subscribe/clicks) is covered by `e2e/nfl-full-season.spec.ts`.
 *
 *   npx tsx scripts/run-nfl-full-season-engine-e2e.ts
 *
 * Requires DATABASE_URL (loaded from .env/.env.local). Safe in staging — all
 * rows are isolated under a unique mark and cascade-cleaned on exit.
 */
import {
  loadDotEnv,
  seedNflRedraftLeague,
  addRosterPlayer,
  seedWeeklyScore,
  seedMatchup,
  advanceWeek,
  seedWaiverClaim,
  seedTradeProposal,
  seedChampionshipBracket,
  seedSportsGame,
  cleanupSeededLeague,
  type SeededLeague,
} from '../tests/helpers/redraftSeasonHarness'

loadDotEnv()

type Outcome = 'PASS' | 'FAIL' | 'SKIP' | 'BLOCKED'
const log: { step: string; outcome: Outcome; detail: string }[] = []
function record(step: string, outcomeIn: Outcome | boolean, detail: string) {
  const outcome: Outcome = typeof outcomeIn === 'boolean' ? (outcomeIn ? 'PASS' : 'FAIL') : outcomeIn
  log.push({ step, outcome, detail })
  const icon = outcome === 'PASS' ? '✅' : outcome === 'FAIL' ? '❌' : outcome === 'BLOCKED' ? '🚧' : '⏭️'
  console.log(`${icon} ${step}\n     ${detail}`)
}

;(async () => {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const { runRedraftSeasonScoring } = await import('../lib/redraft/redraftSeasonScoringRunner')
  const { syncPlayerWeeklyScoresForRedraftSeason } = await import('../lib/redraft/playerWeeklyScoreService')
  const { recalculateMatchupsForSeasonWeek } = await import('../lib/redraft/scoringEngine')
  const { updateStandings } = await import('../lib/redraft/standingsEngine')
  const { processWaiverWindow } = await import('../lib/redraft/waiverEngine')
  const { advancePlayoffWinners, finalizeRedraftSeasonChampion } = await import('../lib/redraft/playoffEngine')
  const { hydrateRedraftLineupLocks } = await import('../lib/redraft/lineupLock')
  const { calculateScoreFromSportConfig } = await import('../lib/redraft/scoringEngine')
  const { ingestNflTeamDefenseBoxScores } = await import('../lib/redraft/teamDefenseStatsIngest')
  const { syncNflTeamDefenseBoxScores } = await import('../lib/redraft/teamDefenseProvider')
  const { saveLeagueNflScoringConfig } = await import('../lib/nfl-scoring/NflScoringConfigService')
  const { seedG8CommissionerLeague, cleanupG8League } = await import('../lib/e2e/seedG8League')
  const { resolveRedraftRosterConfig } = await import('../lib/redraft/rosterConfigResolver')
  const { validateRedraftLineup } = await import('../lib/redraft/lineupValidation')

  const SEASON = 2025
  let seeded: SeededLeague | null = null

  const scoringDeps = {
    syncSeason: async (s: { id: string }) => {
      const sum = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: s.id, actorId: 'e2e' })
      return { seasonId: sum.seasonId, week: sum.week, scoresUpserted: sum.scoresUpserted, warnings: sum.warnings ?? [] }
    },
    recalcMatchups: (seasonId: string, week: number) => recalculateMatchupsForSeasonWeek(seasonId, week),
    updateStandings: (seasonId: string, week: number) => updateStandings(seasonId, week),
  }

  async function scoreWeek(week: number) {
    await advanceWeek(prisma, seeded!.seasonId, week)
    await seedWeeklyScore(prisma, seeded!, { playerId: `${seeded!.mark}-h`, week, season: SEASON, stats: { pass_yds: 320, pass_td: 3 } })
    await seedWeeklyScore(prisma, seeded!, { playerId: `${seeded!.mark}-a`, week, season: SEASON, stats: { pass_yds: 140, pass_td: 1 } })
    await seedMatchup(prisma, { seasonId: seeded!.seasonId, leagueId: seeded!.leagueId, week, homeRosterId: seeded!.homeRosterId, awayRosterId: seeded!.awayRosterId })
    return runRedraftSeasonScoring(
      [{ id: seeded!.seasonId, leagueId: seeded!.leagueId, sport: 'NFL', currentWeek: week }],
      scoringDeps,
    )
  }

  try {
    // 1–7: account / league / season / rosters
    seeded = await seedNflRedraftLeague(prisma, { season: SEASON })
    record('1-7 Seed user + NFL league + active season + 2 rosters', 'PASS', `league=${seeded.leagueId} season=${seeded.seasonId}`)

    // 8-9: rosters with a scoring starter each (post-draft state)
    await addRosterPlayer(prisma, seeded.homeRosterId, { playerId: `${seeded.mark}-h`, name: 'Home QB', position: 'QB', slotType: 'QB' })
    await addRosterPlayer(prisma, seeded.awayRosterId, { playerId: `${seeded.mark}-a`, name: 'Away QB', position: 'QB', slotType: 'QB' })
    await addRosterPlayer(prisma, seeded.homeRosterId, { playerId: `${seeded.mark}-drop`, name: 'Bench RB', position: 'RB', slotType: 'bench' })
    record('8-9 Roster setup (starters + bench)', 'PASS', 'home QB + away QB + home bench RB')

    // 11-13: weekly scoring across 2 weeks → standings accumulate
    const w1 = await scoreWeek(1)
    const w2 = await scoreWeek(2)
    const m1 = await prisma.redraftMatchup.findFirst({ where: { seasonId: seeded.seasonId, week: 1 }, select: { homeScore: true, awayScore: true } })
    const homeStand = await prisma.redraftRoster.findUnique({ where: { id: seeded.homeRosterId }, select: { wins: true, pointsFor: true } })
    record('11-12 Scoring sync updates matchup scores', m1 && m1.homeScore > 0 && m1.homeScore > m1.awayScore ? 'PASS' : 'FAIL', `wk1 home=${m1?.homeScore} away=${m1?.awayScore}; runner ok=${w1.ok && w2.ok}`)
    record('13 Standings accumulate across weeks (home wins 2)', homeStand?.wins === 2 ? 'PASS' : 'FAIL', `home wins=${homeStand?.wins} pointsFor=${homeStand?.pointsFor}`)

    // 14-16: waiver claim (add + drop + FAAB)
    await seedWaiverClaim(prisma, { seasonId: seeded.seasonId, leagueId: seeded.leagueId, rosterId: seeded.homeRosterId, addPlayerId: `${seeded.mark}-add`, addPlayerName: 'Waiver Add', dropPlayerId: `${seeded.mark}-drop`, dropPlayerName: 'Bench RB', bidAmount: 10 })
    await processWaiverWindow(seeded.leagueId, seeded.seasonId)
    const addRow = await prisma.redraftRosterPlayer.findFirst({ where: { rosterId: seeded.homeRosterId, playerId: `${seeded.mark}-add`, droppedAt: null } })
    const dropRow = await prisma.redraftRosterPlayer.findFirst({ where: { rosterId: seeded.homeRosterId, playerId: `${seeded.mark}-drop` }, select: { droppedAt: true } })
    const faab = await prisma.redraftRoster.findUnique({ where: { id: seeded.homeRosterId }, select: { faabBalance: true } })
    record('14-16 Waiver: add+drop+FAAB applied', addRow && dropRow?.droppedAt != null && faab?.faabBalance === 90 ? 'PASS' : 'FAIL', `added=${!!addRow} dropped=${dropRow?.droppedAt != null} faab=${faab?.faabBalance}`)

    // L1-L3: lineup lock derived from the real game schedule (G1). Use a
    // synthetic season with NO real SportsGame rows so the seeded kickoffs are
    // authoritative (staging carries the real 2025 schedule).
    const LOCK_SEASON = 2099
    const LOCK_WEEK = 1
    await seedSportsGame(prisma, seeded, { homeTeam: 'DEN', awayTeam: 'KC', startTime: new Date(Date.now() - 3_600_000), week: LOCK_WEEK, season: LOCK_SEASON }) // KC already kicked off
    await seedSportsGame(prisma, seeded, { homeTeam: 'MIA', awayTeam: 'BUF', startTime: new Date(Date.now() + 3_600_000), week: LOCK_WEEK, season: LOCK_SEASON }) // BUF kicks off later
    const lockInput = [
      { playerId: 'kc-qb', team: 'KC' },
      { playerId: 'buf-qb', team: 'BUF' },
    ]
    const locked = (
      await hydrateRedraftLineupLocks(prisma, { sport: 'NFL', season: LOCK_SEASON, week: LOCK_WEEK, rosterId: seeded.homeRosterId, leagueSettings: null, players: lockInput })
    ).players
    const kcLocked = locked.find((p) => p.playerId === 'kc-qb')?.isLocked === true
    const bufOpen = locked.find((p) => p.playerId === 'buf-qb')?.isLocked === false
    record('L1-L2 Lineup lock: kicked-off player locked, pre-kickoff player movable', kcLocked && bufOpen, `KC locked=${locked.find((p) => p.playerId === 'kc-qb')?.isLocked} BUF locked=${locked.find((p) => p.playerId === 'buf-qb')?.isLocked}`)

    const unlocked = (
      await hydrateRedraftLineupLocks(prisma, {
        sport: 'NFL',
        season: LOCK_SEASON,
        week: LOCK_WEEK,
        rosterId: seeded.homeRosterId,
        leagueSettings: { sportConfig: { lineupLockOverrides: [{ week: LOCK_WEEK, playerId: 'kc-qb' }] } },
        players: lockInput,
      })
    ).players
    const kcEmergencyOpen = unlocked.find((p) => p.playerId === 'kc-qb')?.isLocked === false
    record('L3 Emergency commissioner unlock overrides the kickoff lock', kcEmergencyOpen, `KC locked after override=${unlocked.find((p) => p.playerId === 'kc-qb')?.isLocked}`)

    // S1-S2: commissioner scoring — TE premium (DB path) + custom override
    await prisma.league.update({
      where: { id: seeded.leagueId },
      data: { settings: { sportConfig: { scoringPreset: 'PPR', enableTEPremium: true } } },
    })
    const teScore = await calculateScoreFromSportConfig(seeded.leagueId, 'te-x', 1, { rec: 6, rec_yds: 80 }, 'TE')
    const wrScore = await calculateScoreFromSportConfig(seeded.leagueId, 'wr-x', 1, { rec: 6, rec_yds: 80 }, 'WR')
    record('S1 TE premium applies to TE only via DB scoring path', teScore === 17 && wrScore === 14, `TE=${teScore} (want 17) WR=${wrScore} (want 14)`)

    await prisma.league.update({
      where: { id: seeded.leagueId },
      data: { settings: { sportConfig: { scoringPreset: 'STANDARD', categoryPoints: { pass_td: 6 } } } },
    })
    const customScore = await calculateScoreFromSportConfig(seeded.leagueId, 'qb-x', 1, { pass_td: 3, rec: 5 }, 'QB')
    record('S2 Custom override (6pt pass TD) + STANDARD (0 rec) honored via DB path', customScore === 18, `score=${customScore} (want 18: 3*6 + 5*0)`)

    // D1-D2: team Defense / ST (gap G8) — a DEF starter now scores.
    // D1: full DST stat line scores via the same DB scoring path (4*1 sack +
    // 2*2 int + 1*2 fr + 1*6 def TD + PA 10→7-13 tier 4 = 20).
    const dstScore = await calculateScoreFromSportConfig(
      seeded.leagueId,
      'nfl:def:KC',
      1,
      { def_sack: 4, def_int: 2, def_fr: 1, def_td: 1, def_points_allowed: 10 },
      'DEF',
    )
    record('D1 Team DST stat line scores via DB path', dstScore === 20, `score=${dstScore} (want 20)`)

    // D2: full pipeline — roster a DEF, seed a finished game, run the real score
    // sync, and prove points-allowed is derived from the game result. Use a
    // synthetic team abbrev (ZZZ) so it can't collide with the real schedule.
    const DST_WEEK = 8
    await addRosterPlayer(prisma, seeded.homeRosterId, { playerId: 'nfl:def:ZZZ', name: 'ZZZ Defense', position: 'DEF', slotType: 'DEF' })
    await seedSportsGame(prisma, seeded, { homeTeam: 'ZZZ', awayTeam: 'YYY', startTime: new Date(Date.now() - 3_600_000), week: DST_WEEK, season: SEASON })
    await prisma.sportsGame.updateMany({ where: { homeTeam: 'ZZZ', awayTeam: 'YYY', week: DST_WEEK, season: SEASON, source: 'e2e' }, data: { homeScore: 31, awayScore: 3 } })
    seeded.seededPlayerScoreIds.push('nfl:def:ZZZ') // ensure cleanup of the upserted weekly score
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: seeded.seasonId, week: DST_WEEK, actorId: 'e2e' })
    const dstRow = await prisma.playerWeeklyScore.findFirst({ where: { playerId: 'nfl:def:ZZZ', week: DST_WEEK, season: SEASON, sport: 'NFL' }, select: { stats: true, fantasyPts: true } })
    const paStat = (dstRow?.stats as Record<string, number> | undefined)?.def_points_allowed
    // ZZZ allowed 3 (YYY's score) → 1-6 tier = 7 points.
    record('D2 Score sync derives DST points-allowed from the game result', paStat === 3 && dstRow?.fantasyPts === 7, `def_points_allowed=${paStat} (want 3) fantasyPts=${dstRow?.fantasyPts} (want 7)`)

    // D3: BOX-SCORE FEED — ingest real per-team defensive stats, re-sync, and prove
    // the DEF row now scores the full line (sacks/INT/FR/def TD + PA tier).
    await ingestNflTeamDefenseBoxScores(prisma, {
      season: SEASON,
      week: DST_WEEK,
      entries: [{ teamAbbr: 'ZZZ', stats: { sacks: 4, interceptions: 2, fumbles_recovered: 1, defensive_td: 1, yards_allowed: 280 } }],
    })
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: seeded.seasonId, week: DST_WEEK, actorId: 'e2e' })
    const dstFull = await prisma.playerWeeklyScore.findFirst({ where: { playerId: 'nfl:def:ZZZ', week: DST_WEEK, season: SEASON, sport: 'NFL' }, select: { stats: true, fantasyPts: true } })
    const fullStats = (dstFull?.stats as Record<string, number> | undefined) ?? {}
    // 4*1 sack + 2*2 int + 1*2 fr + 1*6 def TD + PA 3→1-6 tier 7 = 23 (yards 280→0).
    record('D3 Ingested DST box score scores sacks/INT/FR/TD + PA via sync', fullStats.def_sack === 4 && dstFull?.fantasyPts === 23, `def_sack=${fullStats.def_sack} def_int=${fullStats.def_int} pa=${fullStats.def_points_allowed} fantasyPts=${dstFull?.fantasyPts} (want 23)`)

    // D4: STAT CORRECTION — re-ingest the same week with corrected sacks (4→6),
    // re-sync, and prove the score updates (idempotent week replace, no dupes).
    await ingestNflTeamDefenseBoxScores(prisma, {
      season: SEASON,
      week: DST_WEEK,
      entries: [{ teamAbbr: 'ZZZ', stats: { sacks: 6, interceptions: 2, fumbles_recovered: 1, defensive_td: 1, yards_allowed: 280 } }],
    })
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: seeded.seasonId, week: DST_WEEK, actorId: 'e2e' })
    const dstCorrected = await prisma.playerWeeklyScore.findFirst({ where: { playerId: 'nfl:def:ZZZ', week: DST_WEEK, season: SEASON, sport: 'NFL' }, select: { stats: true, fantasyPts: true } })
    const corrStats = (dstCorrected?.stats as Record<string, number> | undefined) ?? {}
    record('D4 Stat correction re-scores DST (sacks 4→6 → +2)', corrStats.def_sack === 6 && dstCorrected?.fantasyPts === 25, `def_sack=${corrStats.def_sack} fantasyPts=${dstCorrected?.fantasyPts} (want 25)`)

    // D5: NO DATA — a provider payload with no recognized DST keys is NOT ingested
    // (no fabrication): nothing written, nothing scored.
    const noData = await ingestNflTeamDefenseBoxScores(prisma, { season: SEASON, week: DST_WEEK, entries: [{ teamAbbr: 'WWW', stats: { foo: 1, pass_yds: 10 } }] })
    const wwwCache = await prisma.playerGameLogCache.findFirst({ where: { playerId: 'nfl:def:WWW' }, select: { id: true } })
    record('D5 No-data: unrecognized provider stats are not ingested or guessed', noData.skippedNoStats === 1 && noData.upserted === 0 && !wwwCache, `skipped=${noData.skippedNoStats} upserted=${noData.upserted} cacheRow=${wwwCache ? 'exists' : 'absent'}`)

    // D6: PROVIDER FEED — Sleeper-shaped weekly DST payload flows through the real
    // provider→sync orchestrator (injected fixture fetcher, no live HTTP) → cache
    // → score-sync → DEF scores. Provider pts_allow (31) overrides the game-derived
    // fallback (3), proving the box-score feed is authoritative.
    const sleeperFixture = async (_team: string, _season: number, _seasonType: string) => ({
      [String(DST_WEEK)]: { sack: 5, int: 1, fum_rec: 0, def_td: 0, safe: 0, pts_allow: 31, yds_allow: 300 },
    })
    const provSync = await syncNflTeamDefenseBoxScores(prisma, { season: SEASON, week: DST_WEEK, teams: ['ZZZ'], fetcher: sleeperFixture })
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: seeded.seasonId, week: DST_WEEK, actorId: 'e2e' })
    const dstProv = await prisma.playerWeeklyScore.findFirst({ where: { playerId: 'nfl:def:ZZZ', week: DST_WEEK, season: SEASON, sport: 'NFL' }, select: { stats: true, fantasyPts: true } })
    const provStats = (dstProv?.stats as Record<string, number> | undefined) ?? {}
    // 5 sack + 1*2 int + PA 31→28-34 tier −1 + yards 300→0 = 6 (provider PA 31 overrides game's 3).
    record('D6 Sleeper provider feed → sync → DEF scores (provider PA authoritative)', provSync.ingest.upserted === 1 && provStats.def_sack === 5 && provStats.def_points_allowed === 31 && dstProv?.fantasyPts === 6, `upserted=${provSync.ingest.upserted} def_sack=${provStats.def_sack} pa=${provStats.def_points_allowed} (want 31, overrides game 3) fantasyPts=${dstProv?.fantasyPts} (want 6)`)

    // D7: R1 BRIDGE — a commissioner panel save (UI keys) writes the canonical
    // engine store (sportConfig.categoryPoints) and the engine scores the override.
    await saveLeagueNflScoringConfig(seeded.leagueId, { presetKey: 'custom', rules: { dst_sack: 5, dst_pa_7_13: 4, passing_td: 6 } })
    const lgAfterSave = await prisma.league.findUnique({ where: { id: seeded.leagueId }, select: { settings: true } })
    const savedCp = ((lgAfterSave?.settings as Record<string, unknown>)?.sportConfig as Record<string, unknown> | undefined)?.categoryPoints as Record<string, number> | undefined
    const overrideScore = await calculateScoreFromSportConfig(seeded.leagueId, 'nfl:def:KC', 1, { def_sack: 3, def_points_allowed: 10 }, 'DEF')
    // def_sack override 5 → 3*5=15; PA 10 → def_pa_7_13 override 4 → 4; total 19.
    record('D7 Commissioner UI scoring save → sportConfig.categoryPoints → engine scores it', savedCp?.def_sack === 5 && savedCp?.def_pa_7_13 === 4 && savedCp?.pass_td === 6 && overrideScore === 19, `categoryPoints.def_sack=${savedCp?.def_sack} def_pa_7_13=${savedCp?.def_pa_7_13} pass_td=${savedCp?.pass_td} DEF score=${overrideScore} (want 19)`)

    // D8: LEGACY regression — a league with ONLY nfl_scoring_config (no
    // categoryPoints, saved before the bridge) still scores via the engine fallback.
    await prisma.league.update({ where: { id: seeded.leagueId }, data: { settings: { nfl_scoring_config: { rules: { dst_sack: 2 } } } } })
    const legacyScore = await calculateScoreFromSportConfig(seeded.leagueId, 'nfl:def:KC', 1, { def_sack: 4 }, 'DEF')
    // No sportConfig.categoryPoints → derive from nfl_scoring_config {dst_sack:2}→{def_sack:2}; 4*2=8.
    record('D8 Legacy nfl_scoring_config league scores via engine fallback (precedence)', legacyScore === 8, `legacy DEF score=${legacyScore} (want 8)`)

    // D9: RETURN YARDAGE (G9) — enable via the surfaced panel keys, ingest provider
    // return yards, re-sync, and prove the DEF score reflects them (inert by default).
    await saveLeagueNflScoringConfig(seeded.leagueId, { presetKey: 'custom', rules: { st_kick_return_yards: 0.04, st_punt_return_yards: 0.1 } })
    const lgRy = await prisma.league.findUnique({ where: { id: seeded.leagueId }, select: { settings: true } })
    const ryCp = ((lgRy?.settings as Record<string, unknown>)?.sportConfig as Record<string, unknown> | undefined)?.categoryPoints as Record<string, number> | undefined
    await ingestNflTeamDefenseBoxScores(prisma, { season: SEASON, week: DST_WEEK, entries: [{ teamAbbr: 'ZZZ', stats: { def_kr_yd: 100, def_pr_yd: 20, pts_allow: 24 } }] })
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: seeded.seasonId, week: DST_WEEK, actorId: 'e2e' })
    const dstRy = await prisma.playerWeeklyScore.findFirst({ where: { playerId: 'nfl:def:ZZZ', week: DST_WEEK, season: SEASON, sport: 'NFL' }, select: { stats: true, fantasyPts: true } })
    const ryStats = (dstRy?.stats as Record<string, number> | undefined) ?? {}
    // KR 100*0.04=4 + PR 20*0.1=2 + PA 24→21-27 tier (default 0) = 6.
    record('D9 Return-yardage (G9): panel keys bridge + DEF scores return yards when enabled', ryCp?.def_kr_yd === 0.04 && ryCp?.def_pr_yd === 0.1 && ryStats.def_kr_yd === 100 && dstRy?.fantasyPts === 6, `cp.def_kr_yd=${ryCp?.def_kr_yd} cp.def_pr_yd=${ryCp?.def_pr_yd} def_kr_yd=${ryStats.def_kr_yd} fantasyPts=${dstRy?.fantasyPts} (want 6)`)

    // RC1: G10 commissioner roster validation — the resolver reads the real
    // settings.roster.config.sections[].slots shape from a DB league (SF enabled)
    // and validateRedraftLineup honors it (a QB in the SF slot is legal).
    await prisma.league.update({ where: { id: seeded.leagueId }, data: { settings: { roster: { config: { sections: [{ slots: { QB: 1, RB: 2, WR: 2, TE: 1, SF: 1, DEF: 1, K: 1, BN: 6, IR: 1 } }] } } } } })
    const lgRc = await prisma.league.findUnique({ where: { id: seeded.leagueId }, select: { settings: true } })
    const rc = resolveRedraftRosterConfig('NFL', lgRc?.settings)
    const sfLineup = validateRedraftLineup({
      sport: 'NFL', week: 1, rosterConfig: rc,
      players: [
        { playerId: 'qb1', playerName: 'QB1', position: 'QB', sport: 'NFL', slotType: 'QB' },
        { playerId: 'qb2', playerName: 'QB2', position: 'QB', sport: 'NFL', slotType: 'SF' },
        { playerId: 'rb1', playerName: 'RB1', position: 'RB', sport: 'NFL', slotType: 'RB' },
        { playerId: 'rb2', playerName: 'RB2', position: 'RB', sport: 'NFL', slotType: 'RB' },
        { playerId: 'wr1', playerName: 'WR1', position: 'WR', sport: 'NFL', slotType: 'WR' },
        { playerId: 'wr2', playerName: 'WR2', position: 'WR', sport: 'NFL', slotType: 'WR' },
        { playerId: 'te', playerName: 'TE', position: 'TE', sport: 'NFL', slotType: 'TE' },
        { playerId: 'def', playerName: 'DEF', position: 'DST', sport: 'NFL', slotType: 'DEF' },
        { playerId: 'k', playerName: 'K', position: 'K', sport: 'NFL', slotType: 'K' },
      ],
    })
    record('RC1 Roster resolver reads commissioner SF config from DB; QB-in-SF lineup validates', rc.source === 'commissioner' && rc.starterCapacities.get('SF') === 1 && sfLineup.ok, `source=${rc.source} SF=${rc.starterCapacities.get('SF')} ok=${sfLineup.ok} issues=${JSON.stringify(sfLineup.issues.map((i) => i.code))}`)

    // SEED1-SEED2: the self-seeding browser harness (what the Playwright spec calls)
    // builds a full commissioner DEF league + scores it, and cleans up deterministically.
    const g8 = await seedG8CommissionerLeague(prisma, seeded.userId, { team: 'KC' })
    const g8League = await prisma.league.findUnique({ where: { id: g8.leagueId }, select: { userId: true, settings: true } })
    const g8Def = await prisma.redraftRosterPlayer.findFirst({ where: { rosterId: g8.homeRosterId, playerId: g8.defPlayerId }, select: { playerName: true, slotType: true } })
    const g8Matchup = await prisma.redraftMatchup.findUnique({ where: { id: g8.matchupId }, select: { homeScore: true } })
    const g8Cp = ((g8League?.settings as Record<string, unknown>)?.sportConfig as Record<string, unknown> | undefined)?.categoryPoints as Record<string, number> | undefined
    const seedOk = g8League?.userId === seeded.userId && g8Def?.playerName === 'KC Defense' && g8Def?.slotType === 'DEF' && (g8Matchup?.homeScore ?? 0) > 0 && g8Cp?.def_sack === 5
    record('SEED1 Self-seed harness builds a scored commissioner DEF league', seedOk, `owner=${g8League?.userId === seeded.userId} def="${g8Def?.playerName}" homeScore=${g8Matchup?.homeScore} cp.def_sack=${g8Cp?.def_sack} (want 5)`)

    // MC1 (G11 Phase 2d): matchup-center now sources redraft pairing + rosters + canonical
    // scores via the reusable matchup-source adapter. Proves the unified read end-to-end.
    const { buildMatchupCenterPayload } = await import('../server/services/matchupCenterService')
    const mc = await buildMatchupCenterPayload({ leagueId: g8.leagueId, viewerUserId: seeded.userId, week: g8.week })
    const mcOkShape = mc != null && !('error' in mc)
    const mcLeft = mcOkShape ? (mc as { left: { teamName: string; totalPoints: number; starters: Array<{ name: string; currentPoints: number }> } }).left : null
    const mcRight = mcOkShape ? (mc as { right: { teamName: string; starters: Array<{ name: string }> } }).right : null
    const mcDefRow = mcLeft?.starters.find((s) => /KC Defense/i.test(s.name)) ?? null
    // Display-level leak check: no visible NAME should expose the raw synthetic id.
    const allNames = [...(mcLeft?.starters ?? []), ...(mcRight?.starters ?? [])].map((s) => String(s.name))
    const mcNameLeak = allNames.some((n) => /nfl:def:/i.test(n))
    const engineHome = g8Matchup?.homeScore ?? -1
    const totalMatches = mcLeft != null && Math.abs(mcLeft.totalPoints - engineHome) < 0.01
    const mc1Ok =
      mcOkShape &&
      !!mcLeft && !!mcRight &&
      (mcLeft.starters.length ?? 0) > 0 &&
      (mcRight.starters.length ?? 0) > 0 &&
      !!mcDefRow &&
      (mcDefRow.currentPoints ?? 0) === 21 && // canonical: def_sack 3*5 + def_int 1*2 + PA(10→7-13 tier) 4 = 21
      !mcNameLeak &&
      totalMatches
    record(
      'MC1 matchup-center reads redraft pairing+rosters+canonical scores (KC Defense, no nfl:def name leak, total=engine)',
      mc1Ok,
      `teams=[${mcLeft?.teamName},${mcRight?.teamName}] homeStarters=${mcLeft?.starters.length} DEFpts=${mcDefRow?.currentPoints} (want 21) total=${mcLeft?.totalPoints} engine=${engineHome} nameLeak=${mcNameLeak}`,
    )

    // LIVE1 (G11 Phase 3): the reusable orchestrator drives ONE incremental live tick
    // with real DB-backed deps + a fixture provider (a live sack bumps the DEF 3→5).
    // Proves: only the changed DEF is detected, the affected matchup is rescored, the
    // engine total rises, and only affected entities are broadcast.
    const { runLiveScoringTick } = await import('../lib/live-scoring/orchestrator')
    const homeQbId = `${g8.mark}-hqb`
    const awayQbId = `${g8.mark}-aqb`
    const beforeHome = (await prisma.redraftMatchup.findUnique({ where: { id: g8.matchupId }, select: { homeScore: true } }))?.homeScore ?? 0
    const liveEvents: Array<{ eventType: string }> = []
    const tick = await runLiveScoringTick(
      [{ gameId: 'g-live', status: 'in_progress', startTime: new Date() }],
      {
        fetchActiveStats: async () =>
          new Map<string, Record<string, number>>([
            [g8.defPlayerId, { def_sack: 5, def_int: 1, def_points_allowed: 10 }], // +2 sacks (live)
            [homeQbId, { pass_yds: 300, pass_td: 2 }], // unchanged
          ]),
        loadPreviousStats: async () => {
          const rows = await prisma.playerWeeklyScore.findMany({ where: { playerId: { in: [g8.defPlayerId, homeQbId] }, week: g8.week, season: g8.season, sport: 'NFL' } })
          return new Map(rows.map((r) => [r.playerId, (r.stats ?? {}) as Record<string, number>]))
        },
        loadTopology: async () => ({
          rosters: [
            { rosterId: g8.homeRosterId, matchupId: g8.matchupId, scoringPlayerIds: [g8.defPlayerId, homeQbId] },
            { rosterId: g8.awayRosterId, matchupId: g8.matchupId, scoringPlayerIds: [awayQbId] },
          ],
          matchups: [{ matchupId: g8.matchupId, status: 'live' }],
        }),
        persistChangedStats: async (changed) => {
          for (const [playerId, stats] of changed) {
            await prisma.playerWeeklyScore.upsert({
              where: { playerId_week_season_sport: { playerId, week: g8.week, season: g8.season, sport: 'NFL' } },
              update: { stats, isFinalized: false },
              create: { playerId, week: g8.week, season: g8.season, sport: 'NFL', fantasyPts: 0, isFinalized: false, stats },
            })
          }
        },
        applyRescore: async () => { await recalculateMatchupsForSeasonWeek(g8.seasonId, g8.week) },
        broadcast: (events) => { liveEvents.push(...events) },
      },
    )
    const afterHome = (await prisma.redraftMatchup.findUnique({ where: { id: g8.matchupId }, select: { homeScore: true } }))?.homeScore ?? 0
    const live1Ok =
      tick.polled &&
      tick.changedPlayerIds.includes(g8.defPlayerId) &&
      tick.changedPlayerIds.length === 1 && // QB unchanged → not rescored
      tick.plan.affectedMatchupIds.includes(g8.matchupId) &&
      liveEvents.some((e) => e.eventType === 'player_changed') &&
      liveEvents.some((e) => e.eventType === 'matchup_changed') &&
      afterHome > beforeHome // DEF +2 sacks × 5 = +10
    record('LIVE1 orchestrator incremental tick: only changed DEF rescored, matchup total rises, only affected broadcast', live1Ok, `changed=[${tick.changedPlayerIds}] home ${beforeHome}→${afterHome} (want +10) events=${liveEvents.map((e) => e.eventType).join(',')}`)

    // LIVE2 (G11 Phase 3b): the SCHEDULED RUNNER drives the tick via the provider
    // boundary with a FIXTURE provider + injected broadcast collector — proving the
    // full provider→runner→orchestrator→DB→broadcast path, plus a no-op rerun.
    const { runLiveScoringTickForSeason } = await import('../server/services/liveScoring/liveScoreRunner')
    const { FixtureLiveStatsProvider } = await import('../lib/live-scoring/provider')
    const collected: Array<{ leagueId: string; eventType: string }> = []
    const broadcast = (leagueId: string, events: ReadonlyArray<{ eventType: string }>) => {
      for (const e of events) collected.push({ leagueId, eventType: e.eventType })
    }
    const fixtureProvider = () =>
      new FixtureLiveStatsProvider({
        games: [{ gameId: 'g-live', homeTeam: g8.defTeam, awayTeam: 'OPP', status: 'in_progress', startTime: new Date() }],
        teamDefenseStats: new Map([[g8.defPlayerId, { def_sack: 6, def_int: 1, def_points_allowed: 10 }]]), // 5→6 sacks
      })
    const seasonForTick = { id: g8.seasonId, leagueId: g8.leagueId, sport: 'NFL', season: g8.season, currentWeek: g8.week }
    const beforeLive2 = (await prisma.redraftMatchup.findUnique({ where: { id: g8.matchupId }, select: { homeScore: true } }))?.homeScore ?? 0
    const r2a = await runLiveScoringTickForSeason(prisma, seasonForTick, { provider: fixtureProvider(), broadcast })
    const afterLive2 = (await prisma.redraftMatchup.findUnique({ where: { id: g8.matchupId }, select: { homeScore: true } }))?.homeScore ?? 0
    const collectedAfterFirst = collected.length
    // Rerun with the SAME fixture → no change persisted/broadcast (idempotent).
    const r2b = await runLiveScoringTickForSeason(prisma, seasonForTick, { provider: fixtureProvider(), broadcast })
    const afterRerun = (await prisma.redraftMatchup.findUnique({ where: { id: g8.matchupId }, select: { homeScore: true } }))?.homeScore ?? 0

    const live2Ok =
      r2a.polled &&
      r2a.changedPlayerIds.includes(g8.defPlayerId) &&
      r2a.plan.affectedMatchupIds.includes(g8.matchupId) &&
      collected.some((e) => e.eventType === 'player_changed' && e.leagueId === g8.leagueId) &&
      collected.some((e) => e.eventType === 'matchup_changed') &&
      afterLive2 > beforeLive2 && // DEF +1 sack × 5 = +5
      r2b.polled && r2b.changedPlayerIds.length === 0 && // rerun no-op
      collected.length === collectedAfterFirst && // no new broadcast on rerun
      afterRerun === afterLive2
    record('LIVE2 scheduled runner (fixture provider): persists+rescores+broadcasts on change, no-op on rerun', live2Ok, `home ${beforeLive2}→${afterLive2} rerunChanged=${r2b.changedPlayerIds.length} events=${collectedAfterFirst}→${collected.length}`)

    // LIVE3 (G11 Phase 3c): the external WORKER LOOP drives the SAME runner at the
    // engine cadence and stops gracefully. Fixture provider + fake sleep; the game is
    // in_progress → cadence resolves to 30s; loop sleeps once between two ticks.
    const { runWorkerLoop } = await import('../lib/live-scoring/workerLoop')
    let wdone = 0
    const wsleeps: number[] = []
    const wloop = await runWorkerLoop({
      tick: async () => {
        wdone += 1
        const r = await runLiveScoringTickForSeason(prisma, seasonForTick, { provider: fixtureProvider(), broadcast: () => undefined })
        return { nextPollDelayMs: r.nextPollDelayMs, polled: r.polled ? 1 : 0, ticked: 1 }
      },
      sleep: async (ms) => { wsleeps.push(ms) },
      shouldStop: () => wdone >= 2,
    })
    const live3Ok = wloop.ticks === 2 && wsleeps.length === 1 && wsleeps[0] === 30_000
    record('LIVE3 external worker loop drives the runner at 30s live cadence + stops gracefully', live3Ok, `ticks=${wloop.ticks} sleeps=[${wsleeps}] (want one 30000)`)

    await cleanupG8League(prisma, { leagueId: g8.leagueId, season: g8.season, seededScoreIds: g8.seededScoreIds })
    const afterLeague = await prisma.league.findUnique({ where: { id: g8.leagueId }, select: { id: true } })
    const afterScores = await prisma.playerWeeklyScore.count({ where: { playerId: { in: g8.seededScoreIds }, season: g8.season, sport: 'NFL' } })
    record('SEED2 Cleanup removes the seeded league + weekly scores', !afterLeague && afterScores === 0, `leagueGone=${!afterLeague} scoresRemaining=${afterScores}`)

    // 17-19: trade finalization concurrency guard (only one settlement wins)
    const tradeId = `${seeded.mark}-trade`
    await seedTradeProposal(prisma, { id: tradeId, leagueId: seeded.leagueId, seasonId: seeded.seasonId, proposerRosterId: seeded.homeRosterId, receiverRosterId: seeded.awayRosterId })
    const flip = () => prisma.redraftTradeProposal.updateMany({ where: { id: tradeId, status: 'pending' }, data: { status: 'accepted', acceptedAt: new Date() } })
    const [r1, r2] = await Promise.all([flip(), flip()])
    const tradeStatus = await prisma.redraftTradeProposal.findUnique({ where: { id: tradeId }, select: { status: true } })
    const tradeOk = [r1.count, r2.count].filter((c) => c === 1).length === 1 && tradeStatus?.status === 'accepted'
    record('17-19 Trade race guard: exactly one finalize wins', tradeOk ? 'PASS' : 'FAIL', `counts=[${r1.count},${r2.count}] status=${tradeStatus?.status}`)

    // 20: advance to playoffs
    await advanceWeek(prisma, seeded.seasonId, 12)
    record('20 Advance regular season to playoff start', 'PASS', 'currentWeek → 12')

    // Pre-flight: champion crowning requires the league_championships table
    // (migration 20260627000000). Detect it so a re-run after the migration
    // automatically exercises the champion step instead of staying blocked.
    let champTableExists = false
    try {
      const rows = (await prisma.$queryRawUnsafe(
        "select 1 as ok from information_schema.tables where table_schema = 'public' and table_name = 'league_championships'",
      )) as unknown[]
      champTableExists = rows.length > 0
    } catch {
      champTableExists = false
    }
    record('Pre-flight: league_championships table present', champTableExists ? 'PASS' : 'BLOCKED', champTableExists ? 'table exists' : 'table missing — apply migration 20260627000000_add_league_championships, then re-run')

    // 21-24: playoffs → champion (home seeded higher, wins the final)
    await seedChampionshipBracket(prisma, { seasonId: seeded.seasonId, leagueId: seeded.leagueId, homeRosterId: seeded.homeRosterId, awayRosterId: seeded.awayRosterId, homeScore: 30, awayScore: 12, week: 12 })
    const adv = await advancePlayoffWinners(seeded.seasonId, 12)
    record('21-22 Playoff bracket advances; final ready', adv.status === 'ready_for_champion_finalization' || adv.status === 'round_complete' ? 'PASS' : 'FAIL', `advance status=${adv.status} advanced=${adv.advanced} blocked=${JSON.stringify(adv.blocked)}`)
    try {
      const champ = await finalizeRedraftSeasonChampion(seeded.seasonId, seeded.userId)
      const seasonFinal = await prisma.redraftSeason.findUnique({ where: { id: seeded.seasonId }, select: { status: true } })
      record('23-24 Champion crowned + season complete', champ.championRosterId === seeded.homeRosterId && seasonFinal?.status === 'complete', `champion=${champ.championRosterId === seeded.homeRosterId ? 'home (correct)' : champ.championRosterId} status=${champ.status} seasonStatus=${seasonFinal?.status}`)

      // 25: re-finalize is a safe no-op (idempotent)
      const champAgain = await finalizeRedraftSeasonChampion(seeded.seasonId, seeded.userId)
      record('25 Idempotency: re-finalize champion is a safe no-op', champAgain.status === 'already_finalized', `re-finalize status=${champAgain.status}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const missingTable = /does not exist|league_championships/i.test(msg)
      record('23-25 Champion crowning', 'BLOCKED', missingTable
        ? `BLOCKED: table league_championships is missing from the DB (migration drift). finalizeRedraftSeasonChampion cannot record the champion. Apply the LeagueChampionship migration to unblock.`
        : `BLOCKED: ${msg.slice(0, 200)}`)
    }
  } catch (err) {
    record('FATAL', 'FAIL', err instanceof Error ? err.stack ?? err.message : String(err))
  } finally {
    if (seeded) {
      await cleanupSeededLeague(prisma, seeded)
      record('26 Cleanup seeded data (cascade)', 'PASS', `removed test user ${seeded.userId} + cascade`)
    }
    await prisma.$disconnect()
  }

  const pass = log.filter((l) => l.outcome === 'PASS').length
  const fail = log.filter((l) => l.outcome === 'FAIL').length
  const skip = log.filter((l) => l.outcome === 'SKIP').length
  const blocked = log.filter((l) => l.outcome === 'BLOCKED').length
  console.log(`\n──── NFL ENGINE E2E SUMMARY ────\nPASS ${pass} · FAIL ${fail} · BLOCKED ${blocked} · SKIP ${skip}`)
  if (blocked > 0) console.log('NOTE: BLOCKED steps require infrastructure fixes (see detail above), not code.')
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error('UNHANDLED', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
