/**
 * Draft backtest (2026-11-14): replay real completed NFL redraft drafts pick by pick and ask whether
 * replacement value (DRAFT_VORP_MODE=active, the default since af77405d) recommends players who went
 * on to score MORE than the engine without it (observe). READ-ONLY.
 *
 *   railway run npm run backtest:draft -- --confirm-host=<the database host you mean>
 *   options: --season=2026 --max-drafts=200 --through-week=<n> --season-opener=2026-09-10
 *            --projection-source=<name> --outcomes=weekly|game --json
 *
 * 🛑 IT REFUSES TO START UNLESS --confirm-host EQUALS THE HOST PRISMA WILL CONNECT TO. In this repo an
 * unset DATABASE_URL is not "no database" — @prisma/client fills it from .env on import (CLAUDE.md).
 * So the target is named by the person running it, every time, and only its host is ever printed.
 *
 * Every query is a findMany/findUnique. The one shared helper it calls, `resolveDraftRosterShape`,
 * reads League, IdpLeagueConfig and roster templates and writes nothing.
 *
 * NO LOOK-AHEAD (the rules live in lib/shared-services/draft/backtest/):
 *   - market   = the 2026-03-08 preseason ADP in data/nfl-adp-multiplatform.csv, for every draft;
 *   - projections only if the line was written before a cutoff — `strict` (before the draft started)
 *     and `window` (before the judged window's first kickoff) are both run and reported, because
 *     FantasyProjection rows are upserted in place and strict may leave too few to judge;
 *   - outcomes = points from the first week that had not kicked off when the draft began (or the
 *     league's start_week / tournament round, if later) through the last fully played week (or
 *     --through-week). Two tables are measured and the better-covering one used, or --outcomes=:
 *     `weekly` (PlayerWeeklyScore — only players STARTED in AllFantasy-run leagues) and `game`
 *     (PlayerGameStat box scores, minus rows never scored).
 *
 * It also scores the FORWARD test — `draft_recommendation_records`, written when advice is served
 * (lib/shared-services/draft/recommendationRecorder.ts) — which is the only honest test of
 * replacement value: the 2026-11-14 run found every stored projection rewritten after its draft.
 *
 * What it prints, and pastes back safely: counts, rates and point differences. No user ids, league
 * names or draft ids.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VorpMode } from '@/lib/draft-helper/RecommendationEngine'
import { compareModes, replayDraft, signTestP, type ReplayDraft, type ReplayRow } from '@/lib/shared-services/draft/backtest/draftReplay'
import {
  backtestKey,
  backtestName,
  buildIdSpaces,
  chooseIdSpace,
  completedThroughWeek,
  firstUnplayedWeek,
  gameRowsToWeekly,
  isManagerPick,
  isReplayablePick,
  recordedToReplayRows,
  marketWithProjections,
  parseAdpCsv,
  preDraftProjections,
  weekKickoff,
  weeklyByKey,
  windowPoints,
  type ProjectionPolicy,
  type ProjectionRow,
} from '@/lib/shared-services/draft/backtest/backtestInputs'

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
function numArg(name: string, d: number): number {
  const n = Number(arg(name))
  return Number.isFinite(n) && n > 0 ? n : d
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

const NFL = ['NFL', 'nfl']
const MIN_MARKET_MATCH = 0.6
const MODES: VorpMode[] = ['observe', 'active']

async function main() {
  const confirmHost = arg('confirm-host')
  const season = numArg('season', 2026)
  const maxDrafts = numArg('max-drafts', 200)
  const opener = new Date(`${arg('season-opener') ?? '2026-09-10'}T00:00:00Z`)
  const asJson = process.argv.includes('--json')
  if (Number.isNaN(opener.getTime())) throw new Error('--season-opener must be YYYY-MM-DD')

  const { prisma } = await import('@/lib/prisma')
  const { resolveDatabaseUrl } = await import('@/lib/env/database-url')
  const host = hostOf(resolveDatabaseUrl()) ?? hostOf(process.env.DATABASE_URL)
  if (!host) throw new Error('No database URL is set. Run under the environment that holds it (e.g. `railway run`).')
  if (!confirmHost || confirmHost !== host) {
    console.error(`Refusing to start: this would read the database at "${host}".`)
    console.error(`If that is the one you mean, re-run with --confirm-host=${host}`)
    process.exit(2)
  }
  const { resolveDraftRosterShape, resolveDraftScoringWindow } = await import('@/lib/shared-services/draft/DraftContextAssembler')
  const log = (s: string) => (asJson ? console.error(s) : console.log(s))
  log(`draft-backtest: reading ${host} (read-only), season ${season}`)

  // ── Drafts ────────────────────────────────────────────────────────────────────────────────────
  const sessions = await prisma.draftSession.findMany({
    where: {
      status: 'completed',
      sessionKind: 'live',
      draftType: { in: ['snake', 'linear'] },
      league: { sport: 'NFL', isDynasty: false, season },
    },
    orderBy: { completedAt: 'desc' },
    take: maxDrafts,
    select: {
      id: true,
      leagueId: true,
      teamCount: true,
      startedAt: true,
      createdAt: true,
      league: { select: { sport: true, settings: true, starters: true } },
    },
  })
  const picks = sessions.length
    ? await prisma.draftPick.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        select: { sessionId: true, overall: true, round: true, rosterId: true, playerName: true, position: true, source: true, assetType: true },
        orderBy: { overall: 'asc' },
      })
    : []
  const picksBySession = new Map<string, typeof picks>()
  for (const p of picks) {
    if (p.assetType && p.assetType !== 'player') continue
    const list = picksBySession.get(p.sessionId) ?? []
    list.push(p)
    picksBySession.set(p.sessionId, list)
  }

  // ── Identity, outcomes, projections ───────────────────────────────────────────────────────────
  const players = await prisma.sportsPlayer.findMany({
    where: { sport: { in: NFL } },
    select: { id: true, externalId: true, sleeperId: true, source: true, name: true, position: true },
  })
  const spaces = buildIdSpaces(players)

  // Two outcome tables, both measured, the better-covering one used (or --outcomes=weekly|game).
  //   weekly = PlayerWeeklyScore — written for players STARTED in AllFantasy-run leagues only;
  //   game   = PlayerGameStat    — box scores, minus rows never scored (normalizedStatMap.scored=false).
  const completed = completedThroughWeek(opener, new Date())
  const weeklyRows = (
    await prisma.playerWeeklyScore.findMany({
      where: { sport: { in: NFL }, season },
      select: { playerId: true, week: true, fantasyPts: true, isFinalized: true },
    })
  ).map((r) => ({ playerId: r.playerId, week: r.week, fantasyPts: r.fantasyPts, isFinalized: r.isFinalized }))
  const gameRaw = await prisma.playerGameStat.findMany({
    where: { sportType: { in: NFL }, season },
    select: { playerId: true, weekOrRound: true, fantasyPoints: true, normalizedStatMap: true },
  })
  const game = gameRowsToWeekly(gameRaw)
  const finalizedMax = weeklyRows.filter((r) => r.isFinalized).reduce((m, r) => Math.max(m, r.week), 0)
  const outcomeSources = {
    weekly: { rows: weeklyRows, cap: finalizedMax, unscored: 0 },
    game: { rows: game.rows, cap: game.rows.reduce((m, r) => Math.max(m, r.week), 0), unscored: game.unscored },
  }
  const pickKeys = picks.map((p) => backtestKey(p.playerName, p.position))
  const measured = Object.fromEntries(
    (Object.keys(outcomeSources) as Array<keyof typeof outcomeSources>).map((name) => {
      const src = outcomeSources[name]
      const choice = chooseIdSpace(spaces, src.rows.map((r) => r.playerId))
      const through = Math.min(numArg('through-week', completed), src.cap)
      const w = weeklyByKey(src.rows.filter((r) => r.week <= through), choice.space)
      const pickCoveragePct = pickKeys.length ? Math.round((pickKeys.filter((k) => w.byKey.has(k)).length / pickKeys.length) * 1000) / 10 : 0
      return [name, { choice, through, weekly: w, pickCoveragePct, rows: src.rows.length, unscoredDropped: src.unscored }]
    }),
  ) as Record<keyof typeof outcomeSources, { choice: ReturnType<typeof chooseIdSpace>; through: number; weekly: ReturnType<typeof weeklyByKey>; pickCoveragePct: number; rows: number; unscoredDropped: number }>
  const forced = arg('outcomes')
  const outcomeName: keyof typeof outcomeSources =
    forced === 'weekly' || forced === 'game' ? forced : measured.game.pickCoveragePct > measured.weekly.pickCoveragePct ? 'game' : 'weekly'
  const scoreSpace = measured[outcomeName].choice
  const weekly = measured[outcomeName].weekly
  const throughWeek = measured[outcomeName].through

  const market = parseAdpCsv(readFileSync(join(process.cwd(), 'data/nfl-adp-multiplatform.csv'), 'utf8'))
  const marketKeys = new Set(market.map((p) => `${p.name}|${p.position}`))

  // ── Per-draft setup ───────────────────────────────────────────────────────────────────────────
  type Prepared = { draft: ReplayDraft; fromWeek: number; draftStart: Date; userPicks: Set<number>; keeperPicks: Set<number> }
  const skipped: Record<string, number> = {}
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1)
  const prepared: Prepared[] = []
  for (const s of sessions) {
    const raw = picksBySession.get(s.id) ?? []
    if (raw.length < s.teamCount * 2) {
      skip('fewer than two rounds of picks')
      continue
    }
    const draftPicks = raw.map((p) => ({
      overall: p.overall,
      round: p.round,
      teamKey: p.rosterId,
      playerName: backtestName(p.playerName),
      position: String(p.position ?? '').toUpperCase(),
    }))
    const inMarket = draftPicks.filter((p) => marketKeys.has(`${p.playerName}|${p.position}`)).length / draftPicks.length
    if (inMarket < MIN_MARKET_MATCH) {
      skip(`under ${MIN_MARKET_MATCH * 100}% of picks found in the ADP market (devy, IDP or name drift)`)
      continue
    }
    const draftStart = s.startedAt ?? s.createdAt
    const unplayed = firstUnplayedWeek(opener, draftStart)
    const window = await resolveDraftScoringWindow(s.leagueId)
    const fromWeek = Math.max(unplayed ?? 99, window?.startWeek ?? 1)
    if (fromWeek > throughWeek) {
      skip('its scoring window has no finished weeks yet')
      continue
    }
    const shape = await resolveDraftRosterShape(s.leagueId, { sport: String(s.league.sport), settings: s.league.settings, starters: s.league.starters })
    if (!shape.rosterSlots.length) {
      skip('roster shape could not be resolved')
      continue
    }
    prepared.push({
      draft: { id: s.id, totalTeams: Math.max(2, s.teamCount), rosterSlots: shape.rosterSlots, picks: draftPicks },
      fromWeek,
      draftStart,
      userPicks: new Set(raw.filter((p) => isManagerPick(p.source)).map((p) => p.overall)),
      keeperPicks: new Set(raw.filter((p) => !isReplayablePick(p.source)).map((p) => p.overall)),
    })
  }

  const projWeeks = [...new Set(prepared.map((p) => p.fromWeek))]
  const projAll: ProjectionRow[] = projWeeks.length
    ? (
        await prisma.fantasyProjection.findMany({
          where: { sport: { in: NFL }, season: String(season), scoringPresetId: 'ppr', week: { in: projWeeks } },
          select: { playerId: true, week: true, projectedPoints: true, fetchedAt: true, source: true, stats: true },
        })
      ).map((r) => ({ ...r, projectedPoints: Number(r.projectedPoints) }))
    : []
  const bySource = new Map<string, number>()
  for (const r of projAll) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
  const projectionSource = arg('projection-source') ?? [...bySource].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const projRows = projAll.filter((r) => r.source === projectionSource)
  const projSpace = chooseIdSpace(spaces, projRows.map((r) => r.playerId))

  // ── Replay ────────────────────────────────────────────────────────────────────────────────────
  const policies: ProjectionPolicy[] = ['strict', 'window']
  const rowsBy: Record<ProjectionPolicy, ReplayRow[]> = { strict: [], window: [] }
  const projStats: Record<ProjectionPolicy, { draftsWithAny: number; usable: number; leaked: number; unmatched: number; marketCoverage: number[] }> = {
    strict: { draftsWithAny: 0, usable: 0, leaked: 0, unmatched: 0, marketCoverage: [] },
    window: { draftsWithAny: 0, usable: 0, leaked: 0, unmatched: 0, marketCoverage: [] },
  }
  const actualRows: Array<{ round: number; engine: number | null; actual: number | null; same: boolean }> = []
  for (const p of prepared) {
    const outcome = windowPoints(weekly.byKey, p.fromWeek, throughWeek)
    for (const policy of policies) {
      const cutoff = policy === 'strict' ? p.draftStart : weekKickoff(opener, p.fromWeek)
      const proj = preDraftProjections({ rows: projRows, week: p.fromWeek, cutoff, space: projSpace.space })
      const st = projStats[policy]
      st.usable += proj.usable
      st.leaked += proj.leaked
      st.unmatched += proj.unmatched
      if (proj.byKey.size > 0) st.draftsWithAny++
      const m = marketWithProjections(market, proj.byKey)
      st.marketCoverage.push(m.filter((x) => x.projectedPoints != null).length / m.length)
      const rows = replayDraft({ draft: p.draft, market: m, outcomePoints: outcome, modes: MODES })
      rowsBy[policy].push(...rows.filter((r) => !p.keeperPicks.has(r.overall)))
      if (policy !== 'strict') continue
      for (const r of rows) {
        if (!p.userPicks.has(r.overall) || p.keeperPicks.has(r.overall)) continue
        const rec = r.byMode.observe
        actualRows.push({ round: r.round, engine: rec?.points ?? null, actual: r.actual.points, same: rec?.name === r.actual.name })
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────────────────────────
  const bands: Array<[string, (r: number) => boolean]> = [
    ['rounds 2-4', (r) => r >= 2 && r <= 4],
    ['rounds 5-8', (r) => r >= 5 && r <= 8],
    ['rounds 9+', (r) => r >= 9],
  ]
  const comparisons = Object.fromEntries(
    policies.map((policy) => [
      policy,
      {
        all: compareModes(rowsBy[policy], 'active', 'observe'),
        byRound: Object.fromEntries(bands.map(([label, f]) => [label, compareModes(rowsBy[policy].filter((r) => f(r.round)), 'active', 'observe')])),
      },
    ]),
  )
  const known = actualRows.filter((r) => r.engine != null && r.actual != null && !r.same)
  const engineWins = known.filter((r) => r.engine! > r.actual!).length
  const engineLosses = known.filter((r) => r.engine! < r.actual!).length
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 10 : null)
  const allRows = rowsBy.strict
  // ── Recorded forward test (draft_recommendation_records) ─────────────────────────────────────
  // The point-in-time record a replay cannot rebuild. Absent until its migration is applied.
  let recorded:
    | { status: 'table_missing' | 'error'; message?: string }
    | {
        status: 'ok'
        total: number
        disagreed: number
        pending: number
        byServedMode: Record<string, number>
        bySurface: Record<string, number>
        all: ReturnType<typeof compareModes>
        byRound: Record<string, ReturnType<typeof compareModes>>
      }
  try {
    const records = await prisma.draftRecommendationRecord.findMany({
      where: { sport: { in: NFL }, createdAt: { gte: new Date(Date.UTC(season, 0, 1)) } },
      select: { createdAt: true, round: true, overallPick: true, observeName: true, observePosition: true, activeName: true, activePosition: true, agree: true, servedMode: true, surface: true },
    })
    const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})
    const scored = recordedToReplayRows({ records, byKey: weekly.byKey, seasonOpener: opener, throughWeek })
    recorded = {
      status: 'ok',
      total: records.length,
      disagreed: records.filter((r) => !r.agree).length,
      pending: scored.pending,
      byServedMode: tally(records.map((r) => r.servedMode)),
      bySurface: tally(records.map((r) => r.surface)),
      all: compareModes(scored.rows, 'active', 'observe'),
      byRound: Object.fromEntries(bands.map(([label, f]) => [label, compareModes(scored.rows.filter((r) => f(r.round)), 'active', 'observe')])),
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    recorded = code === 'P2021' ? { status: 'table_missing' } : { status: 'error', message: error instanceof Error ? error.message.split('\n').slice(-1)[0] : String(error) }
  }
  const pickSources = picks.reduce<Record<string, number>>((m, p) => ((m[p.source ?? 'null'] = (m[p.source ?? 'null'] ?? 0) + 1), m), {})

  const summary = {
    host,
    season,
    throughWeek,
    seasonOpener: opener.toISOString().slice(0, 10),
    drafts: { found: sessions.length, replayed: prepared.length, skipped },
    picksReplayed: allRows.length,
    pickSources,
    outcomeSources: Object.fromEntries(
      Object.entries(measured).map(([name, m]) => [
        name,
        { rows: m.rows, unscoredDropped: m.unscoredDropped, throughWeek: m.through, idSpace: m.choice.space?.name ?? null, idsMatched: `${m.choice.matched}/${m.choice.total}`, pickCoveragePct: m.pickCoveragePct },
      ]),
    ),
    outcomeCoverage: {
      used: outcomeName,
      idSpace: scoreSpace.space?.name ?? null,
      idsMatched: `${scoreSpace.matched}/${scoreSpace.total}`,
      topSpaces: scoreSpace.rates.slice(0, 4),
      unmatchedScoreRows: weekly.unmatchedRows,
      actualPickKnownPct: avg(allRows.map((r) => (r.actual.points != null ? 1 : 0))),
    },
    projections: {
      source: projectionSource,
      sources: Object.fromEntries(bySource),
      idSpace: projSpace.space?.name ?? null,
      idsMatched: `${projSpace.matched}/${projSpace.total}`,
      byPolicy: Object.fromEntries(
        policies.map((p) => [
          p,
          { draftsWithAny: projStats[p].draftsWithAny, usable: projStats[p].usable, leaked: projStats[p].leaked, unmatched: projStats[p].unmatched, avgMarketCoveragePct: avg(projStats[p].marketCoverage) },
        ]),
      ),
    },
    activeVsObserve: comparisons,
    recordedForwardTest: recorded,
    engineVsActualUserPicks: {
      userPicks: actualRows.length,
      samePlayerPct: avg(actualRows.map((r) => (r.same ? 1 : 0))),
      comparedWhereDifferent: known.length,
      engineWins,
      engineLosses,
      meanDiff: known.length ? Math.round((known.reduce((a, r) => a + (r.engine! - r.actual!), 0) / known.length) * 10) / 10 : null,
      signTestP: signTestP(engineWins, engineLosses),
    },
  }

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    const c = (x: ReturnType<typeof compareModes>) =>
      `compared ${x.compared}, disagreed ${x.disagreed}: active better ${x.aWins} / worse ${x.bWins} / tie ${x.ties}, mean ${x.meanDiff ?? '-'} pts, p=${x.signTestP == null ? '-' : x.signTestP.toFixed(4)}`
    log(`\nDrafts: ${summary.drafts.found} found, ${summary.drafts.replayed} replayed; skipped ${JSON.stringify(skipped)}`)
    log(`Judged through week ${throughWeek}; ${summary.picksReplayed} picks replayed (rounds 2+)`)
    for (const [name, m] of Object.entries(summary.outcomeSources)) {
      log(`Outcome source ${name}: ${m.rows} rows${m.unscoredDropped ? ` (+${m.unscoredDropped} never scored, dropped)` : ''}, through week ${m.throughWeek}, id space ${m.idSpace} (${m.idsMatched}), covers ${m.pickCoveragePct}% of drafted players`)
    }
    log(`Outcomes used: ${outcomeName}; actual pick known ${summary.outcomeCoverage.actualPickKnownPct}%`)
    log(`Pick sources: ${JSON.stringify(pickSources)}`)
    log(`Projections: source ${projectionSource ?? '-'} ${JSON.stringify(summary.projections.sources)}, id space ${summary.projections.idSpace} (${summary.projections.idsMatched})`)
    for (const p of policies) {
      const st = summary.projections.byPolicy[p]!
      log(`\n[${p}] projections: ${st.draftsWithAny} drafts had any; usable ${st.usable}, leaked ${st.leaked}, unmatched ${st.unmatched}; market covered ${st.avgMarketCoveragePct}%`)
      log(`  active vs observe, all: ${c(comparisons[p]!.all)}`)
      for (const [label] of bands) log(`  ${label}: ${c(comparisons[p]!.byRound[label]!)}`)
    }
    const e = summary.engineVsActualUserPicks
    log(`\nEngine (observe) vs the manager's own pick (user/sleeper/import, no keepers): ${e.userPicks} picks, same player ${e.samePlayerPct}%`)
    log(`  where different: engine better ${e.engineWins} / worse ${e.engineLosses}, mean ${e.meanDiff ?? '-'} pts, p=${e.signTestP == null ? '-' : e.signTestP.toFixed(4)}`)
    if (recorded.status === 'ok') {
      log(`\nRecorded forward test: ${recorded.total} records (${recorded.disagreed} where the modes disagreed), ${recorded.pending} not yet scorable`)
      log(`  served mode ${JSON.stringify(recorded.byServedMode)}, surfaces ${JSON.stringify(recorded.bySurface)}`)
      log(`  active vs observe, all: ${c(recorded.all)}`)
      for (const [label] of bands) log(`  ${label}: ${c(recorded.byRound[label]!)}`)
    } else if (recorded.status === 'table_missing') {
      log('\nRecorded forward test: the draft_recommendation_records table does not exist yet (migration not applied).')
    } else {
      log(`\nRecorded forward test: could not be read (${recorded.message ?? 'unknown error'}).`)
    }
    log('\nPaste everything above back. It contains no user ids, league names or draft ids.')
  }
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('draft-backtest failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
