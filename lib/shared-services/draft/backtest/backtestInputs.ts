import type { RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { replayKey } from './draftReplay'

/**
 * Draft backtest inputs (2026-11-14) — the PURE half of `scripts/draft-backtest.ts`.
 *
 * Everything here turns rows the runner has already read into the three things `replayDraft` needs
 * (a market, picks, an outcome table), and every function reports what it could NOT place rather
 * than dropping it silently. The id spaces behind `PlayerWeeklyScore.playerId` and
 * `FantasyProjection.playerId` are not documented anywhere, so the runner MEASURES which
 * `SportsPlayer` identifier each one uses (`chooseIdSpace`) instead of assuming.
 */

/** One name for a player everywhere in a backtest: the draft pool's canonical form. */
export function backtestName(name: string | null | undefined): string {
  return canonicalName(name)
}

export function backtestKey(name: string | null | undefined, position: string | null | undefined): string {
  return replayKey(backtestName(name), String(position ?? '').toUpperCase())
}

const MARKET_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

/**
 * The preseason market from `data/nfl-adp-multiplatform.csv` (two header rows; Name col 1, Team 2,
 * Pos 3, Sleeper ADP col 5). Names are canonicalised so they meet the draft's picks and the outcome
 * table on the same key.
 */
export function parseAdpCsv(raw: string, limit = 400): RecommendationPlayer[] {
  const rows = raw.replace(/^﻿/, '').split(/\r?\n/).slice(2)
  const out: RecommendationPlayer[] = []
  const seen = new Set<string>()
  for (const line of rows) {
    const c = line.split(',')
    const position = c[3]?.trim().toUpperCase()
    const adp = Number(c[5])
    const name = backtestName(c[1])
    if (!name || !position || !MARKET_POSITIONS.has(position) || !Number.isFinite(adp) || adp <= 0) continue
    const key = replayKey(name, position)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, team: c[2]?.trim() || null, position, adp })
  }
  return out.sort((a, b) => (a.adp as number) - (b.adp as number)).slice(0, limit)
}

export type PlayerIdRow = {
  id: string
  externalId: string | null
  sleeperId: string | null
  source: string | null
  name: string
  position: string | null
}

/** id → backtestKey, for one identifier space. Ids that name two different players are dropped. */
export type IdSpace = { name: string; byId: Map<string, string>; conflicts: number }

/**
 * Every identifier space `SportsPlayer` offers: its own `id`, `sleeperId`, and `externalId` per
 * `source` (externalIds from different sources can collide, so they are never pooled).
 */
export function buildIdSpaces(rows: readonly PlayerIdRow[]): IdSpace[] {
  const spaces = new Map<string, Map<string, string | null>>()
  const put = (space: string, id: string | null | undefined, key: string) => {
    const k = String(id ?? '').trim()
    if (!k) return
    let m = spaces.get(space)
    if (!m) spaces.set(space, (m = new Map()))
    const prev = m.get(k)
    if (prev === undefined) m.set(k, key)
    else if (prev !== key) m.set(k, null)
  }
  for (const r of rows) {
    if (!r.position) continue
    const key = backtestKey(r.name, r.position)
    put('id', r.id, key)
    put('sleeperId', r.sleeperId, key)
    put(`externalId:${r.source ?? 'unknown'}`, r.externalId, key)
  }
  return [...spaces].map(([name, m]) => {
    const byId = new Map<string, string>()
    let conflicts = 0
    for (const [id, key] of m) {
      if (key === null) conflicts++
      else byId.set(id, key)
    }
    return { name, byId, conflicts }
  })
}

export type IdSpaceChoice = { space: IdSpace | null; matched: number; total: number; rates: Array<{ name: string; matched: number }> }

/** The space that places the most of `ids` (distinct). Reported in full so a wrong guess is visible. */
export function chooseIdSpace(spaces: readonly IdSpace[], ids: Iterable<string>): IdSpaceChoice {
  const distinct = [...new Set([...ids].map((i) => String(i).trim()).filter(Boolean))]
  const rates = spaces
    .map((s) => ({ name: s.name, matched: distinct.filter((id) => s.byId.has(id)).length }))
    .sort((a, b) => b.matched - a.matched)
  const best = rates[0]
  const space = best && best.matched > 0 ? spaces.find((s) => s.name === best.name) ?? null : null
  return { space, matched: best?.matched ?? 0, total: distinct.length, rates }
}

export type WeeklyScoreRow = { playerId: string; week: number; fantasyPts: number }

/**
 * key → week → points. When one player appears under two ids in the same week, the larger value is
 * kept rather than the sum — a duplicate row must not double a player's season.
 */
export function weeklyByKey(rows: readonly WeeklyScoreRow[], space: IdSpace | null) {
  const byKey = new Map<string, Map<number, number>>()
  let unmatchedRows = 0
  for (const r of rows) {
    const key = space?.byId.get(String(r.playerId).trim())
    if (!key) {
      unmatchedRows++
      continue
    }
    let weeks = byKey.get(key)
    if (!weeks) byKey.set(key, (weeks = new Map()))
    const pts = Number(r.fantasyPts) || 0
    weeks.set(r.week, Math.max(weeks.get(r.week) ?? Number.NEGATIVE_INFINITY, pts))
  }
  return { byKey, unmatchedRows }
}

/**
 * Points over [fromWeek, throughWeek]. A player the season has scored at all gets 0 for weeks he has
 * no row (out, inactive); a player never seen is ABSENT from the table, so the replay reads his
 * outcome as unknown rather than as a zero nobody measured.
 */
export function windowPoints(byKey: ReadonlyMap<string, ReadonlyMap<number, number>>, fromWeek: number, throughWeek: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, weeks] of byKey) {
    let sum = 0
    for (const [week, pts] of weeks) if (week >= fromWeek && week <= throughWeek) sum += pts
    out.set(key, Math.round(sum * 10) / 10)
  }
  return out
}

/** Midnight UTC on the day of week `week`'s first game — a cutoff no earlier than any kickoff that week. */
export function weekKickoff(seasonOpener: Date, week: number): Date {
  return new Date(seasonOpener.getTime() + (week - 1) * 7 * 86_400_000)
}

/** The first week whose games had not started when the draft began: nothing from it was knowable. */
export function firstUnplayedWeek(seasonOpener: Date, draftStart: Date, maxWeek = 18): number | null {
  for (let w = 1; w <= maxWeek; w++) if (weekKickoff(seasonOpener, w).getTime() >= draftStart.getTime()) return w
  return null
}

export type ProjectionRow = {
  playerId: string
  week: number
  projectedPoints: number
  fetchedAt: Date
  source: string
  stats: unknown
}

export type ProjectionPolicy = 'strict' | 'window'

/**
 * Pre-draft season projections for one draft, as backtestKey → points (the weekly line × 17, the
 * same scale for every player, which is all replacement value needs).
 *
 * The look-ahead rule is the whole point, so the cutoff is explicit:
 *   - `strict`: the line was written before the draft started — exactly what the room could see.
 *   - `window`: the line was written before the judged window's first kickoff. It may know a few days
 *     of news the room did not, but nothing about any game being scored. Reported separately so a
 *     result that only holds under `window` is visibly weaker.
 * `FantasyProjection` rows are upserted in place, so a line refreshed after the cutoff is REJECTED,
 * never used at its newer value; those are counted as `leaked`.
 */
export function preDraftProjections(args: {
  rows: readonly ProjectionRow[]
  week: number
  cutoff: Date
  space: IdSpace | null
}): { byKey: Map<string, number>; usable: number; leaked: number; unmatched: number } {
  const byKey = new Map<string, number>()
  let usable = 0
  let leaked = 0
  let unmatched = 0
  for (const r of args.rows) {
    if (r.week !== args.week) continue
    if (!(r.fetchedAt.getTime() < args.cutoff.getTime())) {
      leaked++
      continue
    }
    const stats = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>
    const fromStats =
      typeof stats.name === 'string' && typeof stats.position === 'string' ? backtestKey(stats.name, stats.position) : null
    const key = args.space?.byId.get(String(r.playerId).trim()) ?? fromStats
    if (!key) {
      unmatched++
      continue
    }
    const pts = Number(r.projectedPoints)
    if (!Number.isFinite(pts) || pts <= 0) continue
    usable++
    byKey.set(key, Math.round(pts * 17 * 10) / 10)
  }
  return { byKey, usable, leaked, unmatched }
}

/** The market a draft saw: preseason ADP, plus pre-draft projections where policy allows them. */
export function marketWithProjections(market: readonly RecommendationPlayer[], projections: ReadonlyMap<string, number>): RecommendationPlayer[] {
  return market.map((p) => ({ ...p, projectedPoints: projections.get(replayKey(p.name, p.position)) ?? null }))
}
