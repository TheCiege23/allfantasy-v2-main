'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RedraftPlan } from '@/lib/tournament/redraftPlan'
import { buildAdvancerList, buildRedraftExport, formatPoints, formatRecord } from '@/lib/tournament/standingsExport'

/**
 * Where the advancing managers go next.
 *
 * 🛑 FOR AN IMPORTED TOURNAMENT THE PLAN *IS* THE FEATURE. AllFantasy cannot
 * create a league on Sleeper, so "running the redraft" means the commissioner
 * building the new leagues by hand and inviting the right people to each. What
 * saves them the evening is an accurate, ordered, copyable list — not a button
 * that cannot do anything.
 */

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="af-th-linkbtn"
      onClick={async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
          await navigator.clipboard.writeText(getText())
          setState('copied')
        } catch {
          setState('failed')
        }
        window.setTimeout(() => setState('idle'), 2400)
      }}
    >
      {state === 'copied' ? '✓ Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  )
}

type CommittedSlot = { tournamentLeagueId: string; name: string; teamSlots: number }

export function RedraftPanel({ tournamentId }: { tournamentId: string }) {
  const router = useRouter()
  const [plan, setPlan] = useState<RedraftPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState<{ roundNumber: number; slots: CommittedSlot[] } | null>(
    null,
  )

  async function commit() {
    setCommitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/redraft-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit' }),
      })
      const body = (await res.json()) as {
        error?: string
        roundNumber?: number
        slots?: CommittedSlot[]
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not record the redraft')
      setCommitted({ roundNumber: body.roundNumber ?? 0, slots: body.slots ?? [] })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the redraft')
    } finally {
      setCommitting(false)
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/redraft-plan`)
      const body = (await res.json()) as RedraftPlan & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not work out the redraft')
      setPlan(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not work out the redraft')
    } finally {
      setLoading(false)
    }
  }

  const blocking = (plan?.blockers ?? []).filter((b) => b.severity === 'blocker')

  return (
    <section className="af-th-league">
      <h2 className="af-th-league-name">The redraft</h2>

      <p className="af-th-note">
        Who goes into which new league, seeded so no league collects a whole tier. The same
        assignment every time — so what you see here is what you can build on the host platform.
      </p>

      <div className="af-th-actions">
        <button type="button" className="af-th-linkbtn" disabled={loading} onClick={load}>
          {loading ? 'Working it out…' : plan ? 'Refresh' : 'Work out the redraft'}
        </button>
      </div>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}

      {plan?.blockers.map((b, i) => (
        <p
          key={`${b.code}-${i}`}
          className={b.severity === 'blocker' ? 'af-th-warn' : 'af-th-linknote af-th-linknote--soft'}
          role={b.severity === 'blocker' ? 'alert' : undefined}
        >
          {b.severity === 'blocker' ? '' : '⚠ '}
          {b.message}
        </p>
      ))}

      {plan && blocking.length === 0
        ? plan.conferences.map((conf) => (
            <div key={conf.conferenceId} className="af-th-paste">
              <div className="af-th-paste-head">
                <strong>{conf.conferenceName}</strong>
                <span className="af-th-linknote">
                  {conf.advancerCount} advancing into {conf.leagues.length}{' '}
                  {conf.leagues.length === 1 ? 'league' : 'leagues'}
                </span>
                <CopyButton
                  label="Copy the league sheets"
                  getText={() => buildRedraftExport(conf.conferenceName, conf.leagues)}
                />
                {/*
                  ⚠ A SECOND SHAPE, NOT A DUPLICATE. Inviting people is per league;
                  announcing who advanced is one list — pasting eight tables into a
                  chat makes 128 people hunt for their own name.
                */}
                <CopyButton
                  label="Copy one flat list"
                  getText={() => buildAdvancerList(conf.leagues)}
                />
              </div>

              {conf.leagues.map((league) => (
                <div key={league.name}>
                  <p className="af-th-pick-meta">
                    <strong>{league.name}</strong> — {league.managers.length} teams
                  </p>
                  <div className="af-th-scroll">
                    <table className="af-th-table">
                      <thead>
                        <tr>
                          <th scope="col">Seed</th>
                          <th scope="col">Manager</th>
                          <th scope="col">From</th>
                          <th scope="col">W/L</th>
                          <th scope="col">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {league.managers.map((m) => (
                          <tr key={m.participantId}>
                            <td>{m.seed}</td>
                            <td>{m.displayName}</td>
                            <td>{m.fromLeague}</td>
                            <td>{formatRecord(m.wins, m.losses, 0)}</td>
                            <td>{formatPoints(m.pointsFor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))
        : null}

      {/*
        ⚠ SAID PLAINLY RATHER THAN IMPLIED BY THE ABSENCE OF A BUTTON. A
        commissioner who reads "the redraft" and finds no way to run it should
        know that is the platform's limit, not a missing feature they should keep
        looking for.
      */}
      {plan && blocking.length === 0 && !committed ? (
        <>
          <p className="af-th-linknote">
            AllFantasy cannot create leagues on the host platform, so building them is yours to do.
            Recording the assignment first freezes it — the standings can move afterwards without
            the sheet you worked from changing under you.
          </p>
          <div className="af-th-actions">
            <button type="button" className="af-th-copy" disabled={committing} onClick={commit}>
              {committing ? 'Recording…' : 'Record this assignment'}
            </button>
          </div>
        </>
      ) : null}

      {committed ? (
        <div className="af-th-paste">
          <div className="af-th-paste-head">
            <strong>Recorded for round {committed.roundNumber}</strong>
            <span className="af-th-linknote">{committed.slots.length} leagues to build</span>
          </div>
          <p className="af-th-pick-meta">
            Build these on the host platform, import each one, then come back and attach it to its
            slot. The standings follow into the new round as soon as a slot has its league.
          </p>
          {committed.slots.map((s) => (
            <p key={s.tournamentLeagueId} className="af-th-pick-meta">
              <strong>{s.name}</strong> — {s.teamSlots} teams ·{' '}
              <span className="af-th-linknote">waiting for its league</span>
            </p>
          ))}
        </div>
      ) : null}
    </section>
  )
}
