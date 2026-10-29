'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FinaleRevealView } from '@/lib/survivor/finaleView'
import { LateAvatar, fmtPts, useIsPhone, usePrefersReducedMotion } from './lateUi'
import './late-season.css'

const REVEAL_MS = 900

function Tally({ count }: { count: number }) {
  // Tally marks are never the only signal: the number always sits beside them.
  const marks = 'I'.repeat(Math.min(count, 12))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }} aria-label={`${count} jury vote${count === 1 ? '' : 's'}`}>
      {count > 0 ? <span className="svl-tally" aria-hidden="true">{marks}</span> : null}
      <span className="svl-num" style={{ fontSize: 22, color: '#f4f5fa' }} aria-hidden="true">{count}</span>
    </span>
  )
}

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function JuryFinaleView({ view, onVote, voting, voteError }: {
  view: FinaleRevealView
  onVote?: (finalistRosterId: string) => void
  voting?: boolean
  voteError?: string | null
}) {
  const reduced = usePrefersReducedMotion()
  const phone = useIsPhone()
  const slips = useMemo(() => view.reveal?.slips ?? [], [view.reveal])
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ballot, setBallot] = useState<string>(view.viewer.myVoteFinalistRosterId ?? '')
  const done = slips.length > 0 && shown >= slips.length

  useEffect(() => setBallot(view.viewer.myVoteFinalistRosterId ?? ''), [view.viewer.myVoteFinalistRosterId])

  // Desktop: one vote every 0.9s. Phone: a tap per vote. Reduced motion: straight to the end state.
  useEffect(() => {
    if (!playing || phone || reduced) return
    if (shown >= slips.length) return setPlaying(false)
    const id = setTimeout(() => setShown((n) => n + 1), REVEAL_MS)
    return () => clearTimeout(id)
  }, [playing, shown, slips.length, phone, reduced])

  const start = useCallback(() => {
    if (reduced) return setShown(slips.length)
    setShown(phone ? 1 : 0)
    setPlaying(true)
  }, [phone, reduced, slips.length])

  const tallies = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const slip of slips.slice(0, shown)) counts[slip.finalistRosterId] = (counts[slip.finalistRosterId] ?? 0) + 1
    return counts
  }, [slips, shown])

  const nameOf = (rosterId: string) => view.finalists.find((f) => f.rosterId === rosterId)?.name ?? 'Finalist'
  const deadline = formatDeadline(view.votingDeadline)
  const winner = done ? view.reveal?.winnerRosterId ?? null : null
  const canBallot = view.open && view.sealed && view.viewer.isJuror && !view.viewer.isFinalist && onVote

  return (
    <div className="svl" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h2 className="svl-h1">Final Tribal Council</h2>
          <span className="svl-t2">
            {view.leagueName} · Week {view.week} · {phone && view.reveal ? `${shown} of ${slips.length} votes read` : 'The jury decides who wins the season'}
          </span>
        </div>
        {deadline && view.sealed ? (
          <span className="svl-chip" style={{ borderColor: 'rgba(217,180,90,.5)', color: '#f1d58a' }}>Jury votes close {deadline}</span>
        ) : null}
      </header>

      {done && view.champion ? (
        <section className="svl-card svl-champ" aria-live="polite">
          <img className="svl-trophy" src="/survivor/late/champion-trophy.svg" alt="Season trophy" />
          <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
            <span className="svl-lbl" style={{ color: '#d9b45a' }}>Season champion · {view.leagueName}</span>
            <h3 className="svl-display" style={{ fontSize: 'clamp(26px,4vw,44px)' }}>{view.champion.name} is the last one standing</h3>
            <p className="svl-t2" style={{ fontSize: 16 }}>
              Won the jury vote {view.champion.scoreline}.{phone ? '' : ` Outlasted ${view.champion.outlasted} managers over ${view.champion.weeks} weeks.`}
            </p>
            {view.reveal?.tieBreakSeasonPoints ? <p className="svl-t3">The jury vote was tied; season points decided it.</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="svl-chip" style={{ borderColor: 'rgba(217,180,90,.5)', color: '#f1d58a' }}>
                <img src="/survivor/late/champion-icon.svg" alt="" width={16} height={16} /> Champion badge on profile
              </span>
              <span className="svl-chip">Season added to league history</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="svl-card svl-bench" aria-label="The jury">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <span className="svl-lbl" style={{ flex: 1 }}>The jury · {view.jury.length} manager{view.jury.length === 1 ? '' : 's'} voted out after the merge</span>
          <img src="/survivor/late/jury-icon.svg" alt="" width={36} height={36} />
        </div>
        {view.jury.length === 0 ? (
          <p className="svl-t2" style={{ textAlign: 'center' }}>Nobody has joined the jury yet. Everyone voted out after the merge takes a seat here.</p>
        ) : (
          <ul className="svl-bench-row" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {view.jury.map((juror) => (
              <li key={juror.rosterId} className="svl-juror-seat">
                <span style={{ fontWeight: 600, fontSize: 14 }}>{juror.name}</span>
                <span className="svl-t3">Out wk {juror.votedOutWeek}</span>
                <span style={{ position: 'relative', marginTop: 4 }}>
                  <LateAvatar id={juror.rosterId} name={juror.name} className="svl-juror" />
                  <img className="svl-juror-badge" src="/survivor/late/jury-icon.svg" alt="Juror" />
                </span>
              </li>
            ))}
          </ul>
        )}
        <img className="svl-bench-art" src="/survivor/late/jury-bench.svg" alt="" aria-hidden="true" />
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section style={{ flex: '2 1 560px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }} aria-label="The finalists">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
            <span className="svl-lbl" style={{ flex: 1 }}>The finalists</span>
            {view.reveal && !phone ? (
              done || playing ? (
                <button type="button" className="svl-btn" onClick={start} disabled={playing && !done}>Replay</button>
              ) : (
                <button type="button" className="svl-btn svl-btn-gold" onClick={start}>Read the votes</button>
              )
            ) : null}
          </div>
          {view.finalists.length === 0 ? <p className="svl-t2">The finalists are set when {view.finalistCount} managers remain.</p> : null}
          <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : `repeat(auto-fit,minmax(220px,1fr))`, gap: 14 }}>
            {view.finalists.map((finalist) => {
              const isWinner = winner === finalist.rosterId
              const count = view.reveal ? tallies[finalist.rosterId] ?? 0 : 0
              return (
                <article key={finalist.rosterId} className="svl-card svl-finalist" data-winner={isWinner}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <LateAvatar id={finalist.rosterId} name={finalist.name} ring={isWinner ? '#f2c94c' : undefined} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 17, overflowWrap: 'anywhere' }}>{finalist.name}</p>
                      {phone ? (
                        <p className="svl-t3">
                          {finalist.record.immunityWins} immunity win{finalist.record.immunityWins === 1 ? '' : 's'}
                          {finalist.record.idolsPlayed ? ` · ${finalist.record.idolsPlayed} idol${finalist.record.idolsPlayed === 1 ? '' : 's'}` : ''}
                        </p>
                      ) : <p className="svl-t3">Finalist</p>}
                    </div>
                    {phone ? <Tally count={count} /> : <img src="/survivor/weekly/torch-lit-icon.svg" alt="" width={28} height={28} />}
                  </div>
                  {!phone ? (
                    <>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <p className="svl-stat"><span>Immunity wins</span><b className="svl-num">{finalist.record.immunityWins}</b></p>
                        <p className="svl-stat"><span>Idols played</span><b className="svl-num">{finalist.record.idolsPlayed}</b></p>
                        <p className="svl-stat"><span>Season points</span><b className="svl-num">{fmtPts(finalist.record.seasonPoints)}</b></p>
                        <p className="svl-stat"><span>Votes survived</span><b className="svl-num">{finalist.record.votesSurvived}</b></p>
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="svl-lbl">Jury votes</span>
                        <Tally count={count} />
                      </div>
                    </>
                  ) : null}
                </article>
              )
            })}
          </div>

          {canBallot ? (
            <section className="svl-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Your jury vote">
              <span className="svl-lbl">Your jury vote</span>
              <p className="svl-t2">
                {view.viewer.myVoteFinalistRosterId
                  ? `Your vote is in for ${nameOf(view.viewer.myVoteFinalistRosterId)}. You can change it until the vote closes.`
                  : 'Vote for the finalist who should win the season. Only you can see your ballot.'}
              </p>
              <div role="radiogroup" aria-label="Finalists" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {view.finalists.map((f) => (
                  <button key={f.rosterId} type="button" role="radio" aria-checked={ballot === f.rosterId} className="svl-name" style={{ fontSize: 15 }} onClick={() => setBallot(f.rosterId)}>
                    {f.name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button type="button" className="svl-btn svl-btn-gold" disabled={!ballot || voting || ballot === view.viewer.myVoteFinalistRosterId} onClick={() => onVote?.(ballot)}>
                  {voting ? 'Casting…' : view.viewer.myVoteFinalistRosterId ? 'Change my vote' : 'Cast my vote'}
                </button>
                {voteError ? <span role="alert" style={{ color: '#ff8a6a', fontSize: 13 }}>{voteError}</span> : null}
              </div>
            </section>
          ) : view.open && view.sealed && view.viewer.isFinalist ? (
            <p className="svl-t3">Finalists do not vote. The jury decides.</p>
          ) : null}
        </section>

        <section style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} aria-label="Votes read">
          <span className="svl-lbl">Votes read · {view.reveal ? Math.min(shown, slips.length) : 0} of {view.reveal ? slips.length : view.juryCount}</span>
          <div className="svl-parchment" style={{ minHeight: phone ? 160 : 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="svl-parchment-title">{phone ? 'Jury votes' : 'Final Tribal Council'}</p>
            {view.sealed ? (
              <p className="svl-hand" style={{ margin: 'auto', textAlign: 'center', fontSize: 26, color: '#7a5a2a' }}>
                {view.open ? 'The votes are sealed until every juror has voted.' : 'The jury vote opens once the finalists are set.'}
              </p>
            ) : shown === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="svl-hand" style={{ color: '#7a5a2a' }}>The jury has voted.</p>
                {/* The tiebreak rule is on the scroll before a single vote is read. */}
                <p style={{ fontSize: 13, color: '#5a4320', maxWidth: 320 }}>{view.tiebreakRule}</p>
              </div>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }} aria-live="polite">
                {slips.slice(0, shown).map((slip, i) => (
                  <li key={slip.index} className="svl-slip">
                    <span className="svl-slip-lbl">{slip.label}</span>
                    <span className="svl-hand" style={{ transform: `rotate(${((i * 37) % 30) / 10 - 1.5}deg)` }}>{nameOf(slip.finalistRosterId)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      {phone && view.reveal ? (
        <div className="svl-sticky">
          {done ? (
            <button type="button" className="svl-btn" style={{ width: '100%' }} onClick={start}>Replay</button>
          ) : shown === 0 ? (
            <button type="button" className="svl-btn svl-btn-gold" style={{ width: '100%' }} onClick={start}>Read the votes</button>
          ) : (
            <button type="button" className="svl-btn svl-btn-gold" style={{ width: '100%' }} onClick={() => setShown((n) => Math.min(slips.length, n + 1))}>Read the next vote</button>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Loads the Final Tribal Council view and handles the juror's ballot. */
export function JuryFinale({ leagueId, onChampion }: { leagueId: string; onChampion?: (name: string) => void }) {
  const [view, setView] = useState<FinaleRevealView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/jury?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      const data = (await res.json()) as { view?: FinaleRevealView; error?: string }
      if (!res.ok || !data.view) return setError(data.error ?? 'Final Tribal Council could not load.')
      setView(data.view)
      if (data.view.champion) onChampion?.(data.view.champion.name)
    } catch {
      setError('Final Tribal Council could not load.')
    }
  }, [leagueId, onChampion])

  useEffect(() => {
    if (leagueId) void load()
  }, [leagueId, load])

  const vote = async (finalistRosterId: string) => {
    setVoting(true)
    setVoteError(null)
    try {
      const res = await fetch('/api/survivor/jury', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'jury_vote', leagueId, finalistRosterId }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setVoteError(data.error ?? 'Your vote did not go through.')
      await load()
    } finally {
      setVoting(false)
    }
  }

  if (error) return <p className="text-[13px] text-red-300">{error}</p>
  if (!view) return <p className="text-[13px] text-white/50">Loading Final Tribal Council…</p>
  return <JuryFinaleView view={view} onVote={vote} voting={voting} voteError={voteError} />
}
