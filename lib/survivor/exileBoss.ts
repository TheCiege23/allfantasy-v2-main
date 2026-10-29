/**
 * EXILE BOSS — pure rules. The boss is a weekly SCORE, not a person:
 *   median  → median of every active (main-island) manager's score that week (default)
 *   fixed   → a number the commissioner sets
 *   topN    → mean of the top N active scores
 * Each Exile manager who finishes BELOW the boss loses every token they hold (unless shielded);
 * finishing at or above it keeps them safe, and the top score strictly above the boss wins the
 * week (+1 token). No DB, no I/O: unit-tested in __tests__/survivor-exile-boss.test.ts.
 */

import type { SurvivorExileBossMode } from './lateSeasonSettings'

export interface ExileBossConfig {
  mode: Exclude<SurvivorExileBossMode, 'chimmy_roster'>
  fixedScore?: number | null
  topN?: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Returns null when the boss cannot be computed yet (no active scores for a median/topN boss). */
export function computeExileBossScore(config: ExileBossConfig, activeScores: ReadonlyArray<number>): number | null {
  if (config.mode === 'fixed') {
    return typeof config.fixedScore === 'number' && Number.isFinite(config.fixedScore) && config.fixedScore >= 0 ? round2(config.fixedScore) : null
  }
  const scores = activeScores.filter((n) => Number.isFinite(n)).sort((a, b) => b - a)
  if (!scores.length) return null
  if (config.mode === 'topN') {
    const n = Math.max(1, Math.min(scores.length, Math.floor(config.topN ?? 3)))
    return round2(scores.slice(0, n).reduce((sum, s) => sum + s, 0) / n)
  }
  const asc = [...scores].reverse()
  const mid = Math.floor(asc.length / 2)
  return round2(asc.length % 2 ? asc[mid]! : (asc[mid - 1]! + asc[mid]!) / 2)
}

export type ExileBoardLiveStatus = 'ahead' | 'behind'
export type ExileBoardFinalStatus = 'won_week' | 'safe' | 'wiped'

export interface ExileBoardInputRow {
  userId: string
  displayName: string
  score: number
  projected?: number | null
  tokens: number
  /** Holds a token shield: finishing below the boss does not wipe their tokens. */
  shielded?: boolean
}

export interface ExileBoardRow {
  userId: string
  displayName: string
  rank: number
  score: number
  projected: number | null
  /** score − boss, rounded to 2dp; null while the boss is unknown. */
  margin: number | null
  /** Tokens held now (after settlement when final). */
  tokens: number
  /** Tokens lost to the boss this week (final only). */
  wipedTokens: number
  earnedToken: boolean
  liveStatus: ExileBoardLiveStatus | null
  finalStatus: ExileBoardFinalStatus | null
}

/**
 * Settle one week. `tokensBefore` are balances BEFORE the week settles. Mirrors the engine
 * (exileEngine.scoreExileWeek) so the board and the ledger can never disagree.
 */
export function settleExileBossWeek(input: {
  boss: number
  rows: ReadonlyArray<ExileBoardInputRow>
  tokenCap?: number | null
  wipeOnLoss: boolean
  /** Deterministic tie-break among leaders tied above the boss: lower key wins. */
  tieKey: (userId: string) => string
}): { winnerUserId: string | null; rows: Array<{ userId: string; finalStatus: ExileBoardFinalStatus; tokensAfter: number; wipedTokens: number; earnedToken: boolean }> } {
  const { boss, rows } = input
  const above = rows.filter((row) => row.score > boss)
  const best = above.length ? Math.max(...above.map((row) => row.score)) : null
  const leaders = best == null ? [] : above.filter((row) => row.score === best).sort((a, b) => input.tieKey(a.userId).localeCompare(input.tieKey(b.userId)))
  const winner = leaders[0] ?? null
  return {
    winnerUserId: winner?.userId ?? null,
    rows: rows.map((row) => {
      if (row.score < boss) {
        const wiped = input.wipeOnLoss && !row.shielded ? row.tokens : 0
        return { userId: row.userId, finalStatus: 'wiped' as const, tokensAfter: row.tokens - wiped, wipedTokens: wiped, earnedToken: false }
      }
      const capped = input.tokenCap != null && input.tokenCap >= 0 && row.tokens >= input.tokenCap
      const earned = winner?.userId === row.userId && !capped
      return { userId: row.userId, finalStatus: winner?.userId === row.userId ? 'won_week' as const : 'safe' as const, tokensAfter: row.tokens + (earned ? 1 : 0), wipedTokens: 0, earnedToken: earned }
    }),
  }
}

/** Build the Exile board: rank by score (desc, then name), live chips or final outcomes. */
export function buildExileBoard(input: {
  boss: number | null
  final: boolean
  rows: ReadonlyArray<ExileBoardInputRow & { finalStatus?: ExileBoardFinalStatus | null; wipedTokens?: number; earnedToken?: boolean }>
}): ExileBoardRow[] {
  const sorted = [...input.rows].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
  let lastScore: number | null = null
  let lastRank = 0
  return sorted.map((row, index) => {
    const rank = lastScore === row.score ? lastRank : index + 1
    lastScore = row.score
    lastRank = rank
    const margin = input.boss == null ? null : round2(row.score - input.boss)
    const versus = row.projected != null && Number.isFinite(row.projected) && !input.final ? row.projected : row.score
    return {
      userId: row.userId,
      displayName: row.displayName,
      rank,
      score: round2(row.score),
      projected: row.projected != null && Number.isFinite(row.projected) ? round2(row.projected) : null,
      margin,
      tokens: row.tokens,
      wipedTokens: input.final ? row.wipedTokens ?? 0 : 0,
      earnedToken: input.final ? Boolean(row.earnedToken) : false,
      // Live chips compare the current score; projections are shown beside it, not used for the chip.
      liveStatus: input.final || input.boss == null ? null : row.score >= input.boss ? 'ahead' : 'behind',
      finalStatus: input.final ? row.finalStatus ?? (input.boss == null ? null : versus >= input.boss ? 'safe' : 'wiped') : null,
    }
  })
}

/**
 * Token math on Exile is private to Exile (same rule as the Exile page): only exiled managers and
 * a non-playing commissioner may see the board. A playing (fair-play) commissioner who is not on
 * Exile gets nothing.
 */
export function canViewExileBoard(input: { playerState: string | null | undefined; isCommissioner: boolean; fairPlayLimited: boolean; isPlayer: boolean }): boolean {
  if (input.playerState === 'exile') return true
  if (!input.isCommissioner) return false
  return !(input.fairPlayLimited && input.isPlayer)
}
