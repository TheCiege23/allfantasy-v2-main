/**
 * Dynasty league simulation harness — drives a league through the app's REAL code paths, start to draft:
 *
 *   wizard state → submitCreateLeagueV2 (the form's own submit) → POST /api/leagues (real handler)
 *   → managers sign in and POST /api/leagues/join with the invite link's code
 *   → startDraftSession → picks through submitPick / auction engine / autopick / offline entry
 *   → completeDraftSession → finalization into an active season
 *
 * Runs against the DMMF in-memory Prisma. The calling test owns the vi.mock block (Prisma, auth, Meta CAPI,
 * notifications, locks) because vitest only hoists mocks from the test file; see dynasty-sim.test.ts.
 *
 * Every check here compares the engine against something the harness owns — its own expected pick order,
 * its own record of who drafted whom, the roster template the draft itself published — never one engine
 * field against another field of the same output.
 */
import type { InMemoryPrisma } from '../redraft-season-simulation/inMemoryPrisma'
import { rowsOf } from '../redraft-season-simulation/inMemoryPrisma'

export type DynastySport = 'NFL' | 'NBA' | 'NHL' | 'MLB'
export type StartupDraftKind = 'snake' | 'snake_3rr' | 'linear' | 'auction' | 'auto' | 'offline'

export type SimEnv = {
  db: InMemoryPrisma
  signIn: (user: { id: string; email: string; name: string } | null) => void
}

export type Finding = {
  /** Stable id, e.g. `DRAFT_PICK_REFUSED`. */
  code: string
  stage: 'create' | 'join' | 'draft' | 'finalize'
  message: string
  detail?: Record<string, unknown>
}

export type LeagueRun = {
  sport: DynastySport
  teamCount: number
  draft: StartupDraftKind
  leagueId: string | null
  commissionerId: string
  managerIds: string[]
  rounds: number
  findings: Finding[]
  stats: Record<string, unknown>
}

const COMMISH = { id: 'sim-commish', email: 'commish@sim.allfantasy.test', name: 'Sim Commish' }
const userFor = (i: number) => {
  const id = `sim-mgr-${String(i).padStart(3, '0')}`
  return { id, email: `${id}@sim.allfantasy.test`, name: id }
}

/** Starter positions a team in this league must field, from the roster template the DRAFT enforces. */
type EnforcedRoster = {
  templateId: string
  totalSlots: number
  draftable: string[]
  /** Fixed single-position starter needs, e.g. { QB: 1, RB: 2 }. */
  need: Record<string, number>
}

async function enforcedRoster(leagueId: string): Promise<EnforcedRoster> {
  const { getLeagueDraftTemplatePayload } = await import('@/lib/league/league-draft-template-payload')
  const payload = (await getLeagueDraftTemplatePayload(leagueId)) as any
  const slots = (payload.template?.slots ?? []) as Array<{ starterCount: number; allowedPositions: string[] }>
  const draftable = [...new Set(slots.flatMap((s) => (s.starterCount > 0 ? s.allowedPositions : [])))]
  const need: Record<string, number> = {}
  for (const s of slots) if (s.starterCount > 0 && s.allowedPositions.length === 1) need[s.allowedPositions[0]!] = (need[s.allowedPositions[0]!] ?? 0) + s.starterCount
  return { templateId: String(payload.template?.templateId ?? ''), totalSlots: Number(payload.totalRosterSlots ?? 0), draftable, need }
}

/**
 * The wizard clamps playoff teams to the league size whenever the size changes — mirrored from the
 * component-local `fitDynastySetupToTeamCount` in components/create-league-v2/CreateLeagueWizard.tsx
 * (not exported). Without it a 4-team dynasty keeps the 6-team playoff default and the form blocks it,
 * which the real UI never shows a manager.
 */
function fitDynastySetupToTeamCount<T extends { playoffTeamCount: number; playoffByeCount: number }>(setup: T, teamCount: number): T {
  const playoffTeamCount = Math.min(setup.playoffTeamCount, Math.max(2, teamCount))
  return { ...setup, playoffTeamCount, playoffByeCount: 2 ** Math.ceil(Math.log2(playoffTeamCount)) - playoffTeamCount }
}

// ── 1. Create from the wizard ─────────────────────────────────────────────

export async function createDynastyLeague(env: SimEnv, input: { sport: DynastySport; teamCount: number; draft: StartupDraftKind }): Promise<LeagueRun> {
  const run: LeagueRun = { sport: input.sport, teamCount: input.teamCount, draft: input.draft, leagueId: null, commissionerId: COMMISH.id, managerIds: [], rounds: 0, findings: [], stats: {} }
  const { DEFAULT_V2_STATE, getDefaultDynastySetup } = await import('@/lib/create-league-v2/state')
  const { analyzeCreateLeagueCompletion } = await import('@/lib/create-league-v2/form-completion')
  const { getScoringPresetOptionsForSelection } = await import('@/lib/create-league-v2/rules-engine')
  const { submitCreateLeagueV2 } = await import('@/lib/create-league-v2/submit')

  await env.db.appUser.upsert({ where: { id: COMMISH.id }, create: { id: COMMISH.id, email: COMMISH.email, username: COMMISH.id }, update: {} })
  env.signIn(COMMISH)
  const wizardDraft = input.draft === 'snake_3rr' ? 'snake' : input.draft
  const presets = getScoringPresetOptionsForSelection({ leagueType: 'dynasty', sport: input.sport, idpSelected: false } as never)
  const state = {
    ...DEFAULT_V2_STATE,
    leagueType: 'dynasty',
    leagueTypeTouched: true,
    sport: input.sport,
    teamCount: input.teamCount,
    draftType: wizardDraft,
    thirdRoundReversal: input.draft === 'snake_3rr',
    draftScheduleLater: true,
    name: `Sim Dynasty ${input.sport} ${input.teamCount} ${input.draft}`,
    nameTouched: true,
    scoringPresetId: presets[0]?.id ?? '',
    dynasty: fitDynastySetupToTeamCount({ ...getDefaultDynastySetup(input.sport, wizardDraft as never), startupDraftType: wizardDraft }, input.teamCount),
  } as any
  run.stats.scoringPreset = state.scoringPresetId

  let blockers = (analyzeCreateLeagueCompletion(state) as any[]).filter((i) => i.severity !== 'warning')
  // The wizard offers no Offline draft type for dynasty (only redraft/keeper/best ball get execution modes),
  // and `dynasty.draftMode` — which defaults to 'offline' — is validated but never sent to the server. The
  // server's catalog does accept `offline` for dynasty, so record the gap and create it the way the API allows.
  if (input.draft === 'offline' && blockers.some((b) => b.code === 'draft_invalid')) {
    run.findings.push({
      code: 'WIZARD_HAS_NO_OFFLINE_DYNASTY_DRAFT',
      stage: 'create',
      message: 'The create form refuses an Offline startup draft for dynasty (draft_invalid); the server accepts it. Created through the API payload instead.',
    })
    blockers = blockers.filter((b) => b.code !== 'draft_invalid')
  }
  if (blockers.length) {
    run.findings.push({ code: 'WIZARD_BLOCKED', stage: 'create', message: `The create form refuses this league: ${blockers.map((b) => b.code).join(', ')}`, detail: { blockers } })
    return run
  }
  const result = (await submitCreateLeagueV2(state)) as any
  if (!result.ok) {
    run.findings.push({ code: 'CREATE_REFUSED', stage: 'create', message: `POST /api/leagues refused: ${result.error ?? JSON.stringify(result).slice(0, 200)}`, detail: { result } })
    return run
  }
  run.leagueId = result.leagueId as string

  const session = rowsOf(env.db, 'DraftSession').find((s: any) => s.leagueId === run.leagueId) as any
  if (!session) run.findings.push({ code: 'NO_DRAFT_SESSION', stage: 'create', message: 'League created without a startup draft session.' })
  run.rounds = Number(session?.rounds ?? 0)
  const roster = await enforcedRoster(run.leagueId)
  run.stats.enforcedRoster = roster
  if (run.rounds > roster.totalSlots) {
    run.findings.push({ code: 'DRAFT_LONGER_THAN_ROSTER', stage: 'create', message: `${run.rounds} startup rounds for ${roster.totalSlots} roster slots — the draft cannot finish.` })
  }
  const expectedDraftType = input.draft === 'snake_3rr' ? 'snake' : input.draft === 'offline' || input.draft === 'auto' ? null : input.draft
  if (session && expectedDraftType && session.draftType !== expectedDraftType) {
    run.findings.push({ code: 'DRAFT_TYPE_NOT_SAVED', stage: 'create', message: `Chose ${input.draft}; the draft session is ${session.draftType}.` })
  }
  if (session && input.draft === 'snake_3rr' && !session.thirdRoundReversal) {
    run.findings.push({ code: 'THIRD_ROUND_REVERSAL_NOT_SAVED', stage: 'create', message: 'Chose third-round reversal; the draft session does not have it.' })
  }
  return run
}

// ── 2. Managers join with the invite link's code ──────────────────────────

export async function joinManagers(env: SimEnv, run: LeagueRun): Promise<void> {
  if (!run.leagueId) return
  const league = rowsOf(env.db, 'League').find((l: any) => l.id === run.leagueId) as any
  const code = String((league.settings as any)?.inviteCode ?? '')
  const { POST: joinPost } = await import('@/app/api/leagues/join/route')
  const { NextRequest } = await import('next/server')
  for (let i = 2; i <= run.teamCount; i += 1) {
    const user = userFor(i)
    await env.db.appUser.upsert({ where: { id: user.id }, create: { id: user.id, email: user.email, username: user.id }, update: {} })
    env.signIn(user)
    const res = await joinPost(new NextRequest('http://sim.allfantasy.test/api/leagues/join', { method: 'POST', body: JSON.stringify({ code }) }))
    if (res.status !== 200) {
      const body = await res.json().catch(() => null)
      run.findings.push({ code: 'JOIN_REFUSED', stage: 'join', message: `${user.id} could not join with the invite code: ${res.status} ${JSON.stringify(body).slice(0, 160)}` })
      continue
    }
    run.managerIds.push(user.id)
  }
  env.signIn(COMMISH)
  const seats = rowsOf(env.db, 'Roster').filter((r: any) => r.leagueId === run.leagueId).map((r: any) => String(r.platformUserId ?? ''))
  const open = seats.filter((s) => s.startsWith('open-slot-'))
  if (open.length) run.findings.push({ code: 'SEATS_STILL_OPEN', stage: 'join', message: `${open.length} seat(s) still open after every manager joined.` })
  const people = new Set(seats.filter((s) => !s.startsWith('open-slot-')))
  if (people.size !== seats.filter((s) => !s.startsWith('open-slot-')).length) run.findings.push({ code: 'MANAGER_HOLDS_TWO_SEATS', stage: 'join', message: 'One user holds more than one seat.' })
}

// ── 3. Player pool, from the positions the draft enforces ─────────────────

export type PoolPlayer = { id: string; name: string; position: string; team: string; adp: number }

export async function seedPlayerPool(env: SimEnv, run: LeagueRun): Promise<PoolPlayer[]> {
  if (!run.leagueId) return []
  const roster = (run.stats.enforcedRoster as EnforcedRoster | undefined) ?? (await enforcedRoster(run.leagueId))
  const positions = roster.draftable.length ? roster.draftable : ['UTIL']
  const singleNeed = Object.keys(roster.need).length ? roster.need : Object.fromEntries(positions.map((p) => [p, 1]))
  const totalNeed = Object.values(singleNeed).reduce((a, b) => a + b, 0)
  const size = Math.ceil(run.teamCount * run.rounds * 1.5) + 40
  const pool: PoolPlayer[] = []
  for (const position of positions) {
    const share = (singleNeed[position] ?? 0.5) / totalNeed
    const n = Math.max(run.teamCount * 3, Math.ceil(size * share))
    for (let i = 0; i < n; i += 1) {
      pool.push({ id: `sim-${run.sport.toLowerCase()}-${position.toLowerCase()}-${i + 1}`, name: simPlayerName(run.sport, position, i), position, team: `T${(i * 7) % 30}`, adp: i + 1 + positions.indexOf(position) * 0.01 })
    }
  }
  pool.sort((a, b) => a.adp - b.adp)
  const existing = new Set(rowsOf(env.db, 'SportsPlayer').map((p: any) => p.id))
  const fresh = pool.filter((p) => !existing.has(p.id))
  if (fresh.length) {
    await env.db.sportsPlayer.createMany({
      // A native NFL league stores Sleeper ids, and SportsPlayer carries them: the pool ids stand in for both.
      data: fresh.map((p) => ({ id: p.id, sport: run.sport, externalId: p.id, ...(run.sport === 'NFL' ? { sleeperId: p.id } : {}), name: p.name, position: p.position, team: p.team, source: 'simulation', expiresAt: new Date('2030-01-01T00:00:00Z') })),
    })
  }
  run.stats.poolSize = pool.length
  return pool
}

/**
 * A unique, name-shaped player name. Chimmy resolves players by name, and "NFL RB 12" does not read as
 * one — the tools reported "not on a roster" for players that were. Deterministic per sport/position/index.
 */
const FIRST = ['Alex', 'Blake', 'Cam', 'Dion', 'Eli', 'Finn', 'Grant', 'Hayes', 'Isaac', 'Jalen', 'Kade', 'Luca', 'Malik', 'Nico', 'Owen', 'Pierce', 'Quinn', 'Reid', 'Silas', 'Tate', 'Uriah', 'Vince', 'Wes', 'Xavier', 'Yusuf', 'Zane']
const LAST = ['Archer', 'Brooks', 'Calloway', 'Dunmore', 'Ellison', 'Fairbanks', 'Gallagher', 'Hollis', 'Iverson', 'Jacoby', 'Kingsley', 'Lockhart', 'Merritt', 'Northcutt', 'Oakley', 'Prescott', 'Quarles', 'Redmond', 'Sterling', 'Thornton', 'Underhill', 'Valdez', 'Whitfield', 'Yardley', 'Zimmer']
export function simPlayerName(sport: string, position: string, i: number): string {
  let h = 0
  for (const ch of `${sport}:${position}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const n = h + i * 7919
  return `${FIRST[n % FIRST.length]} ${LAST[Math.floor(n / FIRST.length) % LAST.length]}-${position}${i + 1}`
}

// ── 4. The startup draft ──────────────────────────────────────────────────

/** Whose pick `overall` is, computed by the harness from the draft's own slot order. */
export function expectedRosterForPick(slotOrder: Array<{ slot: number; rosterId: string }>, overall: number, kind: 'snake' | 'snake_3rr' | 'linear'): string {
  const ordered = [...slotOrder].sort((a, b) => a.slot - b.slot)
  const n = ordered.length
  const round = Math.ceil(overall / n)
  const idx = (overall - 1) % n
  let reversed = false
  if (kind === 'snake') reversed = round % 2 === 0
  if (kind === 'snake_3rr') reversed = round === 2 || (round >= 3 && round % 2 === 1)
  return ordered[reversed ? n - 1 - idx : idx]!.rosterId
}

function chooseFor(pool: PoolPlayer[], taken: Set<string>, roster: EnforcedRoster, mine: Record<string, number>, picksLeft: number): PoolPlayer[] {
  const missing = Object.entries(roster.need).filter(([pos, n]) => (mine[pos] ?? 0) < n).map(([pos]) => pos)
  const capFor = (pos: string) => (roster.need[pos] ?? 1) * 3 + 2
  const open = pool.filter((p) => !taken.has(p.id) && roster.draftable.includes(p.position))
  const mustFill = missing.length >= picksLeft
  return [...open.filter((p) => (mustFill ? missing.includes(p.position) : (mine[p.position] ?? 0) < capFor(p.position))), ...open]
}

export async function runStartupDraft(env: SimEnv, run: LeagueRun, pool: PoolPlayer[]): Promise<void> {
  if (!run.leagueId) return
  const leagueId = run.leagueId
  const { startDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
  const started = (await startDraftSession(leagueId)) as any
  if (!started.ok) {
    run.findings.push({ code: 'DRAFT_WOULD_NOT_START', stage: 'draft', message: `startDraftSession refused: ${started.reason} ${started.error ?? ''}` })
    return
  }
  const session = rowsOf(env.db, 'DraftSession').find((s: any) => s.leagueId === leagueId) as any
  const slotOrder = (session.slotOrder ?? []) as Array<{ slot: number; rosterId: string; userId?: string | null }>
  const roster = run.stats.enforcedRoster as EnforcedRoster
  const draftedBy = new Map<string, string>()

  if (run.draft === 'auction') await draftByAuction(env, run, pool, slotOrder, roster, draftedBy)
  else if (run.draft === 'auto') await draftByAutopick(env, run)
  else await draftByPicks(env, run, pool, slotOrder, roster, draftedBy)

  await checkFinalization(env, run, draftedBy)
}

async function draftByPicks(
  env: SimEnv,
  run: LeagueRun,
  pool: PoolPlayer[],
  slotOrder: Array<{ slot: number; rosterId: string; userId?: string | null }>,
  roster: EnforcedRoster,
  draftedBy: Map<string, string>,
): Promise<void> {
  const leagueId = run.leagueId!
  const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
  const kind = run.draft === 'linear' ? 'linear' : run.draft === 'snake_3rr' ? 'snake_3rr' : 'snake'
  const offline = run.draft === 'offline'
  const taken = new Set<string>()
  const counts = new Map<string, Record<string, number>>()
  const total = run.rounds * run.teamCount
  let made = 0
  let refusals = 0
  for (let overall = 1; overall <= total; overall += 1) {
    const rosterId = expectedRosterForPick(slotOrder, overall, kind)
    const owner = slotOrder.find((s) => s.rosterId === rosterId)
    const mine = counts.get(rosterId) ?? {}
    const picksLeft = run.rounds - Math.floor((overall - 1) / run.teamCount)
    const ranked = chooseFor(pool, taken, roster, mine, picksLeft)

    // Positive control once per draft: the wrong manager tries to pick. Offline boards are entered by
    // the commissioner for every team, so the control does not apply there.
    if (!offline && overall === Math.min(total, run.teamCount + 1)) {
      const wrong = slotOrder.find((s) => s.rosterId !== rosterId)
      if (wrong && ranked[0]) {
        const res = (await submitPick({ leagueId, rosterId: wrong.rosterId, playerId: ranked[0].id, playerName: ranked[0].name, position: ranked[0].position, team: ranked[0].team, madeByUserId: wrong.userId ?? null, source: 'user', expectedOverall: overall } as never)) as any
        if (res.success) {
          run.findings.push({ code: 'WRONG_TEAM_PICK_ACCEPTED', stage: 'draft', message: `Pick ${overall}: ${wrong.rosterId} picked while ${rosterId} was on the clock.` })
          taken.add(ranked[0].id)
          made += 1
          continue
        }
        run.stats.wrongTeamControl = res.code ?? res.error
      }
    }

    let landed: PoolPlayer | null = null
    for (const candidate of ranked.slice(0, 8)) {
      const res = (await submitPick({
        leagueId,
        rosterId,
        playerId: candidate.id,
        playerName: candidate.name,
        position: candidate.position,
        team: candidate.team,
        madeByUserId: offline ? COMMISH.id : (owner?.userId ?? null),
        source: offline ? 'commissioner' : 'user',
        expectedOverall: overall,
      } as never)) as any
      if (res.success) {
        landed = candidate
        break
      }
      refusals += 1
      if (refusals <= 5) run.findings.push({ code: 'DRAFT_PICK_REFUSED', stage: 'draft', message: `Pick ${overall} (${rosterId}, ${candidate.position}) refused: ${res.code ?? ''} ${res.error ?? ''}`.trim() })
    }
    if (!landed) {
      run.findings.push({ code: 'DRAFT_STUCK', stage: 'draft', message: `No legal pick could be made at overall ${overall} for ${rosterId}.` })
      break
    }
    made += 1
    taken.add(landed.id)
    draftedBy.set(landed.id, rosterId)
    mine[landed.position] = (mine[landed.position] ?? 0) + 1
    counts.set(rosterId, mine)
  }
  run.stats.picksMade = made
  run.stats.pickRefusals = refusals
}

async function draftByAutopick(env: SimEnv, run: LeagueRun): Promise<void> {
  const { fillAutoDraftBoard } = await import('@/lib/live-draft-engine/autoDraftFill')
  const total = run.rounds * run.teamCount
  let outcome: any = null
  for (let guard = 0; guard < 20; guard += 1) {
    outcome = await fillAutoDraftBoard(run.leagueId!, { maxPicks: total, deadlineAt: Date.now() + 600_000 })
    if (outcome.completed || outcome.picks === 0) break
  }
  run.stats.autopick = outcome
  if (!outcome?.completed) {
    run.findings.push({ code: 'AUTO_DRAFT_DID_NOT_FINISH', stage: 'draft', message: `fillAutoDraftBoard stopped: ${outcome?.stopped ?? 'unknown'} after ${outcome?.picks ?? 0} picks of ${total}.`, detail: { outcome } })
  }
}

async function draftByAuction(
  env: SimEnv,
  run: LeagueRun,
  pool: PoolPlayer[],
  slotOrder: Array<{ slot: number; rosterId: string; userId?: string | null }>,
  roster: EnforcedRoster,
  draftedBy: Map<string, string>,
): Promise<void> {
  const leagueId = run.leagueId!
  const { nominatePlayer, placeBid, resolveAuctionWin } = await import('@/lib/live-draft-engine/auction/AuctionEngine')
  const total = run.rounds * run.teamCount
  const taken = new Set<string>()
  const counts = new Map<string, Record<string, number>>()
  const filled = new Map<string, number>()
  let sold = 0
  let refusals = 0
  for (let lot = 0; lot < total * 2 && sold < total; lot += 1) {
    const sessionRow = rowsOf(env.db, 'DraftSession').find((s: any) => s.leagueId === leagueId) as any
    if (sessionRow?.status === 'completed') break
    const state = (sessionRow?.auctionState ?? {}) as any
    const nominator = String(state.currentNominatorRosterId ?? state.nominatorRosterId ?? slotOrder[lot % slotOrder.length]!.rosterId)
    const mine = counts.get(nominator) ?? {}
    const picksLeft = run.rounds - (filled.get(nominator) ?? 0)
    const candidate = chooseFor(pool, taken, roster, mine, picksLeft)[0]
    if (!candidate) break
    const nom = (await nominatePlayer(leagueId, { playerName: candidate.name, position: candidate.position, team: candidate.team, playerId: candidate.id }, nominator, { autoMinimumBid: true })) as any
    if (!nom.success) {
      refusals += 1
      if (refusals <= 5) run.findings.push({ code: 'AUCTION_NOMINATION_REFUSED', stage: 'draft', message: `${nominator} could not nominate ${candidate.position}: ${nom.code ?? ''} ${nom.error ?? ''}`.trim() })
      if (refusals > 30) break
      continue
    }
    // One competing bid from a team that still has room, so the price is set by bidding, not by default.
    const rival = slotOrder.find((s) => s.rosterId !== nominator && (filled.get(s.rosterId) ?? 0) < run.rounds)
    if (rival) await placeBid(leagueId, rival.rosterId, 2).catch(() => undefined)
    const win = (await resolveAuctionWin(leagueId, { force: true })) as any
    if (!win.success || !win.winnerRosterId) {
      refusals += 1
      if (refusals <= 5) {
        const after = (rowsOf(env.db, 'DraftSession').find((s: any) => s.leagueId === leagueId) as any)?.auctionState ?? {}
        run.findings.push({
          code: 'AUCTION_RESOLVE_FAILED',
          stage: 'draft',
          message: `Lot ${lot}: ${win.error ?? 'no winner'}`,
          detail: {
            nominator,
            nominatorFilled: filled.get(nominator) ?? 0,
            rounds: run.rounds,
            rival: rival?.rosterId ?? null,
            rivalFilled: rival ? (filled.get(rival.rosterId) ?? 0) : null,
            budgets: after.budgets ?? after.remainingBudgets ?? null,
            win,
          },
        })
      }
      if (refusals > 30) break
      continue
    }
    sold += 1
    taken.add(candidate.id)
    draftedBy.set(candidate.id, win.winnerRosterId)
    const winnerCounts = counts.get(win.winnerRosterId) ?? {}
    winnerCounts[candidate.position] = (winnerCounts[candidate.position] ?? 0) + 1
    counts.set(win.winnerRosterId, winnerCounts)
    filled.set(win.winnerRosterId, (filled.get(win.winnerRosterId) ?? 0) + 1)
  }
  run.stats.auctionLotsSold = sold
  run.stats.auctionRefusals = refusals
}

// ── 5. Finalization: the board, the rosters and the season the draft produced ─────

async function checkFinalization(env: SimEnv, run: LeagueRun, draftedBy: Map<string, string>): Promise<void> {
  const leagueId = run.leagueId!
  const session = rowsOf(env.db, 'DraftSession').find((s: any) => s.leagueId === leagueId) as any
  const total = run.rounds * run.teamCount
  const picks = rowsOf(env.db, 'DraftPick').filter((p: any) => p.sessionId === session?.id && p.playerId)
  run.stats.draftStatus = session?.status
  run.stats.boardPicks = picks.length
  if (session?.status !== 'completed') {
    run.findings.push({ code: 'DRAFT_NOT_COMPLETED', stage: 'finalize', message: `Draft session is ${session?.status} with ${picks.length}/${total} picks.` })
    return
  }
  if (picks.length !== total) run.findings.push({ code: 'BOARD_SIZE_WRONG', stage: 'finalize', message: `Completed board holds ${picks.length} picks; ${run.rounds} rounds × ${run.teamCount} teams is ${total}.` })

  const seen = new Map<string, number>()
  for (const p of picks as any[]) seen.set(p.playerId, (seen.get(p.playerId) ?? 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1)
  if (dupes.length) run.findings.push({ code: 'PLAYER_DRAFTED_TWICE', stage: 'finalize', message: `${dupes.length} player(s) drafted more than once.`, detail: { dupes: dupes.slice(0, 5) } })

  const season = rowsOf(env.db, 'RedraftSeason').find((s: any) => s.leagueId === leagueId) as any
  if (!season) {
    run.findings.push({ code: 'NO_SEASON_AFTER_DRAFT', stage: 'finalize', message: 'The completed draft did not produce a season.' })
    return
  }
  run.stats.season = { status: season.status, currentWeek: season.currentWeek }
  if (season.status !== 'active') run.findings.push({ code: 'SEASON_NOT_ACTIVE', stage: 'finalize', message: `Season after the draft is ${season.status}.` })

  const redraftRosters = rowsOf(env.db, 'RedraftRoster').filter((r: any) => r.seasonId === season.id) as any[]
  if (redraftRosters.length !== run.teamCount) run.findings.push({ code: 'SEASON_ROSTER_COUNT_WRONG', stage: 'finalize', message: `${redraftRosters.length} season rosters for ${run.teamCount} teams.` })
  const rosterIdsInSeason = new Set(redraftRosters.map((r) => r.id))
  const players = rowsOf(env.db, 'RedraftRosterPlayer').filter((p: any) => rosterIdsInSeason.has(p.rosterId) && !p.droppedAt) as any[]
  if (players.length !== picks.length) run.findings.push({ code: 'ROSTERS_DONT_MATCH_BOARD', stage: 'finalize', message: `${players.length} rostered players after finalization; the board has ${picks.length} picks.` })
  const onTwo = new Map<string, Set<string>>()
  for (const p of players) onTwo.set(p.playerId, (onTwo.get(p.playerId) ?? new Set()).add(p.rosterId))
  const twice = [...onTwo.entries()].filter(([, s]) => s.size > 1)
  if (twice.length) run.findings.push({ code: 'PLAYER_ON_TWO_ROSTERS', stage: 'finalize', message: `${twice.length} player(s) on two season rosters after the draft.` })

  // Each drafted player landed with the team that drafted them (harness record → season roster).
  if (draftedBy.size) {
    // Draft rosters are generic `Roster` rows; season rosters are keyed by owner. Draft roster → manager → season roster.
    const ownerOfGeneric = new Map(rowsOf(env.db, 'Roster').filter((r: any) => r.leagueId === leagueId).map((r: any) => [String(r.id), String(r.platformUserId)]))
    const redraftByOwner = new Map(redraftRosters.map((r) => [String(r.ownerId), String(r.id)]))
    const genericToRedraft = new Map<string, string>()
    for (const [generic, owner] of ownerOfGeneric) {
      const redraft = redraftByOwner.get(owner)
      if (redraft) genericToRedraft.set(generic, redraft)
    }
    let misplaced = 0
    for (const p of players) {
      const drafter = draftedBy.get(p.playerId)
      if (!drafter) continue
      const expected = genericToRedraft.get(drafter)
      if (expected && expected !== p.rosterId) misplaced += 1
    }
    run.stats.misplacedChecked = genericToRedraft.size > 0
    if (!genericToRedraft.size) run.findings.push({ code: 'COULD_NOT_VERIFY_DRAFTED_TEAMS', stage: 'finalize', message: 'No draft roster could be matched to a season roster by owner, so "landed on the right team" was not checked.' })
    if (misplaced) run.findings.push({ code: 'PLAYER_ON_WRONG_TEAM', stage: 'finalize', message: `${misplaced} drafted player(s) landed on a team that did not draft them.` })
  }

  const weeks = new Set(rowsOf(env.db, 'RedraftMatchup').filter((m: any) => m.seasonId === season.id).map((m: any) => m.week))
  run.stats.scheduledWeeks = weeks.size
  if (weeks.size === 0) run.findings.push({ code: 'NO_SCHEDULE_AFTER_DRAFT', stage: 'finalize', message: 'The season has no matchups after the draft.' })
}
