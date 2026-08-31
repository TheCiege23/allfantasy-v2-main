'use client'

import { useState } from 'react'
import type { Performance, TopPerformers } from '@/lib/tournament/topPerformers'
import { formatPoints } from '@/lib/tournament/standingsExport'

/**
 * The week's best performances, for the commissioner's write-up.
 *
 * ⚠ "NOT COLLECTED YET" IS SAID OUT LOUD. An empty leaderboard and an uningested
 * week render identically as nothing, and only one of them means somebody has to
 * go and run the sweep.
 */

function rowsToTsv(rows: Performance[], heading: string): string {
  const lines = [heading, ['RANK', 'Player', 'Pos', 'Pts', 'Manager', 'League'].join('\t')]
  rows.forEach((r, i) => {
    lines.push(
      [
        String(i + 1),
        r.playerName ?? `(unknown player ${r.playerId})`,
        r.position ?? '',
        formatPoints(r.points),
        r.managerName,
        r.leagueName,
      ].join('\t'),
    )
  })
  return lines.join('\n')
}

function PerformanceTable({ rows }: { rows: Performance[] }) {
  if (rows.length === 0) return <p className="af-th-linknote">Nothing here for this week.</p>
  return (
    <div className="af-th-scroll">
      <table className="af-th-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col">Pts</th>
            <th scope="col">Manager</th>
            <th scope="col">League</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.playerId}-${r.managerName}`}>
              <td>{i + 1}</td>
              <td>
                {/* ⚠ An unresolved player shows as unknown rather than as a raw
                    id dressed up as a name — the gap is in our player table. */}
                {r.playerName ?? <span className="af-th-linknote">unknown ({r.playerId})</span>}
                {r.position ? <span className="af-th-linknote"> {r.position}</span> : null}
              </td>
              <td>{formatPoints(r.points)}</td>
              <td>{r.managerName}</td>
              <td>{r.leagueName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TopPerformersPanel({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<TopPerformers | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/tournament/${encodeURIComponent(tournamentId)}/top-performers`,
      )
      const body = (await res.json()) as TopPerformers & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not read the week')
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the week')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (!data) return
    const text = [
      rowsToTsv(data.topStarters, `TOP PERFORMERS — WEEK ${data.week}`),
      '',
      rowsToTsv(data.topBench, `LEFT ON THE BENCH — WEEK ${data.week}`),
    ].join('\n')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      /* The tables are on screen and selectable — that is the fallback. */
    }
  }

  return (
    <section className="af-th-league">
      <h2 className="af-th-league-name">Players of the week</h2>

      <div className="af-th-actions">
        <button type="button" className="af-th-linkbtn" disabled={loading} onClick={load}>
          {loading ? 'Reading…' : data ? 'Refresh' : 'Show the week'}
        </button>
        {data ? (
          <button type="button" className="af-th-linkbtn" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy both tables'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="af-th-note">
            Week {data.week} — scored by each league&apos;s own settings, as published by the host
            platform.
          </p>

          <div className="af-th-paste">
            <div className="af-th-paste-head">
              <strong>Top performers</strong>
              <span className="af-th-linknote">started, so these counted</span>
            </div>
            <PerformanceTable rows={data.topStarters} />
          </div>

          <div className="af-th-paste">
            <div className="af-th-paste-head">
              <strong>Left on the bench</strong>
              <span className="af-th-linknote">the week&apos;s regrets</span>
            </div>
            <PerformanceTable rows={data.topBench} />
          </div>

          {/*
            ⚠ A LEAGUE WITH NOTHING INGESTED IS NOT A LEAGUE WHERE NOBODY SCORED.
            Left unsaid, this table would quietly describe a subset of the
            tournament while looking like all of it.
          */}
          {data.leaguesMissingData.length > 0 ? (
            <p className="af-th-warn" role="alert">
              No scores collected for {data.leaguesMissingData.join(', ')} this week — these tables
              cover the rest of the tournament only.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
