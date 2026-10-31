'use client'

import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import type { LineupIntegrityReport } from '@/lib/lineup-integrity/lineupIntegrityService'

/**
 * Lineup-integrity card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 7), on the Commissioner Hub.
 * Evidence, not a verdict: it lists lineups that could not score so the commissioner can decide.
 */

type View = LineupIntegrityReport & { entitled: boolean }

type M = typeof commissionerScreensMessages.en

const UNSUPPORTED: Record<string, (m: M) => string> = {
  unsupported_platform: (m) => m.integrityUnsupportedPlatform,
  not_nfl: (m) => m.integrityNotNfl,
  best_ball: (m) => m.integrityBestBall,
  no_lineup_rules: (m) => m.integrityNoLineupRules,
}

export function LineupIntegrity({ leagueId }: { leagueId: string }) {
  const m = useMessages(commissionerScreensMessages)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Never rejects: a failed read is a line on the card, not an unhandled error on the hub.
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/lineup-integrity`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!live) return
        if (res.ok && body) setView(body as View)
        else setError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [leagueId])

  if (error) return <p className="af-ch-muted">{error}</p>
  if (!view) return <p className="af-ch-muted">{m.commonLoading}</p>
  if (!view.supported) {
    const copy = UNSUPPORTED[view.reason]
    return <p className="af-ch-recipe-desc">{copy ? copy(m) : view.reason}</p>
  }

  const flagged = view.findings.filter((f) => f.flagged)
  const soft = view.findings.filter((f) => !f.flagged)
  return (
    <div className="af-ch-recipes" data-testid="lineup-integrity">
      <p className="af-ch-recipe-desc">
        {view.latestWeek == null
          ? m.integrityNoFinishedWeek
          : view.fullSeason
            ? m.integritySeasonWeeks(view.season, view.weeks[0], view.latestWeek)
            : m.integrityLatestWeek(view.latestWeek)}
      </p>

      {flagged.length === 0 && view.latestWeek != null && (
        <p className="af-ch-recipe-desc">{m.integrityAllClear}</p>
      )}
      {flagged.length > 0 && (
        <ul className="af-ch-recipe-list">
          {flagged.map((f) => (
            <li key={`${f.rosterId}-${f.week}`} data-on="true">
              <p className="af-ch-recipe-desc">{f.text}</p>
            </li>
          ))}
        </ul>
      )}
      {soft.length > 0 && (
        <>
          <p className="af-ch-recipe-label" style={{ marginTop: 12 }}>{m.integrityLeads}</p>
          <ul className="af-ch-recipe-list">
            {soft.map((f) => (
              <li key={`soft-${f.rosterId}-${f.week}`}>
                <p className="af-ch-recipe-desc">{f.text}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.summary && view.summary.some((s) => s.weeksFlagged > 0) && (
        <table className="w-full text-sm" style={{ marginTop: 12 }}>
          <thead>
            <tr className="text-left text-white/60">
              <th>{m.integrityTeam}</th>
              <th>{m.integrityWeeksFlagged}</th>
              <th>{m.integrityEmptySlots}</th>
              <th>{m.integrityByeStarters}</th>
            </tr>
          </thead>
          <tbody>
            {view.summary
              .filter((s) => s.weeksFlagged > 0)
              .map((s) => (
                <tr key={s.rosterId}>
                  <td>{s.teamName}</td>
                  <td>
                    {s.weeksFlagged} / {s.weeksAudited}
                  </td>
                  <td>{s.emptySlots}</td>
                  <td>{s.byeStarts}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {!view.entitled && (
        <p className="af-ch-recipe-meta" style={{ marginTop: 8 }}>
          {m.integrityUpsell}
        </p>
      )}
      <p className="af-ch-recipe-meta" style={{ marginTop: 8 }}>{view.basis}</p>
    </div>
  )
}
