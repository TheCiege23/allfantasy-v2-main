'use client'

import { useState } from 'react'
import type { CareerSeasonRow } from '@/lib/core-app/careerModel'
import type { RankPoint } from '@/lib/core-app/careerPeers'

/**
 * Career progression (brief item 6): record, points, rank, roster value and
 * titles over time, one metric at a time on one axis.
 *
 * ⚠ ONE METRIC PER CHART, NOT FIVE LINES ON TWO AXES. Win rate is a share,
 * points are a per-game total, rank runs the wrong way and titles are a count;
 * overlaying them would make the eye compare slopes that mean nothing against
 * each other. The switch keeps each on a scale that fits it.
 *
 * ⚠ ROSTER VALUE IS A TAB THAT SAYS IT IS NOT STORED. Measured 2026-09-16:
 * `PlayerValueSnapshot` is per player from mid-2026, and the rankings snapshots
 * hold normalised scores from 2026-09-16. Nothing records a team's value at the
 * end of 2021. Drawing today's value back across nine seasons would be a line
 * nobody's roster ever had.
 *
 * ⚠ A SEASON WITH NO VALUE IS A GAP IN THE LINE, never a zero on it.
 */

type MetricKey = 'winRate' | 'ppg' | 'titles' | 'playoffs' | 'rank' | 'value'

type Point = { season: number; value: number | null; label: string; title: boolean }

type MetricDef = {
  key: MetricKey
  label: string
  /** Lower is better — rank. Flips the axis so "up" always means better. */
  invert?: boolean
  points: Point[]
  caption: string
  unavailable?: string
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export function buildProgressMetrics(seasons: CareerSeasonRow[], rank: RankPoint[] | null): MetricDef[] {
  const rankBy = new Map((rank ?? []).map((r) => [r.season, r]))
  const title = (s: CareerSeasonRow) => s.championships > 0
  return [
    {
      key: 'winRate',
      label: 'Win %',
      points: seasons.map((s) => ({
        season: s.season,
        value: s.winRate,
        label: s.winRate == null ? 'no games' : `${pct(s.winRate)} · ${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`,
        title: title(s),
      })),
      caption: 'Regular-season win rate across every league finished that year, weighted by games.',
    },
    {
      key: 'ppg',
      label: 'Points / game',
      points: seasons.map((s) => ({
        season: s.season,
        value: s.pointsPerGame,
        label: s.pointsPerGame == null ? 'no points recorded' : `${s.pointsPerGame.toFixed(1)} per game over ${s.pointsGames} games`,
        title: title(s),
      })),
      caption: 'Points per game in the league-seasons that recorded points. Scoring settings differ between leagues, so compare a season with its neighbours, not with another manager.',
    },
    {
      key: 'titles',
      label: 'Titles',
      points: seasons.map((s) => ({
        season: s.season,
        value: s.titlesToDate,
        label: `${s.titlesToDate} by the end of ${s.season}${s.championships ? ` (+${s.championships})` : ''}`,
        title: title(s),
      })),
      caption: 'Championships won, running total.',
    },
    {
      key: 'playoffs',
      label: 'Playoff rate',
      points: seasons.map((s) => {
        const v = s.playoffKnownCount > 0 ? s.playoffAppearances / s.playoffKnownCount : null
        return {
          season: s.season,
          value: v,
          label: v == null ? 'no league recorded its cut' : `${pct(v)} · ${s.playoffAppearances} of ${s.playoffKnownCount}`,
          title: title(s),
        }
      }),
      caption: 'Share of finished league-seasons with a known playoff cut where you made the playoffs.',
    },
    {
      key: 'rank',
      label: 'AF rank',
      invert: true,
      points: seasons.map((s) => {
        const r = rankBy.get(s.season)
        return {
          season: s.season,
          value: r?.rank ?? null,
          label: r?.rank != null ? `#${r.rank} of ${r.of}` : 'not ranked with seasons up to here',
          title: title(s),
        }
      }),
      caption:
        'Your Overall rank among AllFantasy managers, using results up to the end of each season. Recomputed from today’s records — daily rank snapshots only began on 2026-09-16.',
      unavailable:
        rank == null
          ? 'Rank history is on the Progress tab.'
          : rank.length === 0
            ? 'Your career has not been ranked yet, so there is no rank to trace.'
            : undefined,
    },
    {
      key: 'value',
      label: 'Roster value',
      points: [],
      caption: '',
      unavailable:
        'Not stored per season. Player values are only kept from mid-2026 and team values are not snapshotted, so a roster-value line would be today’s value drawn backwards.',
    },
  ]
}

export function CareerProgressChart({
  seasons,
  rank,
  initial = 'winRate',
}: {
  seasons: CareerSeasonRow[]
  rank: RankPoint[] | null
  initial?: MetricKey
}) {
  const [active, setActive] = useState<MetricKey>(initial)
  const metrics = buildProgressMetrics(seasons, rank)
  const m = metrics.find((x) => x.key === active) ?? metrics[0]
  const plotted = m.points.filter((p) => p.value != null)

  return (
    <div className="af-crx-chart">
      <div className="af-crx-seg" role="tablist" aria-label="Progression metric">
        {metrics.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === m.key}
            className="af-crx-seg-btn"
            onClick={() => setActive(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>
      {m.unavailable ? (
        <p className="af-c13-none">{m.unavailable}</p>
      ) : plotted.length < 2 ? (
        <p className="af-cr-caption">
          {plotted.length === 0
            ? 'Nothing to draw for this metric yet.'
            : 'One season so far — a line needs at least two to mean anything.'}
        </p>
      ) : (
        <LineChart metric={m} />
      )}
      {!m.unavailable && m.caption ? <p className="af-cr-caption">{m.caption}</p> : null}
      {!m.unavailable && plotted.length >= 2 ? (
        <table className="af-crx-sr">
          <caption>{m.label} by season</caption>
          <tbody>
            {m.points.map((p) => (
              <tr key={p.season}>
                <th scope="row">{p.season}</th>
                <td>{p.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function LineChart({ metric }: { metric: MetricDef }) {
  const X0 = 44
  const X1 = 684
  const TOP = 16
  const BASE = 168
  const pts = metric.points
  const values = pts.map((p) => p.value).filter((v): v is number => v != null)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (metric.key === 'winRate' || metric.key === 'playoffs') {
    lo = Math.min(lo, 0.4)
    hi = Math.max(hi, 0.6)
  }
  if (metric.key === 'titles') lo = 0
  if (metric.key === 'rank') {
    lo = 1
    hi = Math.max(hi, 2)
  }
  if (hi - lo < 1e-9) hi = lo + 1
  const pad = (hi - lo) * 0.08
  const min = metric.key === 'titles' || metric.key === 'rank' ? lo : lo - pad
  const max = hi + pad
  const step = pts.length > 1 ? (X1 - X0) / (pts.length - 1) : 0
  const y = (v: number) => {
    const t = (v - min) / (max - min)
    return metric.invert ? TOP + t * (BASE - TOP) : BASE - t * (BASE - TOP)
  }
  const fmt = (v: number) =>
    metric.key === 'winRate' || metric.key === 'playoffs'
      ? `${Math.round(v * 100)}%`
      : metric.key === 'rank'
        ? `#${Math.round(v)}`
        : metric.key === 'titles'
          ? String(Math.round(v))
          : v.toFixed(0)

  // Segments break at a gap rather than bridging it.
  const segments: string[] = []
  let current = ''
  pts.forEach((p, i) => {
    if (p.value == null) {
      if (current) segments.push(current)
      current = ''
      return
    }
    const x = X0 + i * step
    current += `${current ? 'L' : 'M'}${x.toFixed(1)},${y(p.value).toFixed(1)} `
  })
  if (current) segments.push(current)

  const ticks = [min, (min + max) / 2, max]

  return (
    <svg className="af-cr-arc" viewBox="0 0 700 196" preserveAspectRatio="none" role="img" aria-label={`${metric.label} by season`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X0} x2={X1} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={X0 - 8} y={y(t) + 3} textAnchor="end" fill="var(--faint)" style={{ font: "500 9px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace" }}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {pts.map((p, i) =>
        p.value == null ? null : (
          <g key={p.season}>
            <circle
              cx={X0 + i * step}
              cy={y(p.value)}
              r={p.title ? 6.5 : 4}
              fill={p.title ? 'var(--warn)' : 'var(--bg)'}
              stroke={p.title ? 'var(--warn)' : 'var(--accent)'}
              strokeWidth={p.title ? 0 : 2.5}
            />
            <circle cx={X0 + i * step} cy={y(p.value)} r={12} fill="transparent">
              <title>{`${p.season}: ${p.label}${p.title ? ' · title season' : ''}`}</title>
            </circle>
          </g>
        ),
      )}
      {pts.map((p, i) => (
        <text
          key={`x${p.season}`}
          x={X0 + i * step}
          y={188}
          textAnchor="middle"
          fill={p.title ? 'var(--warn)' : 'var(--faint)'}
          style={{ font: `${p.title ? 700 : 500} 10px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace` }}
        >
          {String(p.season).slice(2)}
        </text>
      ))}
    </svg>
  )
}
