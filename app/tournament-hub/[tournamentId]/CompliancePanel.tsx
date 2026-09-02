'use client'

import { useState } from 'react'
import type { ComplianceReport, Violation } from '@/lib/tournament/rosterCompliance'

/**
 * Roster rules, checked across every league at once.
 *
 * 🛑 NOBODY CHECKS TWENTY LEAGUES BY HAND, so a uniform rule — a roster cap, no
 * IR — exists on paper and is never enforced. This is the sweep that makes it
 * real, and it stops at telling the commissioner: it never edits a roster and
 * never penalises anybody, because on an imported league the fix has to happen
 * on the host platform anyway.
 */

function violationLine(v: Violation): string {
  return `@${v.displayName} — ${v.detail}`
}

export function CompliancePanel({ tournamentId }: { tournamentId: string }) {
  const [report, setReport] = useState<ComplianceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function check() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/compliance`)
      const body = (await res.json()) as ComplianceReport & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not check the rosters')
      setReport(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the rosters')
    } finally {
      setLoading(false)
    }
  }

  const byLeague = new Map<string, Violation[]>()
  for (const v of report?.violations ?? []) {
    const arr = byLeague.get(v.leagueName) ?? []
    arr.push(v)
    byLeague.set(v.leagueName, arr)
  }

  async function copyFor(leagueName: string, list: Violation[]) {
    const text = list.map(violationLine).join('\n')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      setCopied(leagueName)
      window.setTimeout(() => setCopied(null), 2400)
    } catch {
      /* The rows are on screen and selectable — that is the fallback. */
    }
  }

  return (
    <section className="af-th-league">
      <h2 className="af-th-league-name">Roster rules</h2>

      <div className="af-th-actions">
        <button type="button" className="af-th-linkbtn" disabled={loading} onClick={check}>
          {loading ? 'Checking…' : report ? 'Check again' : 'Check every league'}
        </button>
      </div>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <>
          <p className="af-th-note">
            Round {report.roundNumber} — limit {report.rosterLimit} players
            {report.irAllowed ? ', IR allowed' : ', no IR'}. Checked {report.checkedManagers}{' '}
            {report.checkedManagers === 1 ? 'roster' : 'rosters'}.
          </p>

          {report.violations.length === 0 ? (
            <p className="af-th-note">Nothing over the limit, and no IR in use.</p>
          ) : null}

          {[...byLeague.entries()].map(([leagueName, list]) => (
            <div key={leagueName} className="af-th-paste">
              <div className="af-th-paste-head">
                <strong>{leagueName}</strong>
                <span className="af-th-linknote">
                  {list.length} to look at
                </span>
                <button
                  type="button"
                  className="af-th-linkbtn"
                  onClick={() => copyFor(leagueName, list)}
                >
                  {copied === leagueName ? '✓ Copied' : 'Copy with @handles'}
                </button>
              </div>
              {list.map((v) => (
                <p key={`${v.displayName}-${v.kind}`} className="af-th-pick-meta">
                  <strong>{v.displayName}</strong> — {v.detail}
                </p>
              ))}
            </div>
          ))}

          {/*
            ⚠ LEAGUES WITH NO ROSTERS AT ALL ARE A SYNC PROBLEM, NOT A RULE ONE,
            and they must not read as "this league is clean". A league nobody can
            see is the one most likely to be hiding something.
          */}
          {report.leaguesWithoutRosters.length > 0 ? (
            <p className="af-th-warn" role="alert">
              No rosters on file for {report.leaguesWithoutRosters.join(', ')} — those leagues were
              not checked at all. Re-sync them before reading this as a clean sweep.
            </p>
          ) : null}

          {/*
            🛑 A RULE THIS CANNOT SEE IS NAMED, NOT OMITTED. Silence would read as
            "no trade violations", which is a claim there is no evidence for.
          */}
          {report.unenforceable.map((u) => (
            <p key={u.rule} className="af-th-linknote af-th-linknote--soft">
              ⚠ <strong>{u.rule}</strong> cannot be checked here. {u.reason}
            </p>
          ))}
        </>
      ) : null}
    </section>
  )
}
