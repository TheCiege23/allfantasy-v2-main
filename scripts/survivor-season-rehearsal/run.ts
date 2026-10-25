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

let seed = 0x5eed
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
  // The post-draft bootstrap is fire-and-forget in places; give it a moment, then read what it built.
  await new Promise(res => setTimeout(res, 5_000))
  log(`cast ${await prisma.survivorPlayer.count({ where: { leagueId } })}, tribes ${await prisma.survivorTribe.count({ where: { leagueId } })}, idols ${await prisma.survivorIdol.count({ where: { leagueId } })}`)

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true, season: true } })
  const plan = readSurvivorFullSeasonPlan(league.settings)
  assert.ok(plan, 'no season plan')
  log(`plan: weeks ${plan.startWeek}-${plan.endWeek}, eliminations ${JSON.stringify(plan.eliminationWeeks)}, finale ${plan.finaleWeek}, exile return ${plan.exileReturnWeek ?? '-'}`)

  // ── Season loop ──
  const seeded = new Set<number>()
  let last = '', repeats = 0
  for (let step = 0; step < MAX_STEPS; step++) {
    const game = await prisma.survivorGameState.findUnique({ where: { leagueId } })
    const week = game?.currentWeek ?? 0
    const outcome = await runPlannedSurvivorLeague(leagueId, rehearsalNow())
    const key = `${outcome}@${week}`
    repeats = key === last ? repeats + 1 : 0
    if (repeats === 0) log(`week ${week} phase ${game?.phase}: ${outcome}`)
    last = key
    if (outcome === 'season_complete' || outcome === 'complete') break
    if (repeats > 60) { log(`STALL: ${outcome} at week ${week} after ${repeats} tries`); break }

    if (outcome === 'awaiting_verified_scores' && !seeded.has(week)) {
      seeded.add(week)
      await seedWeekScores(week)
      continue
    }
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
    if (['council_opened', 'second_council_opened', 'ceremony_processed', 'scores_finalized', 'week_advanced', 'opening_started', 'exile_return_settled', 'final_three_preserved'].includes(outcome)) continue
    advanceRehearsalClock(6 * 3_600_000)
  }

  // ── Summary ──
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId }, select: { displayName: true, playerState: true } })
  const councils = await prisma.survivorTribalCouncil.findMany({ where: { leagueId }, orderBy: [{ week: 'asc' }, { councilNumber: 'asc' }], select: { week: true, councilNumber: true, phase: true, status: true, isRevealed: true, eliminatedUserId: true } })
  const finalGame = await prisma.survivorGameState.findUnique({ where: { leagueId } })
  log(`phase ${finalGame?.phase}, week ${finalGame?.currentWeek}; states ${JSON.stringify(players.reduce<Record<string, number>>((a, p) => ({ ...a, [p.playerState]: (a[p.playerState] ?? 0) + 1 }), {}))}`)
  log(`councils ${councils.length}: ${councils.map(c => `w${c.week}#${c.councilNumber}:${c.phase}/${c.status}${c.isRevealed ? '' : '(unrevealed)'}`).join(' ')}`)

  async function seedWeekScores(week: number) {
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const rosterIds = (await prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true } })).map(r => r.id)
    const rows = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, droppedAt: null }, select: { playerId: true, position: true, sport: true } })
    const all = [...new Map(rows.map(r => [r.playerId, r])).values()]
    for (const p of all) {
      const stats = statsFor(p.position ?? '')
      await prisma.playerWeeklyScore.upsert({
        where: { playerId_week_season_sport: { playerId: p.playerId, week, season: season.season, sport: p.sport } },
        create: { playerId: p.playerId, week, season: season.season, sport: p.sport, stats, fantasyPts: 0, isFinalized: true },
        update: { stats, isFinalized: true },
      })
    }
    log(`seeded week ${week} scores for ${all.length} players`)
  }

  function statsFor(position: string): Record<string, number> {
    const r = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo))
    if (position === 'QB') return { pass_yds: r(120, 360), pass_td: r(0, 4), rush_yds: r(0, 40) }
    if (position === 'RB') return { rush_yds: r(10, 140), rush_td: r(0, 2), rec: r(0, 6), rec_yds: r(0, 60) }
    if (position === 'WR' || position === 'TE') return { rec: r(1, 10), rec_yds: r(10, 140), rec_td: r(0, 2) }
    return { pts: r(0, 15) }
  }

  async function castVotes() {
    const ctx = await loadCouncilContext(leagueId)
    if (!ctx) return
    const votedRosters = new Set((await prisma.survivorVote.findMany({ where: { councilId: ctx.council.id }, select: { voterRosterId: true } })).map(v => v.voterRosterId))
    const existing = new Set(ctx.eligibility.voterUserIds.filter(u => votedRosters.has(ctx.userToRoster[u])))
    let cast = 0, skipped = 0, refused = 0
    for (const voter of ctx.eligibility.voterUserIds) {
      if (existing.has(voter)) continue
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
