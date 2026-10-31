/**
 * Full-season Survivor rehearsal on an isolated Neon branch: create → autopick draft → every week's
 * scores, councils and votes → merge → jury → finale, on a moved clock.
 *
 *   SURVIVOR_REHEARSAL_ENDPOINT=ep-xxxx DATABASE_URL=... \
 *     npx tsx --conditions=react-server scripts/survivor-season-rehearsal/run.ts --sport=NFL --cast=16
 *
 * 🛑 Refuses unless DATABASE_URL's endpoint equals SURVIVOR_REHEARSAL_ENDPOINT and is not production,
 * and unless no delivery credential (email, push, SMS, realtime, shared Redis) is in the environment:
 * the engine notifies managers, and on a branch copied from production nothing may reach a person.
 */
import { setRehearsalNow, advanceRehearsalClock, rehearsalNow } from './fakeClock'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'

const PRODUCTION_ENDPOINT = 'ep-curly-block-ad0dlt9o'
const DELIVERY_ENV = [
  'RESEND_API_KEY', 'VAPID_PRIVATE_KEY', 'APNS_PRIVATE_KEY', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_SECRET',
  'PUSHER_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'DISCORD_BOT_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'DEEPSEEK_API_KEY',
]

const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const SPORT = arg('sport', 'NFL').toUpperCase()
const CAST = Number(arg('cast', '16'))
const START = new Date(arg('start', '2026-09-08T16:00:00Z'))
const VOTE_RATE = Number(arg('vote-rate', '0.85'))
const LOG = arg('log', 'survivor-rehearsal.log')
const MAX_STEPS = Number(arg('max-steps', '4000'))
// Teams handed to Chimmy before the draft ("Chimmy as a manager"): it drafts them, then plays them
// all season, votes and idols included. 0 runs the all-human season the rehearsal always ran.
const CHIMMY = Number(arg('chimmy', '0'))
// Hand each Chimmy castaway a protective idol at setup, so a season exercises "play it when at risk"
// (the seeded draw rarely lands on two particular teams). 0 leaves the draw alone.
const CHIMMY_IDOLS = Number(arg('chimmy-idols', '1'))
// Judge Chimmy against real stats: a PlayerWeeklyScore row that already holds a real stat line for a
// week is kept, and only the gaps are seeded (so every council still has scores). Off: every rostered
// player's week is seeded over, as the rehearsal always did. `--real-scores` or `--real-scores=true`.
const REAL_SCORES = process.argv.includes('--real-scores') || arg('real-scores', 'false').toLowerCase() === 'true'

function log(line: string) {
  const out = `[${rehearsalNow().toISOString()}] ${line}`
  console.log(out)
  appendFileSync(LOG, out + '\n')
}

function guard() {
  const url = process.env.DATABASE_URL ?? ''
  const host = url.match(/@([^/:?]+)/)?.[1] ?? ''
  const endpoint = host.split('.')[0].replace(/-pooler$/, '')
  assert.ok(endpoint, 'DATABASE_URL must be set explicitly')
  assert.notEqual(endpoint, PRODUCTION_ENDPOINT, 'Refusing the production endpoint')
  assert.equal(endpoint, process.env.SURVIVOR_REHEARSAL_ENDPOINT, 'DATABASE_URL must point at SURVIVOR_REHEARSAL_ENDPOINT')
  const present = DELIVERY_ENV.filter(k => process.env[k])
  assert.deepEqual(present, [], `Unset delivery credentials first: ${present.join(', ')}`)
}

type ExileTeamForm = { team: string; expected: number; filled: number; readings: number; real: number }
type ExileField = { week: number; ranking: ExileTeamForm[] }

/**
 * A real stat line: a non-empty stat map carrying the points the score sync computed. The rehearsal's
 * own seeds — this run's and every earlier run's on the shared branch — write fantasyPts 0, and a
 * sealed no-show row is `{}`. A real line that genuinely scored exactly 0 is counted as a gap.
 */
function isRealScoreRow(row: { stats: unknown; fantasyPts: number }): boolean {
  const s = row.stats
  return Boolean(s) && typeof s === 'object' && !Array.isArray(s) && Object.keys(s as object).length > 0 && row.fantasyPts !== 0
}

let seed = 0x5eed
let planGateLogged = false
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]

async function main() {
  guard()
  writeFileSync(LOG, '')
  setRehearsalNow(START)

  const { prisma } = await import('../../lib/prisma')
  const { validateCreatePayload } = await import('../../lib/league-creation/canonical/validateCreateLeague')
  const { executeCanonicalLeagueCreation } = await import('../../lib/league-creation/canonical/executeCanonicalLeagueCreation')
  const { startDraftSession } = await import('../../lib/live-draft-engine/DraftSessionService')
  const { processExpiredDraftPickForLeague } = await import('../../lib/live-draft-engine/expired-picks/processExpiredDraftPicks')
  const { configureEventInfrastructure, InMemoryOutboxStore } = await import('../../lib/events')
  const { runPlannedSurvivorLeague } = await import('../../lib/survivor/survivorPlannedSeasonRunner')
  const { readSurvivorFullSeasonPlan } = await import('../../lib/survivor/survivorFullSeasonPlan')
  const { loadCouncilContext } = await import('../../lib/survivor/survivorCouncilService')
  const { submitPrivateVoteCommand } = await import('../../lib/survivor/survivorPrivateVoteCommand')
  const { getFinaleState, submitJuryVote } = await import('../../lib/survivor/SurvivorFinaleEngine')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = `rehearsal-${SPORT.toLowerCase()}${CAST}-${randomUUID().slice(0, 6)}`
  const userIds = Array.from({ length: CAST }, (_, i) => `${marker}-u${String(i + 1).padStart(2, '0')}`)
  await prisma.appUser.createMany({ data: userIds.map((id, i) => ({
    id, username: id, email: `${id}@example.invalid`, displayName: `Castaway ${i + 1}`,
  })) })
  log(`marker ${marker}: ${CAST} test managers (example.invalid)`)

  // ── Create ──
  const body = {
    concept: 'survivor', sport: SPORT, teamCount: CAST, draftType: 'snake',
    scoringPreset: SPORT === 'NFL' ? 'fb_half_ppr' : SPORT.toLowerCase() + '_points',
    leagueName: `${marker} Survivor`, timezone: 'America/New_York',
    conceptSetup: { commissionerParticipationMode: 'participating_player', survivorTribeCount: CAST % 4 === 0 ? 4 : CAST % 3 === 0 ? 3 : 2 },
  }
  const validated = validateCreatePayload(body)
  assert.ok(validated.ok, `create payload: ${JSON.stringify(validated)}`)
  // The same entry point the create screen's API uses: the transaction AND the post-create
  // initialization after it (the NFL roster schema is written there, not in the transaction).
  const created = await executeCanonicalLeagueCreation({ appUserId: userIds[0], body: validated.data })
  assert.ok(created.ok, `league create: ${JSON.stringify(created)}`)
  const leagueId = created.response.league.id
  log(`league ${leagueId} created`)
  writeFileSync(`${LOG}.league`, JSON.stringify({ marker, leagueId, userIds }))

  const rosters = await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })
  assert.equal(rosters.length, CAST)
  rosters.sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
  for (let i = 0; i < CAST; i++) {
    await prisma.roster.update({ where: { id: rosters[i].id }, data: { platformUserId: userIds[i] } })
    await prisma.leagueTeam.updateMany({ where: { leagueId, externalId: rosters[i].id }, data: {
      platformUserId: userIds[i], claimedByUserId: userIds[i], isOrphan: false,
      ownerName: `Castaway ${i + 1}`, teamName: `Team ${i + 1}`,
    } })
  }

  // ── Chimmy seats: emptied through the app's own release, then handed to Chimmy by its own switch ──
  const chimmyRosterIds = await handChimmySeats()

  // ── Draft: every pick by the app's own autopick ──
  const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
  await prisma.draftSession.update({ where: { id: draft.id }, data: {
    slotOrder: rosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: `Team ${i + 1}` })), timerSeconds: 60,
  } })
  await prisma.leagueSettings.update({ where: { leagueId }, data: { draftOrderLocked: true } })
  const started = await startDraftSession(leagueId)
  assert.ok(started.ok, `startDraftSession: ${JSON.stringify(started)}`)
  const totalPicks = draft.rounds * CAST
  for (let n = 0; n < totalPicks + 5; n++) {
    const s = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
    if (s.status === 'completed') break
    await prisma.draftSession.update({ where: { id: draft.id }, data: { timerEndAt: new Date(Date.now() - 2_000) } })
    const r = await processExpiredDraftPickForLeague(leagueId)
    if (!String(r.outcome).startsWith('processed')) log(`autopick ${n + 1}: ${JSON.stringify(r)}`)
    advanceRehearsalClock(30_000)
  }
  const done = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
  log(`draft ${done.status}: ${await prisma.draftPick.count({ where: { sessionId: draft.id } })}/${totalPicks} picks`)
  assert.equal(done.status, 'completed', 'draft did not complete')
  // The post-draft bootstrap is fire-and-forget; wait (real time) for the tribes it builds. A fixed
  // five seconds was enough until setup began reading the draft pool, and then the season loop ran
  // 61 pre_draft ticks before any tribe existed. How long it took is part of the result.
  const waitStart = performance.now()
  while (await prisma.survivorTribe.count({ where: { leagueId } }) === 0 && performance.now() - waitStart < 600_000) {
    await new Promise(res => setTimeout(res, 2_000))
  }
  log(`post-draft setup: tribes after ${Math.round((performance.now() - waitStart) / 1000)}s of real time`)
  // RedraftRosterPlayer.addedAt is a database default, so it carries the REAL time, not the moved
  // clock: a draft "held" on 2026-10-16 reads as added on the day the job ran. NBA weekly scoring
  // counts only players added before the week ends, so run 40577159056 (NBA 20) found no roster
  // player in week 1 and never finalized it. Stamp them with the rehearsal's draft time.
  const draftedRosterIds = (await prisma.redraftRoster.findMany({ where: { leagueId }, select: { id: true } })).map(r => r.id)
  const restamped = await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: { in: draftedRosterIds }, addedAt: { gt: rehearsalNow() } }, data: { addedAt: rehearsalNow() } })
  log(`restamped ${restamped.count} drafted players to the rehearsal clock`)
  if (CHIMMY > 0) await checkChimmyCast()
  log(`cast ${await prisma.survivorPlayer.count({ where: { leagueId } })}, tribes ${await prisma.survivorTribe.count({ where: { leagueId } })}, idols ${await prisma.survivorIdol.count({ where: { leagueId } })}`)

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true, season: true } })
  const plan = readSurvivorFullSeasonPlan(league.settings)
  assert.ok(plan, 'no season plan')
  log(`plan: weeks ${plan.startWeek}-${plan.endWeek}, eliminations ${JSON.stringify(plan.eliminationWeeks)}, finale ${plan.finaleWeek}, exile return ${plan.exileReturnWeek ?? '-'}`)
  if (REAL_SCORES) await logRealScoreCensus(league.season)

  // Read by seedWeekScores, which the season loop calls: declared before the loop, not beside it.
  type SeedCategory = { key: string; group: string; points: number }
  let scoringCache: { categories: SeedCategory[]; score: (stats: Record<string, number>, position: string | null) => number } | null = null

  // ── Season loop ──
  const chimmyBallotsExpected = new Map<string, Set<string>>()
  const seeded = new Set<number>()
  const exileSeeded = new Set<number>()
  const exileReasons = new Set<string>()
  // Rows this run's seeding wrote ("playerId:week"), so a real-scores gap fill never mistakes them for real.
  const seededThisRun = new Set<string>()
  const exileCompared = new Set<string>()
  let exileFieldCache: { key: string; fields: Map<string, ExileField> } | null = null
  let last = '', repeats = 0
  for (let step = 0; step < MAX_STEPS; step++) {
    const game = await prisma.survivorGameState.findUnique({ where: { leagueId } })
    const week = game?.currentWeek ?? 0
    // Chimmy's Exile claim happens inside the runner's tick: read the field it chooses from first.
    const exileBefore = CHIMMY > 0 ? await chimmyExileFields(rehearsalNow()) : null
    const outcome = await runPlannedSurvivorLeague(leagueId, rehearsalNow())
    if (exileBefore?.size) await logChimmyExileClaims(exileBefore)
    const key = `${outcome}@${week}`
    repeats = key === last ? repeats + 1 : 0
    if (repeats === 0) log(`week ${week} phase ${game?.phase}: ${outcome}`)
    last = key
    if (outcome === 'season_complete' || outcome === 'complete') break
    if (repeats > 60) { log(`STALL: ${outcome} at week ${week} after ${repeats} tries`); break }

    // Exile rosters (Chimmy's included) are real players off any team; the week's Exile result waits
    // for their scores, which the week's seed above never wrote. Once a week.
    if (outcome === 'awaiting_exile_results' && !exileSeeded.has(week)) {
      exileSeeded.add(week)
      await seedExileScores(week)
      continue
    }
    if (outcome === 'awaiting_verified_scores' && !seeded.has(week)) {
      seeded.add(week)
      await seedWeekScores(week)
      continue
    }
    // Seeded and still not final: say which check holds it, once per week, before the stall limit.
    if (outcome === 'awaiting_verified_scores' && repeats === 3) await explainUnfinalizedWeek(week)
    if (outcome === 'voting_open') {
      await castVotes()
      advanceRehearsalClock(6 * 3_600_000)
      continue
    }
    if (outcome === 'awaiting_jury') {
      await castJuryVotes(week)
      advanceRehearsalClock(6 * 3_600_000)
      continue
    }
    // A read releases one ballot every 2.5 s (REVEAL_STEP_MS); a tied merge council of 10 needs ~25 s
    // before its revote can open. Back-to-back ticks finish in milliseconds, so step the clock like a
    // cron would (run 40565068405 hit the stall limit 14 s into a 25 s read).
    if (outcome === 'ceremony_processed') { advanceRehearsalClock(5 * 60_000); continue }
    // The runner discards Chimmy's Exile result; ask again so a week Chimmy sits out says why.
    if (CHIMMY > 0 && outcome === 'scores_finalized') await explainChimmyExile(week)
    if (['council_opened', 'second_council_opened', 'scores_finalized', 'week_advanced', 'opening_started', 'exile_return_settled', 'final_three_preserved'].includes(outcome)) continue
    advanceRehearsalClock(6 * 3_600_000)
  }

  // ── Summary ──
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId }, select: { displayName: true, playerState: true } })
  const councils = await prisma.survivorTribalCouncil.findMany({ where: { leagueId }, orderBy: [{ week: 'asc' }, { councilNumber: 'asc' }], select: { week: true, councilNumber: true, phase: true, status: true, isRevealed: true, eliminatedUserId: true } })
  const finalGame = await prisma.survivorGameState.findUnique({ where: { leagueId } })
  log(`phase ${finalGame?.phase}, week ${finalGame?.currentWeek}; states ${JSON.stringify(players.reduce<Record<string, number>>((a, p) => ({ ...a, [p.playerState]: (a[p.playerState] ?? 0) + 1 }), {}))}`)
  if (CHIMMY > 0) await chimmySummary()
  log(`councils ${councils.length}: ${councils.map(c => `w${c.week}#${c.councilNumber}:${c.phase}/${c.status}${c.isRevealed ? '' : '(unrevealed)'}`).join(' ')}`)

  async function seedWeekScores(week: number) {
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const rosterIds = (await prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true } })).map(r => r.id)
    const rows = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, droppedAt: null }, select: { playerId: true, position: true, sport: true } })
    const all = [...new Map(rows.map(r => [r.playerId, r])).values()]
    const scoring = await leagueScoring()
    const points: number[] = []
    // Real-scores mode: the rows already there for this week, keyed the way the scorer reads them.
    const existing = REAL_SCORES
      ? new Map((await prisma.playerWeeklyScore.findMany({
          where: { playerId: { in: all.map(p => p.playerId) }, week, season: season.season },
          select: { playerId: true, sport: true, stats: true, fantasyPts: true, isFinalized: true },
        })).map(r => [`${r.playerId}:${r.sport}`, r]))
      : null
    let kept = 0, finalizedReal = 0, replaced = 0
    for (const p of all) {
      const have = existing?.get(`${p.playerId}:${p.sport}`)
      if (have && isRealScoreRow(have) && !seededThisRun.has(`${p.playerId}:${week}`)) {
        kept++
        points.push(scoring.score(have.stats as Record<string, number>, p.position))
        if (!have.isFinalized) {
          // A real line the week never sealed: seal it as it is, or the rehearsal's week cannot finalize.
          await prisma.playerWeeklyScore.update({ where: { playerId_week_season_sport: { playerId: p.playerId, week, season: season.season, sport: p.sport } }, data: { isFinalized: true } })
          finalizedReal++
        }
        continue
      }
      if (have) replaced++
      const stats = statsFor(p.position ?? '', scoring.categories)
      points.push(scoring.score(stats, p.position))
      await prisma.playerWeeklyScore.upsert({
        where: { playerId_week_season_sport: { playerId: p.playerId, week, season: season.season, sport: p.sport } },
        create: { playerId: p.playerId, week, season: season.season, sport: p.sport, stats, fantasyPts: 0, isFinalized: true },
        update: { stats, isFinalized: true },
      })
      seededThisRun.add(`${p.playerId}:${week}`)
    }
    const scored = points.filter(n => n > 0).length
    if (REAL_SCORES) log(`real scores week ${week}: kept ${kept} real rows of ${all.length} rostered players (${finalizedReal} sealed in place), seeded ${all.length - kept} gaps (${replaced} of them over a non-real row)`)
    log(`seeded week ${week} scores for ${all.length} players: ${scored} score above 0 under the league's scoring, range ${Math.min(...points).toFixed(1)} to ${Math.max(...points).toFixed(1)}`)
    // Stat names the league does not score make every team 0 and every council a tie, which looks
    // like a tiebreak problem rather than a seeding one. Stop here instead.
    assert.ok(scored > 0, `week ${week}: no seeded player scores above 0 under this league's scoring; the seeded stat names are wrong for ${SPORT}`)
  }

  async function explainChimmyExile(week: number) {
    const { runChimmyExileTurn } = await import('../../lib/survivor/chimmyExile')
    const exileBefore = await chimmyExileFields(rehearsalNow())
    const turn = await runChimmyExileTurn(leagueId, rehearsalNow())
    if (exileBefore.size) await logChimmyExileClaims(exileBefore)
    for (const [userId, reason] of Object.entries(turn.skipped)) {
      if (reason === 'already_set') continue
      const key = `${userId}:${reason}`
      if (exileReasons.has(key)) continue
      exileReasons.add(key)
      log(`Chimmy Exile w${week}: ${userId.slice(0, 15)} skipped (${reason})`)
    }
    for (const [userId, c] of Object.entries(turn.claimed)) log(`Chimmy Exile w${week}: ${userId.slice(0, 15)} took ${c.team} (${c.players} players, form ${c.expected})`)
  }

  /**
   * What a real-scores run has to work with: finalized rows per week for this sport and season. "real"
   * is a row with points the score sync computed (fantasyPts ≠ 0); the rest are sealed no-show rows
   * ({}) and rehearsal seeds, this branch's earlier runs included, which always write fantasyPts 0.
   */
  async function logRealScoreCensus(seasonYear: number) {
    const where = { sport: { equals: SPORT, mode: 'insensitive' as const }, season: seasonYear }
    const [finalized, real, unsealed] = await Promise.all([
      prisma.playerWeeklyScore.groupBy({ by: ['week'], where: { ...where, isFinalized: true }, _count: { _all: true } }),
      prisma.playerWeeklyScore.groupBy({ by: ['week'], where: { ...where, isFinalized: true, fantasyPts: { not: 0 } }, _count: { _all: true } }),
      prisma.playerWeeklyScore.groupBy({ by: ['week'], where: { ...where, isFinalized: false }, _count: { _all: true } }),
    ])
    const count = (rows: typeof finalized) => new Map(rows.map(r => [r.week, r._count._all]))
    const f = count(finalized), r = count(real), u = count(unsealed)
    const weeks = [...new Set([...f.keys(), ...u.keys()])].sort((a, b) => a - b)
    const total = [...r.values()].reduce((a, b) => a + b, 0)
    log(`real-score census ${SPORT} ${seasonYear}: ${total} real finalized rows${weeks.length ? `; per week real/finalized(+unsealed) ${weeks.map(w => `w${w}:${r.get(w) ?? 0}/${f.get(w) ?? 0}${u.get(w) ? `(+${u.get(w)})` : ''}`).join(' ')}` : '; no PlayerWeeklyScore rows at all'}`)
  }

  /**
   * The field each exiled Chimmy castaway without a team picks from right now: every open team, ranked
   * by the same form Chimmy uses (exileCandidatesFromScores + chimmyExilePlan for that team alone), the
   * same open-team rule (first game of the period not started, not reserved by another castaway).
   * Read before a tick so the comparison sees the field as it was when Chimmy chose.
   */
  async function chimmyExileFields(now: Date): Promise<Map<string, ExileField>> {
    const fields = new Map<string, ExileField>()
    const exiled = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'exile', redraftRosterId: { in: chimmyRosterIds }, userId: { startsWith: 'orphan-' } }, select: { userId: true }, orderBy: { userId: 'asc' } })
    if (!exiled.length) return fields
    const cacheKey = `${now.getTime()}|${exiled.map(e => e.userId).join(',')}`
    if (exileFieldCache?.key === cacheKey) return exileFieldCache.fields
    const { getExileWaivers, exileWeekWindow, exileFirstGames, exileTeamKey } = await import('../../lib/survivor/exileRosterService')
    const { exileCandidatesFromScores, playerScoreAliases, chimmyExilePlan, CHIMMY_EXILE_FORM_WEEKS } = await import('../../lib/survivor/chimmyExile')
    const { buildLeagueStatScorer } = await import('../../lib/redraft/scoringEngine')
    const lg = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
    const scorer = buildLeagueStatScorer(lg)
    if (!scorer || lg.season == null) return fields
    for (const { userId } of exiled) {
      let waivers: Awaited<ReturnType<typeof getExileWaivers>>
      try { waivers = await getExileWaivers(leagueId, userId, '', now) } catch { continue }
      if (waivers.roster.team || waivers.locked || exileCompared.has(`${userId}:${waivers.week}`)) continue
      const window = await exileWeekWindow(prisma as never, lg.sport, lg.season, waivers.week)
      if (!window) continue
      const firstGame = await exileFirstGames(prisma as never, lg.sport, lg.season, waivers.week, window.start, window.end)
      const openKeys = new Set([...firstGame].filter(([, start]) => start > now).map(([key]) => key))
      const taken = waivers.takenTeamIds.map(t => t.toUpperCase())
      const players = (await prisma.player.findMany({
        where: { sport: { equals: lg.sport, mode: 'insensitive' }, active: true, team: { not: null } },
        select: { id: true, name: true, position: true, team: true, providerIds: true },
      })).filter(p => p.team && openKeys.has(exileTeamKey(lg.sport, p.team)))
      const openTeams = [...new Set(players.map(p => p.team!.trim().toUpperCase()))].filter(t => !taken.includes(t))
      const aliasesOf = new Map(players.map(p => [p.id, playerScoreAliases(p)]))
      const rows = await prisma.playerWeeklyScore.findMany({
        where: { playerId: { in: [...new Set([...aliasesOf.values()].flat())] }, sport: lg.sport, season: lg.season, isFinalized: true, week: { gte: waivers.week - CHIMMY_EXILE_FORM_WEEKS, lt: waivers.week } },
        select: { playerId: true, week: true, stats: true, fantasyPts: true },
      })
      const candidates = exileCandidatesFromScores(players, rows, scorer)
      const ranking: ExileTeamForm[] = []
      for (const team of openTeams) {
        const plan = chimmyExilePlan(candidates, lg.sport, lg.settings, [team], taken)
        if (!plan) continue
        const ids = new Set(plan.picks.flatMap(p => aliasesOf.get(p.id) ?? [p.id]))
        const readings = rows.filter(r => ids.has(r.playerId))
        ranking.push({ team: plan.team, expected: plan.expected, filled: plan.picks.length, readings: readings.length, real: readings.filter(r => isRealScoreRow(r)).length })
      }
      // Chimmy's own order (chimmyExileStrategy): form, then starting spots filled, then team code.
      ranking.sort((a, b) => b.expected - a.expected || b.filled - a.filled || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0))
      fields.set(userId, { week: waivers.week, ranking })
    }
    exileFieldCache = { key: cacheKey, fields }
    return fields
  }

  /** After a tick: for each castaway whose team was set by it, how Chimmy's pick ranks in the field it chose from. */
  async function logChimmyExileClaims(before: Map<string, ExileField>) {
    const { getExileWaivers } = await import('../../lib/survivor/exileRosterService')
    const claimed: Array<[string, string]> = []
    for (const [userId, field] of before) {
      if (exileCompared.has(`${userId}:${field.week}`)) continue
      try {
        const after = await getExileWaivers(leagueId, userId, '', rehearsalNow())
        if (after.week === field.week && after.roster.team) claimed.push([userId, after.roster.team.toUpperCase()])
      } catch { /* left Exile in the tick: nothing claimed to judge */ }
    }
    if (!claimed.length) return
    exileFieldCache = null
    for (const [userId, team] of claimed) {
      const field = before.get(userId)!
      exileCompared.add(`${userId}:${field.week}`)
      // Another castaway claiming in the same tick took its team out of this one's field.
      const others = new Set(claimed.filter(([u]) => u !== userId).map(([, t]) => t))
      const open = field.ranking.filter(t => t.team === team || !others.has(t.team))
      const at = open.findIndex(t => t.team === team)
      const mine = open[at]
      const best = open[0]
      const tied = best ? open.filter(t => t.expected === best.expected).length : 0
      const withForm = open.filter(t => t.expected > 0).length
      const desc = (t: ExileTeamForm) => `form ${t.expected} (${t.filled} starters, ${t.real}/${t.readings} form readings real)`
      log(`Chimmy Exile pick w${field.week}: ${userId.slice(0, 15)} took ${team} ${mine ? desc(mine) : '(not in the pre-claim open field)'}; rank ${at >= 0 ? at + 1 : '-'}/${open.length}; best open ${best ? `${best.team} ${desc(best)}` : 'none'}${tied > 1 ? `, ${tied}-way tie at the top` : ''}; ${withForm}/${open.length} open teams have any form`)
    }
  }

  async function seedExileScores(week: number) {
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const entries = await prisma.exileWeeklyEntry.findMany({ where: { leagueId, week }, select: { userId: true, submittedLineup: true } })
    const scoring = await leagueScoring()
    let wrote = 0, real = 0
    for (const entry of entries) {
      const lineup = entry.submittedLineup as { players?: Array<{ id: string; position: string }> } | null
      for (const p of lineup?.players ?? []) {
        const key = { playerId_week_season_sport: { playerId: p.id, week, season: season.season, sport: SPORT } }
        // Any row already there is kept, real or not: Exile seeding never overwrote, with or without --real-scores.
        const have = await prisma.playerWeeklyScore.findUnique({ where: key, select: { stats: true, fantasyPts: true } })
        if (have) { if (isRealScoreRow(have) && !seededThisRun.has(`${p.id}:${week}`)) real++; continue }
        const stats = statsFor(p.position, scoring.categories)
        await prisma.playerWeeklyScore.create({ data: { playerId: p.id, week, season: season.season, sport: SPORT, stats, fantasyPts: 0, isFinalized: true } })
        seededThisRun.add(`${p.id}:${week}`)
        wrote++
      }
    }
    log(`seeded week ${week} Exile scores: ${wrote} players across ${entries.length} Exile rosters${REAL_SCORES ? `; ${real} Exile players already had a real row` : ''}`)
  }

  /** The scorer's own inputs for the first cast member, so a week that will not finalize says why. */
  async function explainUnfinalizedWeek(week: number) {
    const { sumRedraftStartersFantasy } = await import('../../lib/survivor/gameStateMachine')
    const { planWeekWindow } = await import('../../lib/survivor/survivorPlanCalendar')
    const { readWeekGames } = await import('../../lib/redraft/weekGames')
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId }, orderBy: { createdAt: 'desc' } })
    const players = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, redraftRosterId: true } })
    const results = await Promise.all(players.filter(p => p.redraftRosterId).map(async p => ({ p, r: await sumRedraftStartersFantasy(p.redraftRosterId!, week, season) })))
    const notFinal = results.filter(x => !x.r.allFinalized)
    const window = planWeekWindow(SPORT as 'NBA' | 'NHL' | 'NFL' | 'MLB', season.season, week)
    const games = window ? await readWeekGames(prisma, { sport: SPORT, season: season.season, week, seasonType: 'regular', dateWindow: window, now: rehearsalNow() }) : []
    const sample = notFinal[0]
    let detail = ''
    if (sample) {
      const roster = await prisma.roster.findFirst({ where: { id: sample.p.redraftRosterId!, leagueId }, select: { redraftRosterId: true, platformUserId: true } })
      const rows = roster?.redraftRosterId ? await prisma.redraftRosterPlayer.findMany({ where: { rosterId: roster.redraftRosterId, droppedAt: null }, select: { playerId: true, slotType: true, team: true } }) : []
      const finals = await prisma.playerWeeklyScore.count({ where: { playerId: { in: rows.map(r => r.playerId) }, week, season: season.season, isFinalized: true } })
      detail = ` sample roster: linked=${Boolean(roster?.redraftRosterId)} owner=${Boolean(roster?.platformUserId)} players=${rows.length} benched=${rows.filter(r => /bench/i.test(r.slotType)).length} noTeam=${rows.filter(r => !r.team).length} finalizedWeekly=${finals}`
    }
    log(`week ${week} not final: ${notFinal.length}/${results.length} rosters not final; window ${window ? `${window.start.toISOString().slice(0, 10)}..${window.end.toISOString().slice(0, 10)}` : 'none'}; ${games.length} games on the slate;${detail}`)
  }

  async function leagueScoring() {
    if (scoringCache) return scoringCache
    const { resolveLeagueScoringRules } = await import('../../lib/redraft/leagueScoringRules')
    const { buildLeagueStatScorer } = await import('../../lib/redraft/scoringEngine')
    const row = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { sport: true, settings: true } })
    const rules = resolveLeagueScoringRules(row)
    const scorer = buildLeagueStatScorer(row)
    assert.ok(rules && scorer, `no scoring config for ${row.sport}`)
    // Point-earning categories only: tiers score off another stat, and per-game bonuses
    // (hat trick, double-double) need game rows a weekly seed does not write.
    const categories = rules.categories
      .filter(c => c.tierStatKey == null && c.group !== 'bonus')
      .map(c => ({ key: c.key, group: c.group, points: rules.overrides[c.key] ?? c.defaultPoints }))
      .filter(c => c.points !== 0)
    scoringCache = { categories, score: (stats, position) => scorer(stats, position) }
    return scoringCache
  }

  function statsFor(position: string, categories: readonly SeedCategory[]): Record<string, number> {
    const r = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo))
    if (SPORT === 'NFL') {
      if (position === 'QB') return { pass_yds: r(120, 360), pass_td: r(0, 4), rush_yds: r(0, 40) }
      if (position === 'RB') return { rush_yds: r(10, 140), rush_td: r(0, 2), rec: r(0, 6), rec_yds: r(0, 60) }
      if (position === 'WR' || position === 'TE') return { rec: r(1, 10), rec_yds: r(10, 140), rec_td: r(0, 2) }
      return { pts: r(0, 15) }
    }
    // Every other sport: the categories the league scores, read from its own rules, so a seeded
    // stat name cannot drift from the scorer. Goalies and pitchers get only their group's stats.
    const keeper = ['G', 'P', 'SP', 'RP'].includes(position.toUpperCase())
    const own = categories.filter(c => (c.group === 'goalie' || c.group === 'pitching') === keeper)
    return Object.fromEntries(own.map(c => [c.key, r(0, c.points > 0 ? 4 : 2)]))
  }

  async function handChimmySeats(): Promise<string[]> {
    if (CHIMMY <= 0) return []
    assert.ok(CHIMMY < CAST, 'leave at least one human manager')
    const { releaseLeagueSeat } = await import('../../lib/league/leagueSeats')
    const { applyChimmyAutopilot } = await import('../../lib/inactive-manager/inactiveManagerService')
    const { AF_MANAGED_LINEUPS_KEY, readManagedLineups, isChimmyRunning, CHIMMY_MANAGER_LIMIT } = await import('../../lib/inactive-manager/inactiveManagerMode')
    const seats = rosters.slice(CAST - CHIMMY)
    const ids = seats.map(r => r.id)
    for (const [i, r] of seats.entries()) {
      const released = await releaseLeagueSeat(prisma, { leagueId, rosterId: r.id })
      assert.ok(released.ok, `release seat ${r.id}: ${JSON.stringify(released)}`)
      await prisma.leagueTeam.updateMany({ where: { leagueId, externalId: r.id }, data: { teamName: `Team ${CAST - CHIMMY + i + 1}` } })
      const on = await applyChimmyAutopilot(leagueId, userIds[0], r.id, 'win_now')
      if (!on.ok && on.status === 402 && !planGateLogged) {
        // The rehearsal's test owner has no AF Commissioner plan, so the gate refuses: that is the gate
        // working. Write the same entry the switch writes, so the rest of the season is Chimmy's.
        planGateLogged = true
        log(`Chimmy switch refused for the unpaid test owner (${on.error}); writing its entry directly`)
      } else if (!on.ok && on.status !== 402) {
        assert.fail(`Chimmy switch for ${r.id}: ${JSON.stringify(on)}`)
      }
      if (!on.ok) {
        const row = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
        const settings = (row.settings ?? {}) as Record<string, unknown>
        const managed = readManagedLineups(settings)
        const now = rehearsalNow().toISOString()
        managed[r.id] = { since: now, byUserId: userIds[0], ownerUserId: `orphan-${r.id}`, autopilot: { style: 'win_now', since: now, byUserId: userIds[0] } } as (typeof managed)[string]
        await prisma.league.update({ where: { id: leagueId }, data: { settings: { ...settings, [AF_MANAGED_LINEUPS_KEY]: managed } as object } })
      }
    }
    const row = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
    const managed = readManagedLineups(row.settings)
    const owners = await prisma.roster.findMany({ where: { id: { in: ids } }, select: { id: true, platformUserId: true } })
    for (const o of owners) assert.ok(isChimmyRunning(managed, o.id, o.platformUserId), `Chimmy is not running ${o.id} (owner ${o.platformUserId})`)
    log(`Chimmy runs ${ids.length} of ${CAST} teams (limit ${CHIMMY_MANAGER_LIMIT}): seats ${owners.map(o => o.platformUserId).join(', ')}`)
    return ids
  }

  async function checkChimmyCast() {
    const cast = await prisma.survivorPlayer.findMany({ where: { leagueId, redraftRosterId: { in: chimmyRosterIds } }, select: { userId: true, displayName: true, tribeId: true } })
    log(`Chimmy castaways: ${cast.map(c => `${c.displayName}${c.tribeId ? '' : ' (no tribe)'}`).join(', ')}`)
    assert.equal(cast.length, chimmyRosterIds.length, 'every Chimmy team should be a castaway')
    for (const c of cast) {
      assert.match(c.displayName, /\(Chimmy\)$|^Chimmy \d+$/, `Chimmy castaway named ${c.displayName}`)
      assert.ok(c.tribeId, `${c.displayName} has no tribe`)
    }
    if (CHIMMY_IDOLS > 0) {
      const config = await prisma.survivorLeagueConfig.findUniqueOrThrow({ where: { leagueId }, select: { id: true } })
      for (const c of cast) {
        const rosterId = chimmyRosterIds.find(id => c.userId === `orphan-${id}`) ?? chimmyRosterIds[0]
        // The idol rides a player on Chimmy's OWN roster: the engine checks the holder's roster owns it.
        const link = await prisma.roster.findUniqueOrThrow({ where: { id: rosterId }, select: { redraftRosterId: true } })
        const held = link.redraftRosterId ? await prisma.redraftRosterPlayer.findFirst({ where: { rosterId: link.redraftRosterId, droppedAt: null }, select: { playerId: true } }) : null
        assert.ok(held, `Chimmy roster ${rosterId} has no drafted player to carry an idol`)
        await prisma.survivorIdol.create({ data: {
          leagueId, configId: config.id, rosterId, playerId: held.playerId, powerType: 'protect_self',
          status: 'hidden', currentOwnerUserId: c.userId, originalOwnerUserId: c.userId, powerLabel: 'Hidden Immunity Idol',
        } })
      }
      log(`gave each Chimmy castaway a hidden protect_self idol (${cast.length})`)
    }
    const picks = await prisma.draftPick.groupBy({ by: ['rosterId'], where: { sessionId: draft.id, rosterId: { in: chimmyRosterIds } }, _count: { _all: true } })
    log(`Chimmy drafted: ${picks.map(p => p._count._all).join(', ')} picks (rounds ${draft.rounds})`)
    assert.equal(picks.length, chimmyRosterIds.length)
    for (const p of picks) assert.equal(p._count._all, draft.rounds, `a Chimmy team drafted ${p._count._all} of ${draft.rounds}`)
  }

  async function chimmySummary() {
    let expected = 0, cast = 0
    const missing: string[] = []
    for (const [councilId, voters] of chimmyBallotsExpected) {
      const votes = await prisma.survivorVote.findMany({ where: { councilId, voterUserId: { in: [...voters] } }, select: { voterUserId: true } })
      const have = new Set(votes.map(v => v.voterUserId))
      for (const v of voters) { expected++; if (have.has(v)) cast++; else missing.push(`${councilId}:${v}`) }
    }
    const cast_ = await prisma.survivorPlayer.findMany({ where: { leagueId, redraftRosterId: { in: chimmyRosterIds } }, select: { userId: true, displayName: true, playerState: true } })
    const userIdsChimmy = cast_.map(c => c.userId)
    const idols = await prisma.survivorIdol.findMany({ where: { leagueId, OR: [{ currentOwnerUserId: { in: userIdsChimmy } }, { rosterId: { in: chimmyRosterIds } }] }, select: { status: true, powerType: true } })
    const played = idols.filter(i => i.status !== 'hidden')
    const exileEntries = await prisma.exileWeeklyEntry.findMany({ where: { leagueId, userId: { in: userIdsChimmy } }, select: { week: true, submittedLineup: true } })
    const exileTeams = exileEntries.map(e => { const l = e.submittedLineup as { team?: string | null; players?: unknown[] } | null; return `w${e.week}:${l?.team ?? '-'}(${l?.players?.length ?? 0})` })
    log(`Chimmy on Exile: ${exileTeams.length ? exileTeams.join(' ') : 'no Exile weeks'}`)
    log(`Chimmy season: ${cast}/${expected} ballots cast across ${chimmyBallotsExpected.size} councils; idols held ${idols.length}, played ${played.length} (${played.map(i => i.powerType).join(', ') || 'none'}); finished ${cast_.map(c => `${c.displayName}=${c.playerState}`).join(', ')}`)
    assert.ok(chimmyBallotsExpected.size > 0, 'Chimmy never sat at a council')
    assert.deepEqual(missing, [], 'Chimmy left a ballot unsent')
  }

  async function castVotes() {
    const ctx = await loadCouncilContext(leagueId)
    if (!ctx) return
    const votedRosters = new Set((await prisma.survivorVote.findMany({ where: { councilId: ctx.council.id }, select: { voterRosterId: true } })).map(v => v.voterRosterId))
    const existing = new Set(ctx.eligibility.voterUserIds.filter(u => votedRosters.has(ctx.userToRoster[u])))
    let cast = 0, skipped = 0, refused = 0
    const chimmyVoters = ctx.eligibility.voterUserIds.filter(u => chimmyRosterIds.includes(ctx.userToRoster[u] ?? ''))
    if (chimmyVoters.length) {
      const seen = chimmyBallotsExpected.get(ctx.council.id) ?? new Set<string>()
      chimmyVoters.forEach(u => seen.add(u))
      chimmyBallotsExpected.set(ctx.council.id, seen)
      log(`council w${ctx.council.week}#${ctx.council.councilNumber}: Chimmy had already voted for ${chimmyVoters.filter(u => existing.has(u)).length}/${chimmyVoters.length} of its castaways when the managers' ballots opened`)
    }
    for (const voter of ctx.eligibility.voterUserIds) {
      if (existing.has(voter)) continue
      if (chimmyVoters.includes(voter)) continue // Chimmy's own turn casts these; never the harness
      if (rand() > VOTE_RATE) { skipped++; continue }
      const targets = ctx.eligibility.targetsByVoter[voter] ?? []
      if (!targets.length) continue
      const result = await submitPrivateVoteCommand(leagueId, voter, `@Chimmy vote <@${pick(targets)}>`)
      if (result.ok) cast++
      else { refused++; log(`vote refused for ${voter}: ${JSON.stringify(result)}`) }
    }
    log(`council w${ctx.council.week}#${ctx.council.councilNumber} ${ctx.council.phase}: ${cast} votes, ${skipped} abstained (auto-cast expected), ${refused} refused, ${ctx.eligibility.voterUserIds.length} eligible`)
  }

  async function castJuryVotes(week: number) {
    const state = await getFinaleState(leagueId, week)
    if (!state.open) return
    let cast = 0
    for (const juror of state.juryRosterIds) {
      const choices = state.finalists.filter(f => f !== juror)
      const r = await submitJuryVote({ leagueId, jurorRosterId: juror, finalistRosterId: pick(choices), week, source: 'rehearsal' })
      if (r.ok) cast++
      else if (!/already/i.test(r.error ?? '')) log(`jury vote refused: ${r.error}`)
    }
    log(`jury: ${cast} votes from ${state.juryRosterIds.length} jurors for ${state.finalists.length} finalists`)
  }
}

main()
  .catch(error => {
    const text = String(error?.stack ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]')
    console.error(text)
    try { appendFileSync(LOG, `FATAL ${text}\n`) } catch {}
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import('../../lib/prisma')
    await prisma.$disconnect()
  })
