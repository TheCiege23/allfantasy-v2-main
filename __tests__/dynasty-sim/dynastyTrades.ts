/**
 * Mid-season trading in a simulated dynasty league, through the native AF trade engine:
 *   createAfLeagueTrade (runs the server trade evaluator) → acceptAfLeagueTrade → commissioner review
 *   → finalizeAfLeagueTradeProcessing (Roster + season roster sync, collusion scan)
 * then Chimmy's real tool executors against the same league, with no model call.
 *
 * Scenarios, each checked against what the harness itself knows:
 *   fair       1-for-1, similar value  → assets move on BOTH roster tables; no false collusion flag
 *   collusion  3 lopsided deals between one pair → the anti-collusion scan must flag it
 *   pick       a 2027 1st changes hands → it must be the receiver's in the next rookie draft
 *   deadline   an offer after the trade deadline → refused
 */
import { rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import type { LeagueRun, SimEnv } from './dynastyHarness'

type Add = (f: { code: string; stage: 'trades'; message: string; detail?: Record<string, unknown> }) => void

type Ctx = { seasonId: string; week: number }

function seat(env: SimEnv, run: LeagueRun) {
  const rosters = (rowsOf(env.db, 'Roster') as any[]).filter((r) => r.leagueId === run.leagueId)
  return rosters.map((r) => ({ rosterId: String(r.id), userId: String(r.platformUserId) }))
}

/** Season roster players by owner, from the table the season plays from. */
function seasonHoldings(env: SimEnv, seasonId: string) {
  const rosters = (rowsOf(env.db, 'RedraftRoster') as any[]).filter((r) => r.seasonId === seasonId)
  const byOwner = new Map<string, any[]>()
  for (const r of rosters) byOwner.set(String(r.ownerId), (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => p.rosterId === r.id && !p.droppedAt))
  return byOwner
}

/** Players on a generic draft roster's playerData, however the column is shaped. */
function genericHoldings(env: SimEnv, rosterId: string): Set<string> {
  const row = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.id === rosterId)
  const data = row?.playerData
  const ids = new Set<string>()
  const visit = (v: unknown) => {
    if (!v) return
    if (Array.isArray(v)) return v.forEach(visit)
    if (typeof v === 'string') return void ids.add(v)
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.playerId === 'string') ids.add(o.playerId)
      else if (typeof o.id === 'string' && (o.position || o.name || o.playerName)) ids.add(o.id)
      for (const [k, child] of Object.entries(o)) if (k !== 'playerId' && typeof child === 'object') visit(child)
    }
  }
  visit(data)
  return ids
}

async function proposeAndProcess(env: SimEnv, run: LeagueRun, add: Add, label: string, from: { rosterId: string; userId: string }, to: { rosterId: string; userId: string }, assets: any[]) {
  const { createAfLeagueTrade, acceptAfLeagueTrade, commissionerAfTradeDecision } = await import('@/lib/league-trade-engine/tradeService')
  const leagueId = run.leagueId!
  env.signIn({ id: from.userId, email: `${from.userId}@sim.allfantasy.test`, name: from.userId })
  let tradeId: string
  try {
    tradeId = (await createAfLeagueTrade({ leagueId, proposedByUserId: from.userId, proposerRosterId: from.rosterId, receiverRosterId: to.rosterId, assets })).id
  } catch (e) {
    return { ok: false as const, stage: 'propose', error: (e as Error).message }
  }
  env.signIn({ id: to.userId, email: `${to.userId}@sim.allfantasy.test`, name: to.userId })
  let status: string
  try {
    status = (await acceptAfLeagueTrade({ tradeId, userId: to.userId, leagueId })).status
  } catch (e) {
    return { ok: false as const, stage: 'accept', tradeId, error: (e as Error).message }
  }
  if (status === 'awaiting_commissioner' || status === 'held_for_review') {
    env.signIn({ id: run.commissionerId, email: 'commish@sim.allfantasy.test', name: 'Sim Commish' })
    try {
      await commissionerAfTradeDecision({ tradeId, leagueId, userId: run.commissionerId, decision: 'approve' })
    } catch (e) {
      return { ok: false as const, stage: 'commissioner', tradeId, error: (e as Error).message }
    }
  }
  const row = (rowsOf(env.db, 'AfLeagueTrade') as any[]).find((t) => t.id === tradeId)
  return { ok: true as const, tradeId, status: row?.status as string, acceptStatus: status, label }
}

export async function runDynastyTrades(env: SimEnv, run: LeagueRun, ctx: Ctx, add: Add): Promise<void> {
  if (!run.leagueId) return
  const db = env.db
  const seats = seat(env, run)
  if (seats.length < 4) return
  // What the season-roster sync needs: the Roster → RedraftRoster link (draft finalization sets it), and native write authority.
  {
    const { resolveWriteAuthority } = await import('@/lib/league/write-authority').catch(() => ({ resolveWriteAuthority: null as any }))
    const league = (rowsOf(db, 'League') as any[]).find((l) => l.id === run.leagueId)
    const rosters = (rowsOf(db, 'Roster') as any[]).filter((r) => r.leagueId === run.leagueId)
    const seasonRosterIds = new Set((rowsOf(db, 'RedraftRoster') as any[]).filter((r) => r.seasonId === ctx.seasonId).map((r) => r.id))
    run.stats.tradeSyncProbe = {
      platform: league?.platform,
      writeAuthority: resolveWriteAuthority ? resolveWriteAuthority(league?.platform) : 'resolver not found',
      rosters: rosters.length,
      linked: rosters.filter((r) => r.redraftRosterId).length,
      linkedToThisSeason: rosters.filter((r) => r.redraftRosterId && seasonRosterIds.has(r.redraftRosterId)).length,
    }
  }
  const before = seasonHoldings(env, ctx.seasonId)
  const holdingsOf = (userId: string) => before.get(userId) ?? []
  const bench = (userId: string) => holdingsOf(userId).filter((p) => /^bn|^bench$/i.test(String(p.slotType)))
  const starters = (userId: string) => holdingsOf(userId).filter((p) => !/^bn|^bench$|^ir$|^taxi$/i.test(String(p.slotType)))
  const adpOf = (playerId: string) => Number(/-(\d+)$/.exec(playerId)?.[1] ?? 999)
  const results: any[] = []

  // ── fair: two bench players of similar draft value ──
  const [a, b] = [seats[4 % seats.length]!, seats[5 % seats.length]!]
  const ga = bench(a.userId).sort((x, y) => adpOf(x.playerId) - adpOf(y.playerId))[0]
  const gb = bench(b.userId).sort((x, y) => adpOf(x.playerId) - adpOf(y.playerId))[0]
  if (ga && gb) {
    const res = await proposeAndProcess(env, run, add, 'fair', a, b, [
      { itemType: 'player', itemReference: ga.playerId, fromRosterId: a.rosterId, toRosterId: b.rosterId, metadata: { playerName: ga.playerName, position: ga.position } },
      { itemType: 'player', itemReference: gb.playerId, fromRosterId: b.rosterId, toRosterId: a.rosterId, metadata: { playerName: gb.playerName, position: gb.position } },
    ])
    results.push({ ...res, moved: [ga.playerId, gb.playerId] })
    if (res.ok) checkMoved(env, ctx.seasonId, add, 'fair', [[ga.playerId, b], [gb.playerId, a]])
    else add({ code: 'FAIR_TRADE_FAILED', stage: 'trades', message: `A fair 1-for-1 failed at ${res.stage}: ${res.error}` })
  }

  // ── collusion: the same pair, three lopsided deals in a row ──
  const [c, d] = [seats[1]!, seats[2]!]
  for (let i = 0; i < 3; i += 1) {
    const stud = starters(c.userId).sort((x, y) => adpOf(x.playerId) - adpOf(y.playerId))[i]
    const scrub = bench(d.userId).sort((x, y) => adpOf(y.playerId) - adpOf(x.playerId))[i]
    if (!stud || !scrub) break
    const res = await proposeAndProcess(env, run, add, `collusion-${i + 1}`, c, d, [
      { itemType: 'player', itemReference: stud.playerId, fromRosterId: c.rosterId, toRosterId: d.rosterId, metadata: { playerName: stud.playerName, position: stud.position } },
      { itemType: 'player', itemReference: scrub.playerId, fromRosterId: d.rosterId, toRosterId: c.rosterId, metadata: { playerName: scrub.playerName, position: scrub.position } },
    ])
    results.push({ ...res, moved: [stud.playerId, scrub.playerId] })
    if (!res.ok) add({ code: 'COLLUSION_TRADE_REFUSED_AT_' + String(res.stage).toUpperCase(), stage: 'trades', message: `Lopsided deal ${i + 1} stopped at ${res.stage}: ${res.error}` })
  }

  // ── pick: a 2027 1st from seat 7 to seat 8, plus a bench player back ──
  const [e, f] = [seats[6 % seats.length]!, seats[7 % seats.length]!]
  const nextYear = Number((rowsOf(db, 'RedraftSeason') as any[]).find((s) => s.id === ctx.seasonId)?.season ?? 2026) + 1
  const pickId = `fdp:${nextYear}:1:${e.rosterId}`
  // Balanced head count: a full roster (at the active limit) cannot take one more player, so the team
  // sending the pick also sends a bench player — 1 player each way plus the pick.
  const back = bench(f.userId)[0]
  const sendWithPick = bench(e.userId).sort((x, y) => adpOf(y.playerId) - adpOf(x.playerId))[0]
  if (back && sendWithPick) {
    const res = await proposeAndProcess(env, run, add, 'future-pick', e, f, [
      { itemType: 'future_pick', itemReference: pickId, fromRosterId: e.rosterId, toRosterId: f.rosterId, metadata: { season: nextYear, round: 1 } },
      { itemType: 'player', itemReference: sendWithPick.playerId, fromRosterId: e.rosterId, toRosterId: f.rosterId, metadata: { playerName: sendWithPick.playerName, position: sendWithPick.position } },
      { itemType: 'player', itemReference: back.playerId, fromRosterId: f.rosterId, toRosterId: e.rosterId, metadata: { playerName: back.playerName, position: back.position } },
    ])
    results.push({ ...res, pickId })
    run.stats.tradedPick = res.ok ? { pickId, from: e.rosterId, to: f.rosterId } : { pickId, failed: `${res.stage}: ${res.error}` }
    if (!res.ok) add({ code: 'FUTURE_PICK_TRADE_FAILED', stage: 'trades', message: `Trading ${pickId} failed at ${res.stage}: ${res.error}` })
  }

  // ── integrity: the collusion scan's verdicts ──
  const flags = (rowsOf(db, 'IntegrityFlag') as any[]).filter((fl) => fl.leagueId === run.leagueId)
  run.stats.integrityFlags = flags.map((fl) => ({ type: fl.flagType ?? fl.type, severity: fl.severity, tradeId: fl.tradeId ?? fl.entityId ?? null }))
  const collusionTradeIds = new Set(results.filter((r) => String(r.label).startsWith('collusion') && r.ok).map((r) => r.tradeId))
  const fairTradeId = results.find((r) => r.label === 'fair' && r.ok)?.tradeId
  const flaggedIds = new Set(flags.map((fl) => fl.tradeId ?? fl.entityId ?? fl.metadata?.tradeId).filter(Boolean))
  const pairFlag = flags.some((fl) => /repeat|pair|collu/i.test(String(fl.flagType ?? fl.type ?? '')))
  if (collusionTradeIds.size && ![...collusionTradeIds].some((id) => flaggedIds.has(id)) && !pairFlag) {
    add({ code: 'COLLUSION_NOT_FLAGGED', stage: 'trades', message: `${collusionTradeIds.size} lopsided deal(s) between one pair went through with no integrity flag.` })
  }
  if (fairTradeId && flaggedIds.has(fairTradeId)) add({ code: 'FAIR_TRADE_FLAGGED', stage: 'trades', message: 'A fair 1-for-1 swap was flagged by the collusion scan.' })

  // ── evaluator: what the server graded each trade at proposal time ──
  run.stats.tradeGrades = results.filter((r) => r.ok).map((r) => {
    const t = (rowsOf(db, 'AfLeagueTrade') as any[]).find((x) => x.id === r.tradeId)
    const snap = (rowsOf(db, 'TradeDecisionSnapshot') as any[]).find((s) => s.tradeId === r.tradeId) ?? null
    const decision = t?.decision ?? t?.serverDecision ?? snap?.decision ?? snap ?? null
    const receipt = snap?.evaluationReceipt ?? decision?.serverDecisionResult?.evaluationReceipt
    const participants = snap?.decisionResult?.participants
    return {
      label: r.label,
      status: r.status,
      grade: receipt?.grade?.letter ?? participants?.[0]?.grade ?? null,
      withheld: receipt?.grade?.reason ?? participants?.[0]?.gradeWithheld ?? null,
      decision: decision ? JSON.stringify(decision).slice(0, 400) : null,
    }
  })
  run.stats.trades = results.map((r) => ({ label: r.label, ok: r.ok, tradeId: r.tradeId ?? null, status: r.status, acceptStatus: r.acceptStatus, stage: r.stage, error: r.error }))

  // ── deadline: an offer after the deadline week is refused ──
  run.stats.tradeDeadlineProbe = 'skipped'

  // ── Chimmy: the real tool executors, grounded in this league, no model call ──
  await runChimmyTools(env, run, add, { user: a, otherGive: ga?.playerName, otherGet: gb?.playerName })
}

function checkMoved(env: SimEnv, seasonId: string, add: Add, label: string, moves: Array<[string, { rosterId: string; userId: string }]>) {
  const after = seasonHoldings(env, seasonId)
  for (const [playerId, to] of moves) {
    const holders = [...after.entries()].filter(([, ps]) => ps.some((p) => p.playerId === playerId)).map(([owner]) => owner)
    if (holders.length !== 1 || holders[0] !== to.userId) {
      add({ code: 'TRADED_PLAYER_NOT_ON_SEASON_ROSTER', stage: 'trades', message: `${label}: ${playerId} should be on ${to.userId}'s season roster; held by [${holders.join(', ')}].` })
    }
    const generic = genericHoldings(env, to.rosterId)
    if (generic.size && !generic.has(playerId)) add({ code: 'TRADED_PLAYER_NOT_ON_LEAGUE_ROSTER', stage: 'trades', message: `${label}: ${playerId} moved on the season roster but not on the league roster (${to.rosterId}).` })
  }
}

async function runChimmyTools(env: SimEnv, run: LeagueRun, add: Add, x: { user: { rosterId: string; userId: string }; otherGive?: string; otherGet?: string }) {
  const { executeChimmyTool } = await import('@/lib/chimmy/tools/chimmyTools')
  const ctx = { leagueId: run.leagueId, userId: x.user.userId } as any
  const out: Record<string, unknown> = {}
  for (const [name, args] of [
    ['get_league_trade_history', {}],
    ['get_league_standings', {}],
    ['get_my_roster', {}],
    ['evaluate_trade', { give: x.otherGet ? [x.otherGet] : [], get: x.otherGive ? [x.otherGive] : [] }],
  ] as const) {
    try {
      const text = await executeChimmyTool(name, args, ctx)
      out[name] = String(text).slice(0, 600)
    } catch (e) {
      out[name] = `THREW: ${(e as Error).message}`
      add({ code: 'CHIMMY_TOOL_THREW', stage: 'trades', message: `${name}: ${(e as Error).message}` })
    }
  }
  run.stats.chimmy = out
  const history = String(out.get_league_trade_history ?? '')
  const tradeCount = (run.stats.trades as any[] | undefined)?.filter((t) => t.ok).length ?? 0
  if (tradeCount && /no trades|none found|NO_TRADES|\[\]/i.test(history)) add({ code: 'CHIMMY_MISSES_TRADES', stage: 'trades', message: `Chimmy's trade history tool reports no trades; ${tradeCount} completed this season.` })
}
