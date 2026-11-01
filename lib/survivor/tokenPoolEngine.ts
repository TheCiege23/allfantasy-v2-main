/**
 * Token Pool Pick'em Engine for Survivor Exile Island — the LEGACY entry points, now a bridge.
 *
 * The Token Pool lives in the side games (survivorSideGameService.ts: picks, settlement, streaks,
 * the commissioner's open/close switch, Chimmy's picks). This module keeps the old function names
 * and response shapes for `/api/survivor/token-pool` and `/api/survivor/token-pool/resolve`, and
 * routes every read and write through the side-game Token Pool, so a league has ONE Token Pool
 * truth and ONE token balance (`SurvivorPlayer.tokenBalance`). The legacy table
 * (`survivor_token_pool_picks`) is kept as read-only history: nothing is deleted, and an old row
 * that was never resolved still resolves — into the side-game balance. Pure mapping:
 * survivorTokenPoolBridge.ts.
 */

import { prisma } from '@/lib/prisma'
import {
  legacyPickTeam,
  legacyWinnerKey,
  mergeLegacyTokenPoolRows,
  resolveLegacyGameKey,
  sideGamePickAsLegacyRow,
  type LegacyTokenPoolPickRow,
} from './survivorTokenPoolBridge'
import { sideGameTeamKey } from './survivorSideGameRules'

export interface TokenPoolPickInput {
  leagueId: string
  userId: string
  week: number
  sport: string
  pickType: 'win_pick' | 'over_under' | 'prop_bet' | 'exact_score'
  pick: Record<string, unknown>
}

export interface TokenPoolPickResult {
  pickId: string
  isCorrect: boolean
  tokensEarned: number
  tokensLost: number
  newBalance: number
}

async function sideGames() {
  const [service, store] = await Promise.all([import('./survivorSideGameService'), import('./survivorSideGameStore')])
  return { service, store }
}

/**
 * Submit a pick. A `win_pick` becomes a side-game Token Pool pick (exiles only, the game must not
 * have kicked off, the weekly limit and the commissioner's open/closed switch apply). The other
 * legacy pick types never had a settlement source and are refused. Throws a plain message on a
 * refusal, as before.
 */
export async function submitTokenPoolPick(input: TokenPoolPickInput): Promise<{ pickId: string }> {
  if (input.pickType !== 'win_pick') {
    throw new Error('The Token Pool takes game-winner picks only. Pick the team you think will win.')
  }
  const { service, store } = await sideGames()
  const league = await store.loadSideGameLeague(prisma, input.leagueId)
  if (!league) throw new Error('This is not a Survivor league.')
  const { week } = await store.currentSurvivorWeek(prisma, input.leagueId)
  const games = await store.loadSideGameWeekGames(prisma, league.sport, league.season, week)
  const team = legacyPickTeam(input.pick)
  const gameKey = resolveLegacyGameKey(league.sport, games, String(input.pick.gameKey ?? input.pick.gameId ?? ''), team)
  if (!gameKey) throw new Error('That game is not on this week’s slate.')
  const result = await service.submitTokenPoolPick({ leagueId: input.leagueId, userId: input.userId, gameKey, teamKey: sideGameTeamKey(league.sport, team) })
  if (!result.ok) throw new Error(result.error)
  return { pickId: result.pickId }
}

/**
 * Resolve a week against posted results (`{ [gameKey]: { winner } }`). Side-game picks on each game
 * settle exactly as the Hub's settle override settles them. A legacy row from before the bridge that
 * was never resolved settles too (correct +1; the league's harsh rule −1), paid into the side-game
 * token balance. Returns every settled pick in the legacy shape.
 */
export async function resolveTokenPoolPicks(
  leagueId: string,
  week: number,
  results: Record<string, { winner?: string; totalScore?: number; correct?: boolean }>,
  opts: { by?: 'auto' | 'commissioner'; actorUserId?: string | null } = {},
): Promise<TokenPoolPickResult[]> {
  const { service, store } = await sideGames()
  const league = await store.loadSideGameLeague(prisma, leagueId)
  if (!league) return []
  const games = await store.loadSideGameWeekGames(prisma, league.sport, league.season, week)
  const outcomes: TokenPoolPickResult[] = []

  const before = await store.loadSideGameState(prisma, leagueId)
  for (const [legacyId, result] of Object.entries(results)) {
    const gameKey = resolveLegacyGameKey(league.sport, games, legacyId, result.winner)
    const game = gameKey ? games.find((g) => g.key === gameKey) : null
    const winner = game ? legacyWinnerKey(league.sport, game, result.winner) : null
    if (!game || !winner) continue
    await service.settleSideGamePicksForGame({ league, week, gameKey: game.key, winnerKey: winner, by: opts.by ?? 'commissioner', actorUserId: opts.actorUserId ?? null, games, which: 'token_pool' })
  }
  const after = await store.loadSideGameState(prisma, leagueId)
  const settledRows = await prisma.survivorAuditEntry.findMany({ where: { leagueId, week, relatedEntityType: 'survivor_side_game', action: 'tp_settled' }, select: { data: true } }).catch(() => [])
  const deltaOf = new Map<string, number>()
  for (const r of settledRows) {
    const d = (r.data ?? {}) as Record<string, unknown>
    if (typeof d.pickId === 'string') deltaOf.set(d.pickId, typeof d.balanceDelta === 'number' ? d.balanceDelta : 0)
  }
  for (const [userId, tp] of after.tokenPool) {
    const was = before.tokenPool.get(userId)
    for (const pick of tp.picks) {
      if (pick.week !== week || pick.outcome == null) continue
      if (was?.picks.find((p) => p.pickId === pick.pickId)?.outcome != null) continue
      const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { tokenBalance: true } })
      const delta = deltaOf.get(pick.pickId) ?? 0
      outcomes.push({ pickId: pick.pickId, isCorrect: pick.outcome === 'correct', tokensEarned: Math.max(0, delta), tokensLost: Math.max(0, -delta), newBalance: player?.tokenBalance ?? 0 })
    }
  }

  // History: legacy rows nobody resolved before the bridge (the old writer stored an unresolved row as
  // isCorrect false with no tokens moved). Same rule as before, ONE balance now. A row of that old shape
  // may already have been resolved as a no-cost miss, so it is never charged a token here — only ever paid.
  const legacy = await prisma.tokenPoolPick.findMany({ where: { leagueId, week, OR: [{ isCorrect: null }, { isCorrect: false, tokensEarned: 0, tokensLost: 0 }] } }).catch(() => [])
  const harsh = league.sideGames.tokenPoolWrongPick !== 'keep'
  for (const row of legacy) {
    const data = (row.pick && typeof row.pick === 'object' ? row.pick : {}) as Record<string, unknown>
    const result = results[String(data.gameId ?? data.gameKey ?? '')]
    if (!result) continue
    let isCorrect = false
    if (row.pickType === 'win_pick') isCorrect = sideGameTeamKey(league.sport, String(data.winner ?? '')) === sideGameTeamKey(league.sport, String(result.winner ?? ''))
    else if (row.pickType === 'over_under') isCorrect = String(data.selection ?? 'over') === 'over' ? Number(result.totalScore ?? 0) > Number(data.line ?? 0) : Number(result.totalScore ?? 0) < Number(data.line ?? 0)
    else if (row.pickType === 'prop_bet') isCorrect = result.correct === true
    else if (row.pickType === 'exact_score') isCorrect = Number(data.predictedScore) === Number(result.totalScore)
    const delta = isCorrect ? 1 : harsh && row.isCorrect === null ? -1 : 0
    if (!isCorrect && row.isCorrect === false) continue
    const claimed = await prisma.tokenPoolPick.updateMany({ where: { id: row.id, isCorrect: row.isCorrect, tokensEarned: 0, tokensLost: 0 }, data: { isCorrect, tokensEarned: Math.max(0, delta), tokensLost: Math.max(0, -delta) } })
    if (!claimed.count) continue
    const moved = delta
      ? await prisma.$transaction((db) => store.adjustSideGameTokens(db, { leagueId, userId: row.userId, week, delta, cap: league.survivorTokenCap, source: 'token_pool_legacy' }))
      : null
    const balance = moved?.balance ?? (await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: row.userId } }, select: { tokenBalance: true } }))?.tokenBalance ?? 0
    outcomes.push({ pickId: row.id, isCorrect, tokensEarned: Math.max(0, delta), tokensLost: Math.max(0, -delta), newBalance: balance })
  }
  return outcomes
}

/** A manager's Token Pool picks: the side-game picks plus legacy history, newest first. */
export async function getTokenPoolPicks(leagueId: string, userId: string, week?: number): Promise<LegacyTokenPoolPickRow[]> {
  const { store } = await sideGames()
  const [league, state, legacy] = await Promise.all([
    store.loadSideGameLeague(prisma, leagueId),
    store.loadSideGameState(prisma, leagueId),
    prisma.tokenPoolPick.findMany({ where: { leagueId, userId, ...(week != null && { week }) }, orderBy: { submittedAt: 'desc' } }).catch(() => []),
  ])
  const sport = league?.sport ?? 'NFL'
  const settled = await prisma.survivorAuditEntry.findMany({
    where: { leagueId, relatedEntityType: 'survivor_side_game', relatedEntityId: `tokenpool:${userId}`, action: 'tp_settled' },
    select: { data: true },
  }).catch(() => [])
  const deltas = new Map<string, number>()
  for (const s of settled) {
    const d = (s.data ?? {}) as Record<string, unknown>
    if (typeof d.pickId === 'string' && typeof d.balanceDelta === 'number') deltas.set(d.pickId, d.balanceDelta)
  }
  const mine = (state.tokenPool.get(userId)?.picks ?? []).map((p) => sideGamePickAsLegacyRow(sport, p, deltas.get(p.pickId)))
  const history: LegacyTokenPoolPickRow[] = legacy.map((r) => ({
    id: r.id, week: r.week, sport: r.sport, pickType: r.pickType, pick: (r.pick ?? {}) as Record<string, unknown>,
    isCorrect: r.isCorrect, tokensEarned: r.tokensEarned, tokensLost: r.tokensLost, submittedAt: r.submittedAt.toISOString(), source: 'legacy',
  }))
  return mergeLegacyTokenPoolRows(mine, history, week)
}

/** The ONE token balance: what the side games, the shop and the Exile return all spend. */
export async function getTokenBalance(leagueId: string, userId: string): Promise<number> {
  const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { tokenBalance: true } })
  return player?.tokenBalance ?? 0
}
