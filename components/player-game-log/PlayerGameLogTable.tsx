'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  formatGameLogValue,
  isGameLogSport,
  summarizeGameLog,
  type GameLogColumn,
  type GameLogValue,
} from '@/lib/player-game-log/gameLogColumns'
import { applyLayout, isDefaultLayout } from '@/lib/table-layout/statTableLayout'
import { ColumnsMenu } from '@/components/stat-table/ColumnsMenu'
import { useStatTableLayouts } from '@/components/stat-table/useStatTableLayouts'
import './af-game-log.css'

/**
 * Per-game log for the daily sports — the player card and the profile page's Game Log tab.
 *
 * Design rules, each one a complaint about Yahoo's late-2026 redesign:
 *   - date, opponent and FINAL SCORE are the pinned first column, so "what happened that night"
 *     is never a tap away;
 *   - columns are fixed per box group (skater / goalie, batting / pitching …) — never reordered by
 *     position — and time on ice / minutes is the first stat;
 *   - Last 5 / Last 10 / Season averages sit above the games (recent form without filtering);
 *   - no red/green cell colouring. A result is a letter, not a paint job;
 *   - fantasy points per game sit right after the score, scored on the manager's LEAGUE settings
 *     when the card is opened from a league (the route says which scoring it used). Only a game far
 *     from his own average is marked, with an arrow and words — never colour alone;
 *   - the header row stays frozen while the games scroll under it.
 */

type Row = {
  gameId: string
  date: string | null
  opponent: string | null
  home: boolean | null
  teamScore: number | null
  oppScore: number | null
  result: 'W' | 'L' | 'T' | null
  postseason: boolean
  played: boolean
  values: Record<string, GameLogValue>
  ratioInputs: Record<string, number>
  fantasyPoints?: number | null
}

export type GameLogScoring = { kind: 'league'; leagueName: string | null } | { kind: 'default' } | { kind: 'none' }

type Group = { group: string; label: string; columns: GameLogColumn[]; rows: Row[] }

export type PlayerGameLogPayload = {
  supported: boolean
  resolved?: boolean
  season: number | null
  seasons: number[]
  groups: Group[]
  scoring?: GameLogScoring
}
type Payload = PlayerGameLogPayload

export type PlayerGameLogKey =
  | { identityId: string }
  | { externalId: string; source?: string | null; sleeperId?: string | null }
  | { sleeperId: string }

/** Whose scoring the points use: a league's (the card was opened from one) and the player's position. */
export type GameLogScoringContext = { leagueId?: string | null; position?: string | null }

export function gameLogSupported(sport: string | null | undefined): boolean {
  return isGameLogSport(String(sport ?? '').toUpperCase())
}

/** The query both player-stat routes read (`resolveStatPlayerId` on the server). */
export function playerStatQuery(sport: string, playerKey: PlayerGameLogKey, season: number | null, ctx?: GameLogScoringContext): string {
  return gameLogQuery(sport, playerKey, season, ctx)
}

function gameLogQuery(sport: string, playerKey: PlayerGameLogKey, season: number | null, ctx?: GameLogScoringContext): string {
  const p = new URLSearchParams({ sport: sport.toUpperCase() })
  if ('identityId' in playerKey) p.set('identityId', playerKey.identityId)
  if ('externalId' in playerKey && playerKey.externalId) {
    p.set('externalId', playerKey.externalId)
    if (playerKey.source) p.set('source', playerKey.source)
  }
  if ('sleeperId' in playerKey && playerKey.sleeperId) p.set('sleeperId', playerKey.sleeperId)
  if (season != null) p.set('season', String(season))
  if (ctx?.leagueId) p.set('leagueId', ctx.leagueId)
  if (ctx?.position) p.set('position', ctx.position)
  return p.toString()
}

/** A response is only trusted when it has the shape this table renders; anything else is "no log". */
function asPayload(d: unknown): Payload | null {
  if (!d || typeof d !== 'object') return null
  const o = d as Partial<Payload>
  if (!Array.isArray(o.groups)) return null
  return {
    supported: o.supported !== false,
    resolved: o.resolved,
    season: typeof o.season === 'number' ? o.season : null,
    seasons: Array.isArray(o.seasons) ? o.seasons : [],
    groups: o.groups.filter((g) => g && Array.isArray(g.rows) && Array.isArray(g.columns)),
    scoring: o.scoring && typeof o.scoring === 'object' && 'kind' in o.scoring ? o.scoring : undefined,
  }
}

/**
 * Fetch a player's log once, for a caller that must know whether there is one before it shows a
 * place for it (the player card hides an empty tab). Null on any failure. Hand the result to the
 * table as `prefetched` so it is not requested twice.
 */
export async function fetchPlayerGameLog(
  sport: string,
  playerKey: PlayerGameLogKey,
  ctx?: GameLogScoringContext,
): Promise<PlayerGameLogPayload | null> {
  try {
    const r = await fetch(`/api/players/game-log?${gameLogQuery(sport, playerKey, null, ctx)}`)
    if (!r.ok) return null
    return asPayload(await r.json())
  } catch {
    return null
  }
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function seasonLabel(sport: string, season: number): string {
  // NHL / NBA / NCAAB / soccer seasons cross the new year; MLB's does not.
  return sport === 'MLB' ? String(season) : `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}

const COMPACT_ROWS = 10

/** Points, trimmed: 12.5 not 12.50, 3 not 3.00. */
function formatPoints(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return String(Math.round(v * 10) / 10)
}

/**
 * Far from his OWN average, in either direction. Deliberately rare: a mark on every cell is the
 * wall of red and green managers mocked. Needs five scored games before any game is called unusual.
 */
export function pointsMark(value: number | null | undefined, seasonAvg: number | null, scoredGames: number): 'high' | 'low' | null {
  if (value == null || seasonAvg == null || scoredGames < 5 || seasonAvg <= 0) return null
  if (value >= seasonAvg * 1.75 && value - seasonAvg >= 1) return 'high'
  if (value <= seasonAvg * 0.25) return 'low'
  return null
}

function scoringLabel(scoring: GameLogScoring | undefined): string {
  if (scoring?.kind === 'league') return scoring.leagueName ? `${scoring.leagueName} scoring` : 'your league’s scoring'
  return 'default scoring'
}

export default function PlayerGameLogTable({
  sport,
  playerKey,
  compact = false,
  playerName,
  prefetched,
  scoringContext,
}: {
  sport: string
  playerKey: PlayerGameLogKey
  /** Score each game on this league's settings (members only; the route falls back to defaults). */
  scoringContext?: GameLogScoringContext
  /** Player-card mode: core columns only and the last ten games, with a toggle for the rest. */
  compact?: boolean
  playerName?: string
  /** The current season's payload, already fetched by the caller (see `fetchPlayerGameLog`). */
  prefetched?: PlayerGameLogPayload | null
}) {
  const [season, setSeason] = useState<number | null>(null)
  const [data, setData] = useState<Payload | null>(prefetched ?? null)
  const [loading, setLoading] = useState(!prefetched)
  const [failed, setFailed] = useState(false)
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const leagueId = scoringContext?.leagueId ?? null
  const position = scoringContext?.position ?? null
  const query = useMemo(
    () => gameLogQuery(sport, playerKey, season, { leagueId, position }),
    [sport, playerKey, season, leagueId, position],
  )

  useEffect(() => {
    // The caller already holds the current season; only a season switch needs a request.
    if (prefetched && season == null) return
    let alive = true
    setLoading(true)
    setFailed(false)
    fetch(`/api/players/game-log?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (!alive) return
        const d = asPayload(json)
        if (!d) throw new Error('unexpected response')
        setData(d)
        setGroupKey((g) => (g && d.groups.some((x) => x.group === g) ? g : d.groups[0]?.group ?? null))
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // `prefetched` is read once, for the first season; it must not re-trigger the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const group = data?.groups.find((g) => g.group === groupKey) ?? data?.groups[0] ?? null
  // A manager's own column order / hidden columns (Columns menu), per sport and box group.
  const { layoutFor, density } = useStatTableLayouts()
  const tableId = group ? `gamelog:${sport.toUpperCase()}:${group.group}` : null
  const savedLayout = tableId ? layoutFor(tableId) : null
  const customLayout = !isDefaultLayout(savedLayout)
  const columns = useMemo(
    () =>
      !group
        ? []
        : customLayout
          ? applyLayout(group.columns, savedLayout) // the manager's choice wins over the card's short list
          : compact && !expanded
            ? group.columns.filter((c) => !c.compactHidden)
            : group.columns,
    [group, compact, expanded, customLayout, savedLayout],
  )

  const showPoints = !!group && group.rows.some((r) => r.fantasyPoints != null)
  const avgPoints = (rows: Row[]): number | null => {
    const pts = rows.map((r) => r.fantasyPoints).filter((v): v is number => v != null && Number.isFinite(v))
    return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null
  }
  const summaries = useMemo(() => {
    if (!group) return []
    const played = group.rows.filter((r) => r.played)
    const out: Array<{ label: string; values: Record<string, GameLogValue>; games: number; points: number | null }> = []
    if (played.length > 5) out.push({ label: 'Last 5', values: summarizeGameLog(group.columns, played.slice(0, 5)), games: 5, points: avgPoints(played.slice(0, 5)) })
    if (played.length > 10) out.push({ label: 'Last 10', values: summarizeGameLog(group.columns, played.slice(0, 10)), games: 10, points: avgPoints(played.slice(0, 10)) })
    if (played.length > 0) out.push({ label: 'Season', values: summarizeGameLog(group.columns, played), games: played.length, points: avgPoints(played) })
    return out
  }, [group])
  const seasonAvgPoints = group ? avgPoints(group.rows.filter((r) => r.played)) : null
  const scoredGames = group ? group.rows.filter((r) => r.played && r.fantasyPoints != null).length : 0

  if (loading && !data) {
    return (
      <div className="af-gl" aria-busy="true">
        <div className="af-gl-skel" />
        <div className="af-gl-skel" />
        <div className="af-gl-skel" />
      </div>
    )
  }
  if (failed) return <p className="af-gl-empty">The game log could not be loaded right now.</p>
  if (!data || !group) {
    return (
      <p className="af-gl-empty">
        {data?.resolved === false
          ? 'We have not linked this player to box scores yet.'
          : `No games logged${playerName ? ` for ${playerName}` : ''} this season yet.`}
      </p>
    )
  }

  const visibleRows = compact && !expanded ? group.rows.slice(0, COMPACT_ROWS) : group.rows
  const sportUpper = sport.toUpperCase()

  return (
    <div className="af-gl" data-testid="af-game-log" data-density={density}>
      <div className="af-gl-bar">
          {data.groups.length > 1 && (
            <div className="af-gl-tabs" role="tablist" aria-label="Stat group">
              {data.groups.map((g) => (
                <button
                  key={g.group}
                  type="button"
                  role="tab"
                  aria-selected={g.group === group.group}
                  className="af-gl-tab"
                  onClick={() => setGroupKey(g.group)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
          {!compact && data.seasons.length > 1 && (
            <select
              className="af-gl-season"
              aria-label="Season"
              value={data.season ?? ''}
              onChange={(e) => setSeason(Number(e.target.value))}
            >
              {data.seasons.map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(sportUpper, s)}
                </option>
              ))}
            </select>
          )}
          {tableId ? <ColumnsMenu tableId={tableId} columns={group.columns} /> : null}
      </div>
      {showPoints ? (
        <p className="af-gl-note" data-testid="af-game-log-scoring">
          FPts: {scoringLabel(data.scoring)}. <span aria-hidden="true">▲▼</span> marks a game far from his average.
        </p>
      ) : null}

      <div className="af-gl-scroll">
        <table className="af-gl-table">
          <thead>
            <tr>
              <th scope="col" className="af-gl-pin">
                {data.season != null ? seasonLabel(sportUpper, data.season) : 'Game'}
              </th>
              {showPoints ? (
                <th scope="col" className="af-gl-fpts" title={`Fantasy points, ${scoringLabel(data.scoring)}`}>
                  <abbr title={`Fantasy points, ${scoringLabel(data.scoring)}`}>FPts</abbr>
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} scope="col" title={c.title}>
                  <abbr title={c.title}>{c.label}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          {summaries.length > 0 && (
            <tbody className="af-gl-summary">
              {summaries.map((s) => (
                <tr key={s.label}>
                  <th scope="row" className="af-gl-pin">
                    {s.label} <span className="af-gl-sub">avg</span>
                  </th>
                  {showPoints ? <td className="af-gl-fpts">{formatPoints(s.points)}</td> : null}
                  {columns.map((c) => (
                    <td key={c.key}>{formatGameLogValue(c, s.values[c.key] ?? null, true)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.gameId} className={r.played ? undefined : 'af-gl-dnp'}>
                <th scope="row" className="af-gl-pin">
                  <span className="af-gl-date">{shortDate(r.date)}</span>
                  <span className="af-gl-opp">
                    {r.home === false ? '@' : 'vs'} {r.opponent ?? '—'}
                    {r.postseason ? <span className="af-gl-sub"> PO</span> : null}
                  </span>
                  {r.teamScore != null && r.oppScore != null ? (
                    <span className="af-gl-score">
                      {r.result ? <b>{r.result}</b> : null} {r.teamScore}-{r.oppScore}
                    </span>
                  ) : null}
                </th>
                {r.played && showPoints ? <PointsCell value={r.fantasyPoints} mark={pointsMark(r.fantasyPoints, seasonAvgPoints, scoredGames)} /> : null}
                {r.played ? (
                  columns.map((c) => <td key={c.key}>{formatGameLogValue(c, r.values[c.key] ?? null)}</td>)
                ) : (
                  <td colSpan={columns.length + (showPoints ? 1 : 0)} className="af-gl-dnp-cell">
                    Did not play
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {compact && (group.rows.length > COMPACT_ROWS || (!customLayout && group.columns.length > columns.length) || expanded) && (
        <button type="button" className="af-gl-more" onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Show less' : customLayout ? `Show all ${group.rows.length} games` : `Show all ${group.rows.length} games and stats`}
        </button>
      )}
    </div>
  )
}

function PointsCell({ value, mark }: { value: number | null | undefined; mark: 'high' | 'low' | null }) {
  return (
    <td className="af-gl-fpts" data-mark={mark ?? undefined}>
      {mark === 'high' ? <span className="af-gl-mark" aria-hidden="true">▲</span> : null}
      {mark === 'low' ? <span className="af-gl-mark" aria-hidden="true">▼</span> : null}
      {formatPoints(value)}
      {mark ? <span className="af-gl-sr">{mark === 'high' ? ' (well above his average)' : ' (well below his average)'}</span> : null}
    </td>
  )
}
