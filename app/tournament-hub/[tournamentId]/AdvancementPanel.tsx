'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdvancementPreview, Blocker } from '@/lib/tournament/advancementPreview'
import { formatPoints, formatRecord } from '@/lib/tournament/standingsExport'

/**
 * Run the cut — deliberately, and never by accident.
 *
 * 🛑 THIS IS THE ONLY IRREVERSIBLE THING ON THE HUB. Everything else recomputes
 * from source; this stamps `advancementStatus` on every participant and there is
 * no undo. So it is three separate acts — look, acknowledge, type the word — and
 * none of them happens as a side effect of the previous one.
 */

const CONFIRM_WORD = 'ADVANCE'

function BlockerRow({
  blocker,
  acknowledged,
  onToggle,
}: {
  blocker: Blocker
  acknowledged: boolean
  onToggle: () => void
}) {
  if (blocker.severity === 'warning') {
    return <p className="af-th-linknote af-th-linknote--soft">⚠ {blocker.message}</p>
  }
  return (
    <label className="af-th-ack">
      <input type="checkbox" checked={acknowledged} onChange={onToggle} />
      <span>{blocker.message}</span>
    </label>
  )
}

export function AdvancementPanel({ tournamentId }: { tournamentId: string }) {
  const router = useRouter()
  const [preview, setPreview] = useState<AdvancementPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [acked, setAcked] = useState<Set<string>>(new Set())
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/run-advancement`)
      const body = (await res.json()) as AdvancementPreview & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not work out the cut')
      setPreview(body)
      setAcked(new Set())
      setConfirmText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not work out the cut')
    } finally {
      setLoading(false)
    }
  }

  const blockers = (preview?.blockers ?? []).filter((b) => b.severity === 'blocker')
  const allAcked = blockers.every((b) => acked.has(b.code))
  const canRun = Boolean(preview) && allAcked && confirmText.trim().toUpperCase() === CONFIRM_WORD

  async function run() {
    if (!preview) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/tournament/${encodeURIComponent(tournamentId)}/run-advancement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signature: preview.signature, acknowledge: [...acked] }),
        },
      )
      const body = (await res.json()) as {
        error?: string
        preview?: AdvancementPreview
        qualified?: number
        eliminated?: number
      }
      if (!res.ok) {
        /* A 409 means the board moved — show the NEW numbers rather than the
           stale ones the commissioner was looking at. */
        if (body.preview) {
          setPreview(body.preview)
          setAcked(new Set())
          setConfirmText('')
        }
        throw new Error(body.error ?? 'Could not run the advancement')
      }
      setDone(
        `Done — ${body.qualified ?? 0} advanced, ${body.eliminated ?? 0} eliminated. Nothing was created on any platform.`,
      )
      setPreview(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the advancement')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="af-th-league">
      <h2 className="af-th-league-name">
        Run the cut
        <span className="af-th-linknote">irreversible</span>
      </h2>

      <p className="af-th-note">
        Works out who advances, who is on the bubble and whose season ends, then records it. The
        standings screen above only shows where things stand — this is what makes it official.
      </p>

      <div className="af-th-actions">
        <button type="button" className="af-th-linkbtn" disabled={loading} onClick={load}>
          {loading ? 'Working it out…' : preview ? 'Refresh the preview' : 'Preview the cut'}
        </button>
      </div>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="af-th-note">{done}</p> : null}

      {preview ? (
        <>
          <p className="af-th-note">
            Round {preview.roundNumber} — <strong>{preview.totalAdvancing} advance</strong>,{' '}
            {preview.totalEliminated} eliminated.
          </p>

          {preview.blockers.map((b, i) => (
            <BlockerRow
              key={`${b.code}-${i}`}
              blocker={b}
              acknowledged={acked.has(b.code)}
              onToggle={() =>
                setAcked((prev) => {
                  const next = new Set(prev)
                  if (next.has(b.code)) next.delete(b.code)
                  else next.add(b.code)
                  return next
                })
              }
            />
          ))}

          {preview.conferences.map((c) => (
            <div key={c.conferenceId} className="af-th-paste">
              <div className="af-th-paste-head">
                <strong>{c.conferenceName}</strong>
                <span className="af-th-linknote">
                  {c.advancing} of {c.fieldSize} advance
                  {c.bubble > 0 ? ` · ${c.bubble} on the bubble` : ''}
                </span>
              </div>
              {/*
                ⚠ THE CLOSE CALLS, NOT THE WHOLE LIST. A commissioner cannot check
                64 names, but they can check the four either side of the line —
                which is exactly where a wrong number or a missing link shows up.
              */}
              <div className="af-th-scroll">
                <table className="af-th-table">
                  <tbody>
                    {c.lastIn.map((m) => (
                      <tr key={`in-${m.displayName}`}>
                        <td>{m.conferenceRank}</td>
                        <td>{m.displayName}</td>
                        <td>{m.leagueName}</td>
                        <td>{formatRecord(m.wins, m.losses, 0)}</td>
                        <td>{formatPoints(m.pointsFor)}</td>
                        <td>
                          <span className="af-th-chip af-th-chip--in">In</span>
                        </td>
                      </tr>
                    ))}
                    {c.firstOut.map((m) => (
                      <tr key={`out-${m.displayName}`}>
                        <td>{m.conferenceRank}</td>
                        <td>{m.displayName}</td>
                        <td>{m.leagueName}</td>
                        <td>{formatRecord(m.wins, m.losses, 0)}</td>
                        <td>{formatPoints(m.pointsFor)}</td>
                        <td>
                          <span className="af-th-chip af-th-chip--out">Out</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <label className="af-th-field">
            <span>Type {CONFIRM_WORD} to confirm</span>
            <input
              className="af-th-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
            />
          </label>

          <div className="af-th-actions">
            <button type="button" className="af-th-copy" disabled={!canRun || running} onClick={run}>
              {running ? 'Running…' : `Advance ${preview.totalAdvancing}, eliminate ${preview.totalEliminated}`}
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}
