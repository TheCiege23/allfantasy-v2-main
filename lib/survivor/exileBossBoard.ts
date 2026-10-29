import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { buildExileBoard, canViewExileBoard, computeExileBossScore, type ExileBoardFinalStatus, type ExileBoardRow } from './exileBoss'
import { readExileRoster } from './exileRosterRules'
import { describeExileBossMode, effectiveExileBossMode, readSurvivorLateSeasonSettings, type SurvivorExileBossMode } from './lateSeasonSettings'
import { parseSurvivorFairPlayFromLeagueSettings } from './survivorFairPlay'

export interface ExileBossBoardView {
  week: number
  status: 'live' | 'final'
  mode: SurvivorExileBossMode
  modeLabel: string
  boss: number | null
  /** True when the board can name a boss for this week (fixed, or scores exist). */
  bossKnown: boolean
  rows: ExileBoardRow[]
  wipeOnLoss: boolean
  /** Viewer's own outcome for the outcome toast, once the week is final. */
  myOutcome: { kind: 'beat' | 'lost'; score: number; boss: number; tokensWiped: number; earnedToken: boolean; tokensHeld: number } | null
}

export type ExileBossBoardResult =
  | { ok: true; board: ExileBossBoardView | null }
  | { ok: false; status: 403 | 404; error: string }

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})

async function liveExileScore(league: { sport: string; season: number; settings: unknown }, lineup: unknown, week: number): Promise<{ score: number; projected: number | null } | null> {
  const roster = readExileRoster(lineup)
  const starters = roster?.players.filter((p) => p.slot !== 'BENCH') ?? []
  if (!starters.length) return null
  const scorer = buildLeagueStatScorer(league)
  if (!scorer) return null
  const ids = starters.map((p) => p.id)
  const [scores, projections] = await Promise.all([
    prisma.playerWeeklyScore.findMany({ where: { playerId: { in: ids }, week, season: league.season, sport: league.sport }, select: { playerId: true, stats: true } }),
    prisma.fantasyProjection.findMany({ where: { playerId: { in: ids }, week, season: String(league.season), sport: league.sport }, select: { playerId: true, projectedPoints: true } }).catch(() => []),
  ])
  let score = 0
  let remaining = 0
  let projectedAny = false
  for (const player of starters) {
    const row = scores.find((s) => s.playerId === player.id)
    const stats = row?.stats && typeof row.stats === 'object' && !Array.isArray(row.stats) ? (row.stats as Record<string, number>) : null
    if (stats) {
      const pts = scorer(stats, player.position)
      if (Number.isFinite(pts)) score += pts
      continue
    }
    const proj = projections.filter((p) => p.playerId === player.id).map((p) => p.projectedPoints).filter(Number.isFinite)
    if (proj.length) {
      projectedAny = true
      remaining += Math.max(...proj)
    }
  }
  return { score: Math.round(score * 100) / 100, projected: projectedAny ? Math.round((score + remaining) * 100) / 100 : null }
}

export async function getExileBossBoard(leagueId: string, viewerUserId: string, opts?: { week?: number | null }): Promise<ExileBossBoardResult> {
  const [league, island, viewer] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, season: true, settings: true } }),
    prisma.exileIsland.findUnique({ where: { leagueId } }),
    prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: viewerUserId } }, select: { playerState: true } }),
  ])
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  const settings = rec(league.settings)
  const isCommissioner = league.userId === viewerUserId
  const { fairPlayLimited } = parseSurvivorFairPlayFromLeagueSettings(settings)
  if (!canViewExileBoard({ playerState: viewer?.playerState, isCommissioner, fairPlayLimited, isPlayer: Boolean(viewer) })) {
    return { ok: false, status: 403, error: 'The Exile board is visible to managers on Exile Island.' }
  }
  if (!island?.isActive) return { ok: true, board: null }

  const stored = readSurvivorLateSeasonSettings(settings)
  // The board shows the boss the week is actually settled against (exileEngine uses the same rule).
  const late = { ...stored, exileBossMode: effectiveExileBossMode(stored.exileBossMode, league.sport) }
  const latest = await prisma.exileWeeklyEntry.findFirst({ where: { exileId: island.id }, orderBy: { week: 'desc' }, select: { week: true } })
  const week = opts?.week && Number.isInteger(opts.week) && opts.week > 0 ? opts.week : latest?.week ?? island.currentWeek
  const [entries, scored, players] = await Promise.all([
    prisma.exileWeeklyEntry.findMany({ where: { exileId: island.id, week } }),
    prisma.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_week_scored' }, select: { data: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'exile' }, select: { userId: true, displayName: true, tokenBalance: true } }),
  ])
  const final = Boolean(scored)
  const scoredData = rec(scored?.data)
  const wipedCounts = rec(scoredData.wiped)

  let boss: number | null = null
  if (final) {
    boss = typeof scoredData.bossScore === 'number' ? scoredData.bossScore : entries.find((e) => e.bossScore != null)?.bossScore ?? null
  } else if (late.exileBossMode === 'chimmy_roster') {
    const result = await prisma.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_boss_result_finalized' }, select: { data: true } })
    const score = rec(result?.data).score
    boss = typeof score === 'number' ? score : null
  } else {
    const live = late.exileBossMode === 'fixed' ? [] : (await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week }, select: { finalScore: true } })).map((r) => r.finalScore)
    boss = computeExileBossScore({ mode: late.exileBossMode, fixedScore: late.exileBossFixedScore, topN: late.exileBossTopN }, live)
  }

  // Exiled managers with no entry this week still appear (score 0) so nobody is hidden from the board.
  const byUser = new Map(entries.map((e) => [e.userId, e]))
  const rows = await Promise.all(players.map(async (player) => {
    const entry = byUser.get(player.userId)
    if (final) {
      const status: ExileBoardFinalStatus | null = !entry || boss == null ? null : entry.tokenEarned > 0 ? 'won_week' : entry.weeklyScore < boss ? 'wiped' : 'safe'
      const wiped = typeof wipedCounts[player.userId] === 'number' ? (wipedCounts[player.userId] as number) : entry?.tokenWiped ? 1 : 0
      return { userId: player.userId, displayName: player.displayName, score: entry?.weeklyScore ?? 0, projected: null, tokens: player.tokenBalance,
        finalStatus: status, wipedTokens: wiped, earnedToken: (entry?.tokenEarned ?? 0) > 0 }
    }
    const live = entry ? await liveExileScore(league, entry.submittedLineup, week) : null
    return { userId: player.userId, displayName: player.displayName, score: live?.score ?? entry?.weeklyScore ?? 0, projected: live?.projected ?? null, tokens: player.tokenBalance }
  }))
  const board = buildExileBoard({ boss, final, rows })
  const mine = board.find((row) => row.userId === viewerUserId)
  const myOutcome = final && mine && boss != null && mine.finalStatus
    ? { kind: mine.finalStatus === 'wiped' ? 'lost' as const : 'beat' as const, score: mine.score, boss, tokensWiped: mine.wipedTokens, earnedToken: mine.earnedToken, tokensHeld: mine.tokens }
    : null
  return { ok: true, board: { week, status: final ? 'final' : 'live', mode: late.exileBossMode, modeLabel: describeExileBossMode(late), boss, bossKnown: boss != null,
    rows: board, wipeOnLoss: island.bossTokenResetOnWin, myOutcome } }
}
