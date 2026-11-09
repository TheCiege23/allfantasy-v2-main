/**
 * The commissioner and manager scenarios layered on the dynasty season (SIM_SCENARIOS=1):
 *
 *   pre-draft   roster change, scoring change incl. TE premium (both commissioner screens)
 *   week 1      integrity monitor on; hold severely flagged trades; tanking penalty = forfeit a 1st
 *   week 2      waivers: two managers bid FAAB on one free agent, a third claims with a drop
 *   week 3      instant free-agent add
 *   wk 3-7      two tankers start injured players over healthy bench; the commissioner confirms each
 *               flag — tanker A's penalty is a forfeited pick, tanker B's (after a policy switch) FAAB
 *   week 6      (dynastyTrades.ts) fair / 3 lopsided / future-pick trades → a 4th lopsided deal under
 *               "hold severe" → the commissioner reverses one lopsided deal; a 2027 2nd is traded
 *   week 7      league health: an inactive manager; the commissioner hub
 *   week 8      a manager is removed and a new one takes the team; a removed manager comes BACK
 *   week 10     Chimmy's deterministic tools: waivers, FAAB plan, lineup, outlook, trade ideas, history
 *   last week   the commissioner sets the live rookie order (non-playoff reverse max PF, playoff by finish)
 *   offseason   a manager leaves and a new one takes over before the rookie draft; the order is checked
 *               against the rule; traded and forfeited picks are checked on the board
 *
 * Every step calls the route the real screen calls, records the response, and checks the database
 * afterwards. A refused gate is a finding with its reason — never a crash.
 */
import { rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import type { LeagueRun, SimEnv } from './dynastyHarness'

type Add = (f: { code: string; stage: 'season' | 'playoffs' | 'offseason'; message: string; detail?: unknown }) => void
type Seat = { rosterId: string; userId: string; seasonRosterId: string | null }

const NOW_ISO = () => new Date().toISOString()
const COMMISH_EMAIL = 'commish@sim.allfantasy.test'

async function call(handler: (...a: any[]) => Promise<Response>, url: string, init: { method: string; body?: unknown } | null, params?: Record<string, string>) {
  const { NextRequest } = await import('next/server')
  const req = new NextRequest(`http://sim.allfantasy.test${url}`, init ? { method: init.method, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) } : undefined)
  const res = await (params ? handler(req, { params: Promise.resolve(params) }) : handler(req))
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function signInAs(env: SimEnv, userId: string) {
  env.signIn({ id: userId, email: userId === 'sim-commish' ? COMMISH_EMAIL : `${userId}@sim.allfantasy.test`, name: userId })
}

function seats(env: SimEnv, run: LeagueRun): Seat[] {
  return (rowsOf(env.db, 'Roster') as any[])
    .filter((r) => r.leagueId === run.leagueId)
    .map((r) => ({ rosterId: r.id, userId: String(r.platformUserId), seasonRosterId: r.redraftRosterId ?? null }))
    .sort((a, b) => a.rosterId.localeCompare(b.rosterId))
}

function seasonRoster(env: SimEnv, id: string | null) {
  return id ? (rowsOf(env.db, 'RedraftRoster') as any[]).find((r) => r.id === id) ?? null : null
}

/** A scenario written around a 12-team league skips, and says so, when the league has too few teams. */
function tooFewSeats(all: Seat[], needed: number, S: Record<string, any>, name: string): boolean {
  if (all.length >= needed) return false
  ;(S.skippedForLeagueSize ??= []).push(`${name}: needs ${needed} teams, the league has ${all.length}`)
  return true
}

function holdings(env: SimEnv, seasonRosterId: string | null) {
  return (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => p.rosterId === seasonRosterId && !p.droppedAt)
}

const isStarter = (slot: unknown) => !/^bn$|^bench$|^ir$|^taxi$/i.test(String(slot ?? ''))

// ── Pre-draft: roster and scoring ─────────────────────────────────────────────

/** A TE and a WR with the same 10-catch, 100-yard line, through the scorer the matchups use. */
async function probeScoring(env: SimEnv, run: LeagueRun) {
  const { buildLeagueStatScorer } = await import('@/lib/redraft/scoringEngine')
  const league = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === run.leagueId)
  const scorer = buildLeagueStatScorer({ sport: run.sport, settings: league.settings })
  if (!scorer) return null
  const line = { rec: 10, receptions: 10, rec_yd: 100, receiving_yards: 100 } as Record<string, number>
  const te = Number(scorer(line, 'TE'))
  const wr = Number(scorer(line, 'WR'))
  return { te, wr, tePremiumPerCatch: Math.round(((te - wr) / 10) * 100) / 100 }
}

export async function preDraftSettings(env: SimEnv, run: LeagueRun): Promise<void> {
  if (!run.leagueId) return
  const out: Record<string, unknown> = {}
  const leagueId = run.leagueId
  signInAs(env, run.commissionerId)
  const add = (code: string, message: string, detail?: unknown) => run.findings.push({ code, stage: 'create', message, detail } as never)

  // Roster: one more bench spot, as the Roster Settings screen saves it.
  const roster = await import('@/app/api/commissioner/leagues/[leagueId]/roster-settings/route')
  const before = await call(roster.GET, `/api/commissioner/leagues/${leagueId}/roster-settings`, null, { leagueId })
  const session = () => (rowsOf(env.db, 'DraftSession') as any[]).filter((s) => s.leagueId === leagueId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  const roundsBefore = session()?.rounds ?? null
  const leagueRow = () => (rowsOf(env.db, 'League') as any[]).find((l) => l.id === leagueId)
  const sizeBefore = leagueRow()?.rosterSize ?? null
  const slots: Record<string, number> | null = (before.body as any)?.slots ?? (before.body as any)?.config?.slots ?? (before.body as any)?.effective?.slots ?? null
  out.rosterGet = { status: before.status, keys: before.body ? Object.keys(before.body).slice(0, 12) : null, slots }
  if (slots && typeof slots.BN === 'number') {
    const next = { ...slots, BN: slots.BN + 1 }
    const put = await call(roster.PUT, `/api/commissioner/leagues/${leagueId}/roster-settings`, { method: 'PUT', body: { slots: next, templateKey: 'custom' } }, { leagueId })
    const { getComputedDraftRounds } = await import('@/lib/draft/computedDraftRounds')
    out.rosterPut = { status: put.status, error: (put.body as any)?.error ?? null, roundsBefore, roundsAfter: session()?.rounds ?? null, sizeBefore, sizeAfter: leagueRow()?.rosterSize ?? null, draftRoundsSync: (put.body as any)?.draftRounds ?? null, computed: await getComputedDraftRounds(leagueId).catch((e: Error) => e.message), sessionStatus: session()?.status, sessionMode: session()?.draftModeLabel ?? null }
    // The startup draft now runs to the session's new length.
    if (put.status === 200 && session()?.rounds) run.rounds = Number(session().rounds)
    if (put.status !== 200) add('ROSTER_CHANGE_REFUSED', `Adding a bench spot before the draft returned ${put.status}: ${JSON.stringify(put.body).slice(0, 200)}`)
    else if (roundsBefore != null && session()?.rounds !== roundsBefore + 1) add('DRAFT_ROUNDS_NOT_RESIZED', `Bench +1 before the draft: rounds ${roundsBefore} → ${session()?.rounds}, expected ${roundsBefore + 1}.`)
  } else {
    add('ROSTER_SETTINGS_UNREADABLE', `Roster settings GET ${before.status} returned no slot counts: ${JSON.stringify(before.body).slice(0, 200)}`)
  }

  // Scoring: the NFL scoring panel's TE premium, then the sport-config toggle. A TE premium is NFL only.
  if (run.sport !== 'NFL') {
    run.stats.preDraftSettings = out
    return
  }
  out.scoringBaseline = await probeScoring(env, run)
  const nfl = await import('@/app/api/commissioner/leagues/[leagueId]/nfl-scoring/route')
  const panel = await call(nfl.PUT, `/api/commissioner/leagues/${leagueId}/nfl-scoring`, { method: 'PUT', body: { presetKey: 'custom', rules: { te_premium: 0.5, passing_td: 6 } } }, { leagueId })
  out.scoringPanel = { status: panel.status, error: (panel.body as any)?.error ?? null, after: await probeScoring(env, run) }
  const settings = await import('@/app/api/league/settings/route')
  const toggle = await call(settings.PATCH, '/api/league/settings', { method: 'PATCH', body: { leagueId, sportConfig: { enableTEPremium: true } } })
  out.scoringToggle = { status: toggle.status, error: (toggle.body as any)?.error ?? null, after: await probeScoring(env, run) }
  const panelTep = (out.scoringPanel as any).after?.tePremiumPerCatch
  const toggleTep = (out.scoringToggle as any).after?.tePremiumPerCatch
  if (panel.status === 200 && !panelTep) {
    add('TE_PREMIUM_FROM_SCORING_PANEL_SCORES_NOTHING', `The NFL scoring panel saved te_premium 0.5 (200), and a TE's 10 catches still score the same as a WR's (${JSON.stringify((out.scoringPanel as any).after)}).`)
  }
  if (toggle.status === 200 && toggleTep !== 0.5) {
    add('TE_PREMIUM_NOT_0_5_AFTER_TOGGLE', `With te_premium 0.5 saved and enableTEPremium on, a TE catch is worth ${toggleTep} extra (expected 0.5).`)
  }
  run.stats.preDraftSettings = out
}

// ── The weekly scenarios ──────────────────────────────────────────────────────

export type WeekCtx = { seasonId: string; week: number; regularWeeks: number; add: Add }

export async function weeklyScenarios(env: SimEnv, run: LeagueRun, ctx: WeekCtx): Promise<void> {
  if (!run.leagueId) return
  const S = (run.stats.scenarios ??= {}) as Record<string, any>
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      ctx.add({ code: 'SCENARIO_THREW', stage: 'season', message: `${name} (week ${ctx.week}): ${(e as Error).message}`, detail: String((e as Error).stack).split('\n').slice(0, 5).join(' | ') })
    }
  }
  if (ctx.week === 1) await step('integrity-setup', () => integritySetup(env, run, S))
  if (ctx.week === 2) await step('waivers', () => waivers(env, run, ctx, S))
  if (ctx.week === 3) await step('free-agent', () => freeAgentAdd(env, run, ctx, S))
  if (ctx.week >= 3 && ctx.week <= 7) await step('tanking', () => tanking(env, run, ctx, S))
  if (ctx.week === 7) await step('health', () => leagueHealth(env, run, ctx, S))
  if (ctx.week === 8) await step('takeover', () => takeover(env, run, ctx, S, 'midseason'))
  if (ctx.week === 10) await step('chimmy', () => chimmySweep(env, run, ctx, S))
  if (ctx.week === ctx.regularWeeks) await step('rookie-order-setting', () => setLiveRookieOrder(env, run, S))
}

/** Before the lineups that tanking reads are scored: the tankers start injured players over healthy bench. */
export async function beforeWeekScoring(env: SimEnv, run: LeagueRun, ctx: WeekCtx): Promise<void> {
  if (!run.leagueId || ctx.week < 3 || ctx.week > 7) return
  const tanker = tankerFor(env, run, ctx.week)
  if (!tanker) return
  const starters = holdings(env, tanker.seasonRosterId).filter((p) => isStarter(p.slotType))
  for (const p of starters.slice(0, 3)) await env.db.redraftRosterPlayer.update({ where: { id: p.id }, data: { injuryStatus: 'Out' } })
  // The tanker SAVES that lineup on the lineup screen — what the tanking scan reads (afRosterLineupAssignment).
  const roster = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === tanker.rosterId)
  signInAs(env, tanker.userId)
  const save = await import('@/app/api/leagues/roster/save/route')
  const res = await call(save.POST, '/api/leagues/roster/save', { method: 'POST', body: { leagueId: run.leagueId, rosterId: tanker.rosterId, rosterData: roster?.playerData, week: ctx.week } })
  const saved = (rowsOf(env.db, 'AfRosterLineupAssignment') as any[]).filter((a) => a.rosterId === tanker.rosterId && a.week === ctx.week).length
  const S = (run.stats.scenarios ??= {}) as Record<string, any>
  ;(S.tankerLineupSaves ??= []).push({ week: ctx.week, user: tanker.userId, status: res.status, error: (res.body as any)?.error ?? null, assignmentsThisWeek: saved })
}

function tankerFor(env: SimEnv, run: LeagueRun, week: number): Seat | null {
  const all = seats(env, run).filter((s) => !s.userId.startsWith('orphan-'))
  // A: weeks 3-4 (forfeit a pick). B: weeks 5-6 (FAAB). Week 7: A again, a third strike.
  if (week === 3 || week === 4 || week === 7) return all.find((s) => s.userId === 'sim-mgr-011') ?? null
  if (week === 5 || week === 6) return all.find((s) => s.userId === 'sim-mgr-012') ?? null
  return null
}

async function integritySetup(env: SimEnv, run: LeagueRun, S: Record<string, any>) {
  signInAs(env, run.commissionerId)
  const integrity = await import('@/app/api/leagues/[leagueId]/integrity/handler')
  const put = await call(integrity.PUT, `/api/leagues/${run.leagueId}/integrity`, {
    method: 'PUT',
    body: {
      tankingMonitorEnabled: true,
      tankingStartWeek: 1,
      tankingIllegalLineupCheck: true,
      holdFlaggedTradesMode: 'severe',
      tankingPenalties: { enabled: true, penalty: 'forfeit_pick', pickAtStrike: 2, pickRound: 1 },
    },
  }, { leagueId: run.leagueId! })
  S.integritySetup = { status: put.status, error: (put.body as any)?.error ?? null }
  const row = (rowsOf(env.db, 'LeagueIntegritySettings') as any[]).find((r) => r.leagueId === run.leagueId)
  S.integritySettings = row ? { tankingMonitorEnabled: row.tankingMonitorEnabled, tankingStartWeek: row.tankingStartWeek } : null
}

// ── Waivers (the waiver screen's routes: claims → process) ───────────────────

async function waivers(env: SimEnv, run: LeagueRun, ctx: WeekCtx, S: Record<string, any>) {
  const leagueId = run.leagueId!
  const db = env.db
  const all = seats(env, run)
  const rostered = new Set((rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => !p.droppedAt).map((p) => String(p.playerId)))
  const freeAgents = (rowsOf(db, 'SportsPlayer') as any[]).filter((p) => p.sport === run.sport && /^sim-/.test(String(p.id)) && !rostered.has(String(p.id)))
  const prize = freeAgents.find((p) => p.position === 'WR') ?? freeAgents[0]
  const second = freeAgents.find((p) => p.id !== prize?.id && p.position === 'RB') ?? freeAgents[1]
  if (!prize || !second) {
    ctx.add({ code: 'NO_FREE_AGENTS', stage: 'season', message: 'No unrostered players to claim.' })
    return
  }
  if (tooFewSeats(all, 5, S, 'waivers')) return
  const claims = await import('@/app/api/waiver-wire/leagues/[leagueId]/claims/route')
  const [a, b, c] = [all[2]!, all[3]!, all[4]!]
  const dropOf = (s: Seat) => holdings(env, s.seasonRosterId).filter((p) => !isStarter(p.slotType)).sort((x, y) => String(y.playerId).localeCompare(String(x.playerId)))[0]
  const faab = (s: Seat) => ({ generic: (rowsOf(db, 'Roster') as any[]).find((r) => r.id === s.rosterId)?.faabRemaining ?? null, season: seasonRoster(env, s.seasonRosterId)?.faabBalance ?? null })
  const submitted: any[] = []
  for (const [seat, player, bid] of [[a, prize, 17], [b, prize, 9], [c, second, 3]] as const) {
    const drop = dropOf(seat)
    signInAs(env, seat.userId)
    const res = await call(claims.POST, `/api/waiver-wire/leagues/${leagueId}/claims`, { method: 'POST', body: { addPlayerId: player.id, dropPlayerId: drop?.playerId, faabBid: bid } }, { leagueId })
    submitted.push({ user: seat.userId, add: player.id, drop: drop?.playerId ?? null, bid, status: res.status, error: (res.body as any)?.error ?? null, faabBefore: faab(seat) })
  }
  // Chimmy sees the pending claims (`get_waiver_status`) before they run.
  const { executeChimmyTool } = await import('@/lib/chimmy/tools/chimmyTools')
  const pendingView = String(await executeChimmyTool('get_waiver_status', {}, { leagueId, userId: a.userId } as any).catch((e: Error) => `THREW ${e.message}`))
  // The commissioner runs the claims (the waiver process route).
  signInAs(env, run.commissionerId)
  const proc = await import('@/app/api/waiver-wire/leagues/[leagueId]/process/route')
  const ran = await call(proc.POST, `/api/waiver-wire/leagues/${leagueId}/process`, { method: 'POST', body: {} }, { leagueId })
  const holder = (playerId: string) => (rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => String(p.playerId) === playerId && !p.droppedAt).map((p) => p.rosterId)
  const wonBy = holder(prize.id)
  const result = {
    submitted,
    process: { status: ran.status, body: JSON.stringify(ran.body).slice(0, 300) },
    prize: { player: prize.id, seasonHolders: wonBy, expectedWinner: a.seasonRosterId },
    second: { player: second.id, seasonHolders: holder(second.id), expected: c.seasonRosterId },
    faabAfter: { a: faab(a), b: faab(b), c: faab(c) },
    chimmyPending: pendingView.slice(0, 400),
  }
  S.waivers = result
  if (submitted.some((s) => s.status !== 200 && s.status !== 201)) ctx.add({ code: 'WAIVER_CLAIM_REFUSED', stage: 'season', message: `Claims: ${submitted.map((s) => `${s.user} ${s.status} ${s.error ?? ''}`).join('; ')}` })
  if (wonBy.length !== 1 || wonBy[0] !== a.seasonRosterId) ctx.add({ code: 'WAIVER_FAAB_WINNER_WRONG', stage: 'season', message: `$17 beat $9 for ${prize.id}; season holders are [${wonBy.join(', ')}], expected ${a.seasonRosterId}.` })
  const aAfter = faab(a)
  const aBefore = submitted[0]!.faabBefore
  if (aAfter.season != null && aBefore.season != null && aAfter.season !== aBefore.season - 17) ctx.add({ code: 'WAIVER_FAAB_NOT_CHARGED', stage: 'season', message: `Winner's season FAAB ${aBefore.season} → ${aAfter.season}; expected −17.` })
  if (aAfter.generic != null && aAfter.season != null && aAfter.generic !== aAfter.season) ctx.add({ code: 'FAAB_MIRRORS_DISAGREE', stage: 'season', message: `After waivers the winner's FAAB is ${aAfter.generic} on the league roster and ${aAfter.season} on the season roster.` })
  const bAfter = faab(b)
  if (bAfter.season != null && bAfter.season !== submitted[1]!.faabBefore.season) ctx.add({ code: 'WAIVER_LOSER_CHARGED', stage: 'season', message: `The losing $9 bidder's FAAB moved ${submitted[1]!.faabBefore.season} → ${bAfter.season}.` })
  if (!/pending|claim|\$?17/i.test(pendingView)) ctx.add({ code: 'CHIMMY_DOES_NOT_SEE_PENDING_CLAIM', stage: 'season', message: `get_waiver_status before processing: ${pendingView.slice(0, 160)}` })
}

async function freeAgentAdd(env: SimEnv, run: LeagueRun, ctx: WeekCtx, S: Record<string, any>) {
  const leagueId = run.leagueId!
  const rostered = new Set((rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => !p.droppedAt).map((p) => String(p.playerId)))
  const fa = (rowsOf(env.db, 'SportsPlayer') as any[]).find((p) => p.sport === run.sport && /^sim-/.test(String(p.id)) && !rostered.has(String(p.id)) && p.position === 'TE')
  if (tooFewSeats(seats(env, run), 6, S, 'free-agent add')) return
  const seat = seats(env, run)[5]!
  const drop = holdings(env, seat.seasonRosterId).filter((p) => !isStarter(p.slotType))[0]
  if (!fa || !drop) {
    S.freeAgent = { skipped: !fa ? 'no unrostered TE in the pool' : 'no bench player to drop' }
    return
  }
  signInAs(env, seat.userId)
  const route = await import('@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route')
  const res = await call(route.POST, `/api/waiver-wire/leagues/${leagueId}/add-drop`, { method: 'POST', body: { addPlayerId: fa.id, dropPlayerId: drop.playerId } }, { leagueId })
  const on = holdings(env, seat.seasonRosterId).some((p) => String(p.playerId) === fa.id)
  const stillHasDrop = holdings(env, seat.seasonRosterId).some((p) => String(p.playerId) === String(drop.playerId))
  S.freeAgent = { status: res.status, error: (res.body as any)?.error ?? null, added: on, dropped: !stillHasDrop }
  if (res.status === 409 && (res.body as any)?.code === 'WAIVER_REQUIRED') {
    // The league's own rule (e.g. FAAB waivers with instant free agency off): every pickup is a claim.
    const claims = await import('@/app/api/waiver-wire/leagues/[leagueId]/claims/route')
    const claim = await call(claims.POST, `/api/waiver-wire/leagues/${leagueId}/claims`, { method: 'POST', body: { addPlayerId: fa.id, dropPlayerId: drop.playerId, faabBid: 1 } }, { leagueId })
    const pending = (rowsOf(env.db, 'WaiverClaim') as any[]).some((c) => c.leagueId === leagueId && String(c.addPlayerId) === fa.id && c.status === 'pending')
    S.freeAgent.claim = { status: claim.status, error: (claim.body as any)?.error ?? null, pending }
    if (claim.status >= 300 || !pending) ctx.add({ code: 'FREE_AGENT_CLAIM_REFUSED', stage: 'season', message: `The add needs a waiver claim here, and the claim was refused: ${claim.status} ${JSON.stringify(claim.body).slice(0, 200)}` })
  } else if (res.status !== 200) ctx.add({ code: 'FREE_AGENT_ADD_REFUSED', stage: 'season', message: `${res.status} ${JSON.stringify(res.body).slice(0, 200)}` })
  else if (!on || stillHasDrop) ctx.add({ code: 'FREE_AGENT_ADD_NOT_ON_SEASON_ROSTER', stage: 'season', message: `Add/drop returned 200; season roster added=${on} dropped=${!stillHasDrop}.` })
}

// ── Tanking: scan, the commissioner's confirmation, the penalty ───────────────

async function tanking(env: SimEnv, run: LeagueRun, ctx: WeekCtx, S: Record<string, any>) {
  const leagueId = run.leagueId!
  const T = (S.tanking ??= { weeks: [] as any[] })
  if (ctx.week === 5) {
    signInAs(env, run.commissionerId)
    const integrity = await import('@/app/api/leagues/[leagueId]/integrity/handler')
    const put = await call(integrity.PUT, `/api/leagues/${leagueId}/integrity`, { method: 'PUT', body: { tankingPenalties: { penalty: 'faab', faabPercent: 25, pickAtStrike: 2 } } }, { leagueId })
    T.policySwitch = { status: put.status, error: (put.body as any)?.error ?? null }
  }
  const tanker = tankerFor(env, run, ctx.week)
  const { enqueueTankingScan } = await import('@/lib/integrity/enqueueTankingScan')
  await enqueueTankingScan(leagueId, ctx.week, ctx.seasonId)
  // The scan's own account of the week, for when it flags nothing.
  const { scanWeekForTanking } = await import('@/lib/integrity/TankingDetectionEngine')
  const direct = await scanWeekForTanking(leagueId, ctx.week, ctx.seasonId).catch((e: Error) => ({ threw: e.message }))
  const flags = (rowsOf(env.db, 'IntegrityFlag') as any[]).filter((f) => f.leagueId === leagueId && f.flagType === 'tanking')
  const open = flags.filter((f) => f.status === 'open')
  const tankerFlag = tanker ? open.find((f) => (f.affectedRosterIds ?? []).includes(tanker.seasonRosterId)) : null
  const week: any = { week: ctx.week, tanker: tanker?.userId ?? null, scan: JSON.stringify(direct).slice(0, 500), openFlags: open.map((f) => ({ rosters: f.affectedRosterIds, severity: f.severity })) }
  const faabBefore = tanker ? (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === tanker.rosterId)?.faabRemaining ?? null : null
  if (tanker && !tankerFlag) ctx.add({ code: 'TANKING_NOT_FLAGGED', stage: 'season', message: `Week ${ctx.week}: ${tanker.userId} started 3 injured players over a healthy bench; no open tanking flag.` })
  for (const f of open) {
    const innocent = !tanker || !(f.affectedRosterIds ?? []).includes(tanker.seasonRosterId)
    if (innocent) ctx.add({ code: 'TANKING_FLAG_ON_INNOCENT_TEAM', stage: 'season', message: `Week ${ctx.week}: tanking flag on ${JSON.stringify(f.affectedRosterIds)}, who did not tank.` })
  }
  if (tankerFlag) {
    signInAs(env, run.commissionerId)
    const route = await import('@/app/api/leagues/[leagueId]/integrity/flags/[flagId]/route')
    const res = await call(route.PATCH, `/api/leagues/${leagueId}/integrity/flags/${tankerFlag.id}`, { method: 'PATCH', body: { status: 'escalated', commissionerNote: 'Confirmed: injured starters over a healthy bench.' } }, { leagueId, flagId: tankerFlag.id })
    week.confirm = { status: res.status, penalties: JSON.stringify((res.body as any)?.penalties ?? null).slice(0, 300), error: (res.body as any)?.error ?? null }
    if (res.status !== 200) ctx.add({ code: 'TANKING_CONFIRM_REFUSED', stage: 'season', message: `Confirming the week-${ctx.week} tanking flag returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}` })
  }
  if (tanker) {
    const picks = (rowsOf(env.db, 'FutureDraftPick') as any[]).filter((p) => p.leagueId === leagueId && (p.originalRosterId === tanker.rosterId || p.currentOwnerId === tanker.rosterId))
    week.forfeited = picks.filter((p) => p.status === 'forfeited').map((p) => `${p.pickSeason}:${p.round}:${p.originalRosterId}`)
    week.faab = { before: faabBefore, after: (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === tanker.rosterId)?.faabRemaining ?? null, season: seasonRoster(env, tanker.seasonRosterId)?.faabBalance ?? null }
  }
  T.weeks.push(week)
  // Restore the tanker's starters for the next week.
  if (tanker) for (const p of holdings(env, tanker.seasonRosterId).filter((x) => x.injuryStatus === 'Out')) await env.db.redraftRosterPlayer.update({ where: { id: p.id }, data: { injuryStatus: null } })
}

/** After the regular season: did each tanker get exactly the consequence the policy promised? */
export function checkTankingConsequences(env: SimEnv, run: LeagueRun, add: Add): void {
  const T = (run.stats.scenarios as any)?.tanking
  if (!T) return
  const a = T.weeks.filter((w: any) => w.tanker === 'sim-mgr-011')
  const b = T.weeks.filter((w: any) => w.tanker === 'sim-mgr-012')
  const aForfeited = a.at(-1)?.forfeited ?? []
  if (a.filter((w: any) => w.confirm?.status === 200).length >= 2 && aForfeited.length === 0) add({ code: 'TANKING_PICK_NOT_FORFEITED', stage: 'season', message: `sim-mgr-011 has ${a.length} confirmed strikes under "forfeit a 1st at strike 2"; no pick is forfeited.` })
  const bConfirmed = b.filter((w: any) => w.confirm?.status === 200).length
  const bFaab = b.at(-1)?.faab
  if (bConfirmed >= 2 && bFaab && b[0]?.faab?.before != null && bFaab.after === b[0].faab.before) add({ code: 'TANKING_FAAB_NOT_TAKEN', stage: 'season', message: `sim-mgr-012 has ${bConfirmed} confirmed strikes under "take 25% FAAB at strike 2"; FAAB is unchanged at ${bFaab.after}.` })
  if (bFaab && bFaab.after != null && bFaab.season != null && bFaab.after !== bFaab.season) add({ code: 'TANKING_FAAB_MIRRORS_DISAGREE', stage: 'season', message: `After the FAAB penalty: league roster ${bFaab.after}, season roster ${bFaab.season}.` })
}

// ── Collusion consequences (after the week-6 trades) ──────────────────────────

export async function collusionConsequences(env: SimEnv, run: LeagueRun, ctx: WeekCtx): Promise<void> {
  const leagueId = run.leagueId!
  const S = (run.stats.scenarios ??= {}) as Record<string, any>
  const C: any = (S.collusion = {})
  const trades = ((run.stats.trades as any[]) ?? [])
  const flags = (rowsOf(env.db, 'IntegrityFlag') as any[]).filter((f) => f.leagueId === leagueId && f.flagType === 'collusion')
  C.flags = flags.map((f) => ({ trade: f.tradeTransactionId, severity: f.severity, status: f.status }))
  // A 4th star-for-scrub deal between the SAME pair as the three lopsided ones, under "hold severe".
  const firstId = trades.find((x: any) => x.label === 'collusion-1' && x.ok)?.tradeId
  const firstRow = (rowsOf(env.db, 'AfLeagueTrade') as any[]).find((t) => t.id === firstId)
  if (!firstRow) {
    C.skipped = 'no completed collusion-1 trade'
    return
  }
  const all = seats(env, run)
  const c = all.find((x) => x.rosterId === firstRow.proposerRosterId)!
  const d = all.find((x) => x.rosterId === firstRow.receiverRosterId)!
  const { createAfLeagueTrade, acceptAfLeagueTrade } = await import('@/lib/league-trade-engine/tradeService')
  const stud = holdings(env, c.seasonRosterId).filter((p) => isStarter(p.slotType)).sort((x, y) => Number(/-(\d+)$/.exec(String(x.playerId))?.[1] ?? 99) - Number(/-(\d+)$/.exec(String(y.playerId))?.[1] ?? 99))[0]
  const scrub = holdings(env, d.seasonRosterId).filter((p) => !isStarter(p.slotType)).sort((x, y) => Number(/-(\d+)$/.exec(String(y.playerId))?.[1] ?? 0) - Number(/-(\d+)$/.exec(String(x.playerId))?.[1] ?? 0))[0]
  // The hold only matters where trades would otherwise go through: switch the league to instant review.
  const leagueRow = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === leagueId)
  const priorMode = (leagueRow.settings as any)?.trade_review_mode ?? null
  await env.db.league.update({ where: { id: leagueId }, data: { settings: { ...(leagueRow.settings ?? {}), trade_review_mode: 'instant' } } })
  if (stud && scrub) {
    try {
      signInAs(env, c.userId)
      const created = await createAfLeagueTrade({ leagueId, proposedByUserId: c.userId, proposerRosterId: c.rosterId, receiverRosterId: d.rosterId, assets: [
        { itemType: 'player', itemReference: stud.playerId, fromRosterId: c.rosterId, toRosterId: d.rosterId, metadata: { playerName: stud.playerName, position: stud.position } },
        { itemType: 'player', itemReference: scrub.playerId, fromRosterId: d.rosterId, toRosterId: c.rosterId, metadata: { playerName: scrub.playerName, position: scrub.position } },
      ] } as any)
      signInAs(env, d.userId)
      const accepted = await acceptAfLeagueTrade({ tradeId: created.id, userId: d.userId, leagueId } as any)
      const row = (rowsOf(env.db, 'AfLeagueTrade') as any[]).find((t) => t.id === created.id)
      // Under instant review a held trade waits for the commissioner instead of processing.
      C.fourth = { reviewMode: 'instant', acceptStatus: accepted.status, status: row?.status, held: row?.status !== 'processed' }
      if (!C.fourth.held) ctx.add({ code: 'SEVERE_COLLUSION_TRADE_NOT_HELD', stage: 'season', message: `"Hold severe" is on, the league reviews instantly, and a 4th lopsided deal between a flagged pair processed (${accepted.status}).` })
    } catch (e) {
      C.fourth = { threw: (e as Error).message }
    }
  }
  const after = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === leagueId)
  await env.db.league.update({ where: { id: leagueId }, data: { settings: { ...(after.settings ?? {}), trade_review_mode: priorMode } } })
  // The commissioner reverses the LATEST processed lopsided deal: an earlier one is refused by design
  // once those rosters have traded again (ROSTER_CHANGED_SINCE_EXECUTION) — recorded separately below.
  const lopsidedIds = trades.filter((x: any) => String(x.label).startsWith('collusion') && x.ok).map((x: any) => x.tradeId)
  const lopsidedRows = (rowsOf(env.db, 'AfLeagueTrade') as any[]).filter((t) => lopsidedIds.includes(t.id) && t.status === 'processed')
  // The last one in the order the deals were made. `processedAt` is a Date and the deals settle in the
  // same second, so sorting on it as text picked the FIRST deal, whose rosters the later two had changed.
  const target = lopsidedIds.map((id: string) => lopsidedRows.find((t) => t.id === id)).filter(Boolean).at(-1) ?? null
  if (target) {
    signInAs(env, run.commissionerId)
    const route = await import('@/app/api/leagues/[leagueId]/trades/[tradeId]/process/route')
    const res = await call(route.POST, `/api/leagues/${leagueId}/trades/${target.id}/process`, { method: 'POST', body: { action: 'reverse', reason: 'Collusion: repeated lopsided trades between one pair.' } }, { leagueId, tradeId: target.id })
    const items = (rowsOf(env.db, 'AfLeagueTradeItem') as any[]).filter((i) => i.tradeId === target.id && i.itemType === 'player')
    const back = items.map((i) => {
      const holders = (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => String(p.playerId) === String(i.itemReference) && !p.droppedAt).map((p) => p.rosterId)
      const origin = seats(env, run).find((s) => s.rosterId === i.fromRosterId)?.seasonRosterId
      return { player: i.itemReference, backHome: holders.length === 1 && holders[0] === origin }
    })
    C.reversal = { status: res.status, error: (res.body as any)?.error ?? null, tradeStatus: (rowsOf(env.db, 'AfLeagueTrade') as any[]).find((t) => t.id === target.id)?.status, back }
    if (res.status !== 200) {
      const readiness = (res.body as any)?.readiness
      const drift = ((readiness?.drift ?? []) as Array<{ rosterId: string; expected: string; actual: string }>).map((d) => {
        const e = JSON.parse(d.expected) as { ids: string[]; faab: number }
        const a = JSON.parse(d.actual) as { ids: string[]; faab: number }
        return { rosterId: d.rosterId, faab: e.faab === a.faab ? null : `${e.faab} -> ${a.faab}`, left: e.ids.filter((x) => !a.ids.includes(x)), joined: a.ids.filter((x) => !e.ids.includes(x)) }
      })
      C.reversal.drift = drift
      ctx.add({ code: 'COLLUSION_REVERSAL_REFUSED', stage: 'season', message: `Reversing a lopsided trade returned ${res.status} (${(readiness?.blockers ?? []).join(', ') || (res.body as any)?.error}); since the trade: ${JSON.stringify(drift)}` })
    }
    else if (back.some((b) => !b.backHome)) ctx.add({ code: 'REVERSED_TRADE_PLAYERS_NOT_RETURNED', stage: 'season', message: `Reversal returned 200; players back home: ${JSON.stringify(back)}` })
  }
}

/** A 2027 2nd from the 9th team to the 10th — the 9th team's manager is then replaced (week 8). */
export async function secondRoundPickTrade(env: SimEnv, run: LeagueRun, ctx: WeekCtx): Promise<void> {
  const leagueId = run.leagueId!
  const all = seats(env, run)
  if (tooFewSeats(all, 10, (run.stats.scenarios ??= {}) as Record<string, any>, '2nd-round pick trade')) return
  const [e, f] = [all[8]!, all[9]!]
  const pe = holdings(env, e.seasonRosterId).filter((p) => !isStarter(p.slotType))[0]
  const pf = holdings(env, f.seasonRosterId).filter((p) => !isStarter(p.slotType))[0]
  if (!pe || !pf) return
  const { createAfLeagueTrade, acceptAfLeagueTrade, commissionerAfTradeDecision } = await import('@/lib/league-trade-engine/tradeService')
  const year = Number((rowsOf(env.db, 'RedraftSeason') as any[]).find((s) => s.id === ctx.seasonId)?.season ?? 2026) + 1
  const pickId = `fdp:${year}:2:${e.rosterId}`
  const S = (run.stats.scenarios ??= {}) as Record<string, any>
  try {
    signInAs(env, e.userId)
    const t = await createAfLeagueTrade({ leagueId, proposedByUserId: e.userId, proposerRosterId: e.rosterId, receiverRosterId: f.rosterId, assets: [
      { itemType: 'future_pick', itemReference: pickId, fromRosterId: e.rosterId, toRosterId: f.rosterId, metadata: { season: year, round: 2 } },
      { itemType: 'player', itemReference: pe.playerId, fromRosterId: e.rosterId, toRosterId: f.rosterId, metadata: { playerName: pe.playerName, position: pe.position } },
      { itemType: 'player', itemReference: pf.playerId, fromRosterId: f.rosterId, toRosterId: e.rosterId, metadata: { playerName: pf.playerName, position: pf.position } },
    ] } as any)
    signInAs(env, f.userId)
    const acc = await acceptAfLeagueTrade({ tradeId: t.id, userId: f.userId, leagueId } as any)
    if (acc.status === 'awaiting_commissioner' || acc.status === 'held_for_review') {
      signInAs(env, run.commissionerId)
      await commissionerAfTradeDecision({ tradeId: t.id, leagueId, userId: run.commissionerId, decision: 'approve' } as any)
    }
    const fdp = (rowsOf(env.db, 'FutureDraftPick') as any[]).find((p) => p.leagueId === leagueId && p.pickSeason === year && p.round === 2 && p.originalRosterId === e.rosterId)
    S.secondRoundPick = { pickId, from: e.rosterId, to: f.rosterId, owner: fdp?.currentOwnerId ?? null, status: fdp?.status ?? null }
    if (fdp?.currentOwnerId !== f.rosterId) ctx.add({ code: 'FUTURE_PICK_OWNER_NOT_RECORDED', stage: 'season', message: `${pickId} traded to ${f.rosterId}; FutureDraftPick owner is ${fdp?.currentOwnerId ?? 'missing'}.` })
  } catch (err) {
    S.secondRoundPick = { pickId, failed: (err as Error).message }
    ctx.add({ code: 'SECOND_ROUND_PICK_TRADE_FAILED', stage: 'season', message: (err as Error).message })
  }
}

// ── League health and the commissioner hub ────────────────────────────────────

async function leagueHealth(env: SimEnv, run: LeagueRun, ctx: WeekCtx, S: Record<string, any>) {
  const leagueId = run.leagueId!
  const idle = seats(env, run).find((s) => s.userId === 'sim-mgr-008')
  const longAgo = new Date(Date.now() - 20 * 86_400_000)
  if (idle) await env.db.roster.update({ where: { id: idle.rosterId }, data: { updatedAt: longAgo } })
  const H: any = (S.health = {})
  try {
    const { getLeagueManagerHealth } = await import('@/lib/commissioner-hub/managerHealth')
    const mh: any = await getLeagueManagerHealth(leagueId)
    H.managerHealth = { total: mh?.totalManagers, inactive: mh?.inactiveCount, atRisk: mh?.atRiskCount, idleRow: mh?.rows?.find((r: any) => r.rosterId === idle?.rosterId || r.userId === idle?.userId) ?? null }
    if (idle && !(mh?.rows ?? []).some((r: any) => (r.rosterId === idle.rosterId || r.userId === idle.userId) && /inactive/i.test(String(r.status)))) {
      ctx.add({ code: 'INACTIVE_MANAGER_NOT_DETECTED', stage: 'season', message: `sim-mgr-008 last acted 20 days ago; manager health says ${JSON.stringify(H.managerHealth.idleRow).slice(0, 200)}.` })
    }
  } catch (e) {
    H.managerHealthThrew = (e as Error).message
  }
  try {
    const { getCommissionerHub } = await import('@/lib/core-app/commissionerHub')
    const hub: any = await (getCommissionerHub as any)({ leagueId, userId: run.commissionerId, issues: [], now: new Date() })
    const text = JSON.stringify(hub ?? null)
    H.hub = { keys: hub ? Object.keys(hub).slice(0, 15) : null, mentionsIntegrity: /integrity|collusion|tanking/i.test(text), mentionsInactive: /inactive|idle|abandon/i.test(text), size: text.length, sample: text.slice(0, 600) }
    const openFlags = (rowsOf(env.db, 'IntegrityFlag') as any[]).filter((f) => f.leagueId === leagueId && f.status === 'open').length
    if (openFlags && !H.hub.mentionsIntegrity) ctx.add({ code: 'HUB_HIDES_INTEGRITY_FLAGS', stage: 'season', message: `${openFlags} open integrity flag(s); the commissioner hub mentions none.` })
    if (idle && !H.hub.mentionsInactive) ctx.add({ code: 'HUB_HIDES_INACTIVE_MANAGER', stage: 'season', message: 'A manager idle 20 days; the commissioner hub does not mention inactivity.' })
  } catch (e) {
    H.hubThrew = (e as Error).message
    ctx.add({ code: 'COMMISSIONER_HUB_THREW', stage: 'season', message: (e as Error).message })
  }
}

// ── A manager leaves; another takes the team ──────────────────────────────────

export async function takeover(env: SimEnv, run: LeagueRun, ctx: WeekCtx | { add: Add; seasonId: string; week: number }, S: Record<string, any>, when: 'midseason' | 'offseason'): Promise<void> {
  const leagueId = run.leagueId!
  const leaver = when === 'midseason' ? 'sim-mgr-009' : 'sim-mgr-005'
  const newcomer = when === 'midseason' ? 'sim-new-009' : 'sim-new-005'
  const seat = seats(env, run).find((s) => s.userId === leaver)
  const R: any = ((S.takeover ??= {})[when] = { leaver, newcomer })
  if (!seat) {
    R.skipped = 'leaver holds no seat'
    return
  }
  const before = {
    seasonRosters: (rowsOf(env.db, 'RedraftRoster') as any[]).filter((r) => r.leagueId === leagueId && r.ownerId === leaver).map((r) => ({ id: r.id, w: r.wins, l: r.losses, faab: r.faabBalance })),
    picks: (rowsOf(env.db, 'FutureDraftPick') as any[]).filter((p) => p.leagueId === leagueId && p.currentOwnerId === seat.rosterId).map((p) => `${p.pickSeason}:${p.round}:${p.originalRosterId}`),
    players: holdings(env, seat.seasonRosterId).length,
  }
  R.before = before
  signInAs(env, run.commissionerId)
  const managers = await import('@/app/api/commissioner/leagues/[leagueId]/managers/route')
  const del = await call(managers.DELETE, `/api/commissioner/leagues/${leagueId}/managers?rosterId=${seat.rosterId}`, { method: 'DELETE' }, { leagueId })
  const afterLeave = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === seat.rosterId)
  R.remove = { status: del.status, error: (del.body as any)?.error ?? null, rosterOwner: afterLeave?.platformUserId }
  if (del.status !== 200) {
    ctx.add({ code: 'MANAGER_REMOVAL_REFUSED', stage: when === 'midseason' ? 'season' : 'offseason', message: `${del.status} ${JSON.stringify(del.body).slice(0, 200)}` })
    return
  }
  // A new manager joins with the league's invite code.
  const league = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === leagueId)
  const code = String((league.settings as any)?.inviteCode ?? '')
  await env.db.appUser.upsert({ where: { id: newcomer }, create: { id: newcomer, email: `${newcomer}@sim.allfantasy.test`, username: newcomer }, update: {} })
  signInAs(env, newcomer)
  const join = await import('@/app/api/leagues/join/route')
  const joined = await call(join.POST, '/api/leagues/join', { method: 'POST', body: { code } })
  const rosterAfter = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === seat.rosterId)
  const team = (rowsOf(env.db, 'LeagueTeam') as any[]).find((t) => t.leagueId === leagueId && (t.claimedByUserId === newcomer || t.platformUserId === newcomer))
  const seasonsNow = (rowsOf(env.db, 'RedraftRoster') as any[]).filter((r) => before.seasonRosters.some((b) => b.id === r.id))
  R.join = { status: joined.status, error: (joined.body as any)?.error ?? null, rosterOwner: rosterAfter?.platformUserId, teamClaimedBy: team?.claimedByUserId ?? null, teamIsOrphan: team?.isOrphan ?? null }
  R.after = {
    seasonRosters: seasonsNow.map((r) => ({ id: r.id, owner: r.ownerId, w: r.wins, l: r.losses, faab: r.faabBalance })),
    picks: (rowsOf(env.db, 'FutureDraftPick') as any[]).filter((p) => p.leagueId === leagueId && p.currentOwnerId === seat.rosterId).map((p) => `${p.pickSeason}:${p.round}:${p.originalRosterId}`),
    players: holdings(env, seat.seasonRosterId).length,
  }
  const stage = when === 'midseason' ? 'season' : 'offseason'
  if (joined.status !== 200) ctx.add({ code: 'TAKEOVER_JOIN_REFUSED', stage, message: `${newcomer} could not join: ${joined.status} ${JSON.stringify(joined.body).slice(0, 200)}` })
  else {
    if (rosterAfter?.platformUserId !== newcomer) ctx.add({ code: 'TAKEOVER_ROSTER_NOT_CLAIMED', stage, message: `${newcomer} joined; the open team is owned by ${rosterAfter?.platformUserId}.` })
    if (seasonsNow.some((r) => r.ownerId !== newcomer)) ctx.add({ code: 'TAKEOVER_SEASON_ROSTER_NOT_MOVED', stage, message: `Season rosters after the takeover are owned by ${seasonsNow.map((r) => r.ownerId).join(', ')}.` })
    if (!team || team.isOrphan) ctx.add({ code: 'TAKEOVER_TEAM_STILL_ORPHAN', stage, message: `LeagueTeam after takeover: ${JSON.stringify(R.join)}` })
    for (const b of before.seasonRosters) {
      const a = R.after.seasonRosters.find((x: any) => x.id === b.id)
      if (a && (a.w !== b.w || a.l !== b.l || a.faab !== b.faab)) ctx.add({ code: 'TAKEOVER_LOST_RECORD_OR_FAAB', stage, message: `${b.id}: ${b.w}-${b.l} $${b.faab} → ${a.w}-${a.l} $${a.faab}.` })
    }
    if (before.picks.join() !== R.after.picks.join()) ctx.add({ code: 'TAKEOVER_LOST_FUTURE_PICKS', stage, message: `Picks before ${before.picks.join(', ')}; after ${R.after.picks.join(', ')}.` })
    if (before.players !== R.after.players) ctx.add({ code: 'TAKEOVER_LOST_PLAYERS', stage, message: `${before.players} players before, ${R.after.players} after.` })
  }

  // Mid-season only: a manager who was removed comes BACK (the name-match claim path).
  if (when === 'midseason') {
    const returning = seats(env, run).find((s) => s.userId === 'sim-mgr-010')
    if (!returning) return
    signInAs(env, run.commissionerId)
    const del2 = await call(managers.DELETE, `/api/commissioner/leagues/${leagueId}/managers?rosterId=${returning.rosterId}`, { method: 'DELETE' }, { leagueId })
    signInAs(env, 'sim-mgr-010')
    const back = await call(join.POST, '/api/leagues/join', { method: 'POST', body: { code } })
    const r2 = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === returning.rosterId)
    const t2 = (rowsOf(env.db, 'LeagueTeam') as any[]).find((t) => t.leagueId === leagueId && (t.claimedByUserId === 'sim-mgr-010' || t.platformUserId === 'sim-mgr-010' || t.platformUserId === `orphan-${returning.rosterId}`))
    const s2 = seasonRoster(env, returning.seasonRosterId)
    R.returning = { remove: del2.status, join: back.status, joinError: (back.body as any)?.error ?? null, rosterOwner: r2?.platformUserId, teamClaimedBy: t2?.claimedByUserId ?? null, teamIsOrphan: t2?.isOrphan ?? null, seasonOwner: s2?.ownerId ?? null }
    if (back.status === 200 && (s2?.ownerId !== 'sim-mgr-010' || t2?.isOrphan || t2?.claimedByUserId !== 'sim-mgr-010')) {
      ctx.add({ code: 'RETURNING_MANAGER_GETS_PART_OF_THE_SEAT', stage: 'season', message: `A removed manager rejoined and owns the league roster (${r2?.platformUserId}), but the season roster is ${s2?.ownerId} and the team is orphan=${t2?.isOrphan}, claimedBy=${t2?.claimedByUserId}.` })
    }
  }
}

// ── Chimmy's deterministic tools, mid-season ──────────────────────────────────

async function chimmySweep(env: SimEnv, run: LeagueRun, ctx: WeekCtx, S: Record<string, any>) {
  const { executeChimmyTool } = await import('@/lib/chimmy/tools/chimmyTools')
  const me = seats(env, run).find((s) => s.userId === 'sim-mgr-003')!
  const mine = holdings(env, me.seasonRosterId)
  const other = seats(env, run).find((s) => s.userId === 'sim-mgr-004')!
  const theirs = holdings(env, other.seasonRosterId)
  const rostered = new Set((rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => !p.droppedAt).map((p) => String(p.playerId)))
  const fa = (rowsOf(env.db, 'SportsPlayer') as any[]).find((p) => p.sport === run.sport && /^sim-/.test(String(p.id)) && !rostered.has(String(p.id)))
  const myBench = mine.find((p) => !isStarter(p.slotType))
  const ctxTool = { leagueId: run.leagueId, userId: me.userId } as any
  const out: Record<string, string> = {}
  for (const [name, args] of [
    ['get_my_roster', {}],
    ['get_league_standings', {}],
    ['get_my_matchup', {}],
    ['optimize_my_lineup', {}],
    ['get_available_players', {}],
    ['get_faab_bid_plan', {}],
    ['evaluate_waiver_move', { add: fa?.name, drop: myBench?.playerName }],
    ['get_waiver_status', {}],
    ['get_playoff_outlook', {}],
    ['find_trade_ideas', {}],
    ['evaluate_trade', { give: [mine[0]?.playerName].filter(Boolean), get: [theirs[0]?.playerName].filter(Boolean) }],
    ['evaluate_trade', { give: ['2027 1st'], get: [theirs[1]?.playerName].filter(Boolean) }],
    ['get_league_trade_history', {}],
    ['get_trade_block', {}],
  ] as const) {
    const key = out[name] ? `${name}#2` : name
    try {
      out[key] = String(await executeChimmyTool(name, args as any, ctxTool)).slice(0, 700)
    } catch (e) {
      out[key] = `THREW ${(e as Error).message}`
      ctx.add({ code: 'CHIMMY_TOOL_THREW', stage: 'season', message: `${name}: ${(e as Error).message}` })
    }
  }
  S.chimmy = out
  const refusal = /could not be read|no verified data|not available|cannot|can't|unavailable|no .* on file|could not/i
  S.chimmyRefusals = Object.entries(out).filter(([, v]) => refusal.test(v.slice(0, 220))).map(([k, v]) => `${k}: ${v.slice(0, 160)}`)
}

// ── The rookie order: the commissioner's live setting, then the automatic order ──

async function setLiveRookieOrder(env: SimEnv, run: LeagueRun, S: Record<string, any>) {
  signInAs(env, run.commissionerId)
  const route = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/live/route')
  const res = await call(route.PUT, `/api/commissioner/leagues/${run.leagueId}/rookie-draft-order/live`, { method: 'PUT', body: { enabled: true, config: { nonPlayoff: 'reverse_max_pf', playoff: 'finish_then_seed', withinRound: 'worse_seed' } } }, { leagueId: run.leagueId! })
  S.liveRookieOrder = { status: res.status, error: (res.body as any)?.error ?? null, saved: JSON.stringify((res.body as any)?.settings ?? (res.body as any) ?? null).slice(0, 300) }
  if (res.status !== 200) run.findings.push({ code: 'ROOKIE_ORDER_SCREEN_SAVE_FAILED', stage: 'season', message: `Saving the commissioner's rookie order rule returned ${res.status}: ${(res.body as any)?.error ?? ''}` })
}

/** The rookie order preview, as a member opens it (free: any member may see the order). */
export async function readRookiePreview(env: SimEnv, run: LeagueRun, userId: string): Promise<{ status: number; slots: number; error: string | null }> {
  signInAs(env, userId)
  const route = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/route')
  const res = await call(route.GET, `/api/commissioner/leagues/${run.leagueId}/rookie-draft-order`, null, { leagueId: run.leagueId! })
  return { status: res.status, slots: ((res.body as any)?.slots ?? []).length, error: (res.body as any)?.error ?? null }
}

/**
 * The commissioner's rule applied to the facts the engine itself loads (`loadRookieOrderInput`: each
 * team's Max PF and seed, and the playoff games): non-playoff teams by Max PF ascending, then playoff
 * teams knocked out earliest first (worse seed first within a round), then the runner-up, then the
 * champion. Independent of the engine's ordering code — only its facts are shared.
 */
export function expectedOrderFromFacts(input: any): { order: string[]; detail: Record<string, unknown> } {
  const teams: any[] = input?.teams ?? input?.input?.teams ?? []
  const games: any[] = input?.playoffGames ?? input?.input?.playoffGames ?? []
  const champGames = games.filter((g) => g.kind === 'championship' && g.winner)
  const finalRound = Math.max(0, ...champGames.map((g) => Number(g.round)))
  const final = champGames.find((g) => Number(g.round) === finalRound)
  const champion = final?.winner ?? null
  const runnerUp = final ? (final.teamA === champion ? final.teamB : final.teamA) : null
  const exitRound = new Map<string, number>()
  for (const g of champGames) {
    const loser = g.teamA === g.winner ? g.teamB : g.teamA
    if (loser && !exitRound.has(loser)) exitRound.set(loser, Number(g.round))
  }
  const nonPlayoff = teams.filter((t) => t.playoffSeed == null).sort((a, b) => (Number(a.maxPf ?? a.pointsFor) - Number(b.maxPf ?? b.pointsFor)) || (a.pointsFor - b.pointsFor))
  const out = teams.filter((t) => t.playoffSeed != null && t.teamId !== champion && t.teamId !== runnerUp)
    .sort((a, b) => ((exitRound.get(a.teamId) ?? 99) - (exitRound.get(b.teamId) ?? 99)) || (Number(b.playoffSeed) - Number(a.playoffSeed)))
  // A lower bracket that plays for the pick seats the team it decided first; the rest keep their order.
  // A consolation bracket's winner, or a toilet bowl's final loser (its winner with `pickGoesTo: 'winner'`).
  const lower = input?.lowerBracket ?? input?.input?.lowerBracket ?? null
  let lowerFirst: string | null = null
  if (lower?.playsForPick && Array.isArray(lower.finishOrder)) {
    const ids = new Set(nonPlayoff.map((t) => t.teamId))
    const named = (lower.finishOrder as string[]).filter((id) => ids.has(id))
    lowerFirst = lower.mode !== 'toilet_bowl' ? named[0] ?? null
      : lower.pickGoesTo === 'winner' ? lower.final?.winner ?? named.at(-2) ?? null
        : lower.final?.loser ?? named.at(-1) ?? null
    const i = nonPlayoff.findIndex((t) => t.teamId === lowerFirst)
    if (i > 0) nonPlayoff.unshift(...nonPlayoff.splice(i, 1))
  }
  const order = [...nonPlayoff.map((t) => t.teamId), ...out.map((t) => t.teamId), ...(runnerUp ? [runnerUp] : []), ...(champion ? [champion] : [])]
  return {
    order,
    detail: {
      champion,
      runnerUp,
      maxPfMissing: teams.filter((t) => t.maxPf == null).length,
      placementGames: games.filter((g) => g.kind === 'placement').length,
      lowerBracket: lower ? { mode: lower.mode, playsForPick: lower.playsForPick, pickGoesTo: lower.pickGoesTo ?? null, picksFirst: lowerFirst } : null,
      teams: teams.map((t) => ({ id: t.teamId, seed: t.playoffSeed, maxPf: t.maxPf, pf: t.pointsFor, exit: exitRound.get(t.teamId) ?? null })),
    },
  }
}

/** The commissioner's live rookie-order screen after the season: the engine's own slots and reasons. */
export async function readLiveRookieView(env: SimEnv, run: LeagueRun): Promise<unknown> {
  signInAs(env, run.commissionerId)
  const route = await import('@/app/api/commissioner/leagues/[leagueId]/rookie-draft-order/live/route')
  const res = await call(route.GET, `/api/commissioner/leagues/${run.leagueId}/rookie-draft-order/live`, null, { leagueId: run.leagueId! })
  const result = (res.body as any)?.result
  return { status: res.status, phase: result?.phase, maxPfSource: result?.maxPfSource, warnings: result?.warnings, slots: (result?.slots ?? []).map((x: any) => ({ slot: x.slot, team: x.teamId, group: x.group, finish: x.finish, reason: x.reason })) }
}
