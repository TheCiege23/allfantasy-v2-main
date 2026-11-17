/**
 * The top of /core/career in plain words (2026-11-14).
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. Career
 * opened on a small "YOUR CAREER · 2020—2025 · READ-ONLY · Totals as of…" line, and the manager's name,
 * level and record sat below the week's story, the Career Wire, the filter and a 1,100px survival table.
 * This reads the career the page already builds (lib/core-app/careerModel.ts) into one headline and one
 * line under it.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */
import type { CareerData } from '@/lib/core-app/careerModel'

type CareerHeadline =
  /** Titles won, with playoff trips when there are any. */
  | { kind: 'titles'; titles: number; playoffs: number; since: number | null }
  /** No title yet, but playoff trips. */
  | { kind: 'playoffs'; playoffs: number; since: number | null }
  /** No title or playoff trip yet: the win rate, when games are on file. */
  | { kind: 'record'; winPct: number | null; since: number | null }
  /** Nothing finished on the account. */
  | { kind: 'empty' }
  /** The account has a career, but the filter matches none of it. */
  | { kind: 'filtered' }

export function careerHeadline(
  data: Pick<CareerData, 'isEmpty' | 'accountIsEmpty' | 'championships' | 'playoffAppearances' | 'winRate' | 'firstSeason'>,
): CareerHeadline {
  if (data.isEmpty) return data.accountIsEmpty ? { kind: 'empty' } : { kind: 'filtered' }
  const since = data.firstSeason ?? null
  if (data.championships > 0) return { kind: 'titles', titles: data.championships, playoffs: data.playoffAppearances, since }
  if (data.playoffAppearances > 0) return { kind: 'playoffs', playoffs: data.playoffAppearances, since }
  return { kind: 'record', winPct: data.winRate == null ? null : Math.round(data.winRate * 100), since }
}

/** The line under the headline, as parts the screen joins: who, what level, how much history, how fresh. */
type CareerSubline = {
  handle: string | null
  level: number | null
  levelName: string | null
  leagueSeasons: number
  sports: number
  builtAt: string | null
}

export function careerSubline(
  data: Pick<CareerData, 'handle' | 'level' | 'levelName' | 'leaguesPlayed' | 'sports'>,
  builtAt: string | null,
): CareerSubline {
  return {
    handle: data.handle ?? null,
    level: data.level ?? null,
    levelName: data.levelName ?? null,
    leagueSeasons: data.leaguesPlayed,
    sports: data.sports.length,
    builtAt,
  }
}

/** "Survival scores · 30 elimination seasons · best 100.0" — the folded table's summary figures. */
export function survivalSummary(results: CareerData['survivalResults']): { seasons: number; best: number | null } | null {
  if (!results?.length) return null
  const scored = results.map((r) => r.score).filter((s): s is number => s != null)
  return { seasons: results.length, best: scored.length ? Math.max(...scored) : null }
}
