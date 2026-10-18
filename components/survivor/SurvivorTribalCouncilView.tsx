'use client'

import { useEffect, useState } from 'react'
import { Clock, ScrollText, Shield, Skull, Vote } from 'lucide-react'
import type { SurvivorSummary } from './types'
import { SurvivorCommandHelp } from './SurvivorCommandHelp'
import { SurvivorScrollReveal } from './SurvivorScrollReveal'
import { SurvivorShareCard } from './SurvivorShareCard'

export interface SurvivorTribalCouncilViewProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
}

/**
 * Elimination Council View: countdown, voting instructions, @Chimmy usage examples, immunity markers, scroll reveal history, vote result recap.
 */
type ShotStatus = { available: boolean; used: boolean; success: boolean | null; councilId: string | null }

export function SurvivorTribalCouncilView({ leagueId, summary, names }: SurvivorTribalCouncilViewProps) {
  const { council, votedOutHistory, currentWeek } = summary
  const [shot, setShot] = useState<ShotStatus | null>(null)
  const [shotPending, setShotPending] = useState(false)
  const [shotConfirm, setShotConfirm] = useState(false)
  const [shotError, setShotError] = useState<string | null>(null)
  const [outCardOpen, setOutCardOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/vote`, { cache: 'no-store' })
      .then(async response => response.ok ? response.json() as Promise<ShotStatus> : null)
      .then(value => { if (mounted) setShot(value) })
      .catch(() => { if (mounted) setShot(null) })
    return () => { mounted = false }
  }, [leagueId, council?.id])

  async function playShot() {
    if (!shot?.available || shotPending) return
    setShotPending(true)
    setShotError(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'shot_in_the_dark' }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) {
        setShotError(result.error ?? 'The draw could not be played.')
      } else {
        setShot({ available: false, used: true, success: result.success === true, councilId: result.councilId })
        setShotConfirm(false)
      }
    } catch {
      setShotError('Network error. Check your draw status before trying again.')
    } finally {
      setShotPending(false)
    }
  }
  const deadline = council?.voteDeadlineAt ? new Date(council.voteDeadlineAt) : null
  const isClosed = !!council?.closedAt
  const eliminated = council?.eliminatedRosterId
  const isMyTorch = !!eliminated && summary.myRosterId === eliminated

  return (
    <div className="space-y-6">
      {/* Countdown */}
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <img src="/survivor/weekly/torch-lit.svg" alt="" className="pointer-events-none absolute -right-5 -top-8 h-48 w-36 opacity-25" />
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Clock className="h-5 w-5 text-amber-400" />
          Elimination Council · Week {currentWeek}
        </h2>
        {!council ? (
          <p className="text-sm text-white/50">No council scheduled for this week.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-white/70">
              Phase: <span className="font-medium text-amber-300">{council.phase}</span>
              {council.attendingTribeId && ' · One tribe attending'}
            </p>
            {isClosed ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
                {council.isRevealed ? (eliminated ? `Torch Ceremony complete. Eliminated: ${names[eliminated] ?? eliminated}` : 'Torch Ceremony complete.') : 'Voting has closed. Chimmy will reveal the result at the Torch Ceremony.'}
              </p>
            ) : deadline ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
                Vote deadline: {deadline.toLocaleString()}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* Voting instructions */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Vote className="h-5 w-5 text-cyan-400" />
          Voting instructions
        </h2>
        <p className="mb-4 text-sm text-white/70">
          Cast your vote in league or tribe chat using the official command. Only one vote per roster. Self-vote may be disallowed by league settings.
        </p>
        <SurvivorCommandHelp compact />
      </section>

      <section className="rounded-2xl border border-amber-500/25 bg-amber-950/10 p-4 sm:p-6">
        <h2 className="mb-2 text-lg font-semibold text-amber-100">Shot in the Dark</h2>
        <p className="text-sm text-white/70">You may use this once per league during your original council vote window. You give up your vote for a 1-in-6 chance of immunity. Your result stays private until the Torch Ceremony.</p>
        {shot?.used ? (
          <p role="status" className="mt-3 text-sm text-amber-100">Your draw: {shot.success ? 'Safe — immune at that council' : 'Not Safe'}. Your vote was forfeited.</p>
        ) : shot?.available ? (
          shotConfirm ? <div className="mt-3 space-y-3 rounded-lg border border-amber-400/30 bg-black/20 p-3">
            <p className="text-sm text-amber-100">Confirm: this permanently uses your one draw and forfeits your vote at this council, even if the draw fails.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={playShot} disabled={shotPending}
                className="rounded-lg border border-amber-400/50 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-50">
                {shotPending ? 'Drawing…' : 'Confirm draw'}
              </button>
              <button type="button" onClick={() => setShotConfirm(false)} disabled={shotPending}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 disabled:opacity-50">Cancel</button>
            </div>
          </div> : <button type="button" onClick={() => setShotConfirm(true)}
            className="mt-3 rounded-lg border border-amber-400/50 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100">
            Use Shot in the Dark
          </button>
        ) : (
          <p className="mt-3 text-sm text-white/50">The draw is unavailable now. Cast your private vote with @Chimmy when voting opens.</p>
        )}
        {shotError && <p role="alert" className="mt-2 text-sm text-rose-200">{shotError}</p>}
      </section>

      {/* Vote scroll (sequence from server when council closes / votes tallied) */}
      {council?.isRevealed &&
        Array.isArray(council.revealSequence) &&
        (council.revealSequence as unknown[]).length > 0 && (
          <section className="rounded-2xl border border-amber-500/20 bg-[#0a1228]/80 p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-amber-100">
              <ScrollText className="h-5 w-5 text-amber-400" />
              Torch Ceremony · vote scroll
            </h2>
            <p className="mb-4 text-sm text-white/55">
              Votes are read in scroll order — same sequence the host uses when the council closes.
            </p>
            <SurvivorScrollReveal
              councilWeek={council.week}
              revealSequence={council.revealSequence}
              autoPlayMs={1400}
            />
          </section>
        )}

      {/* The "out" card is opt-in and offered only to the eliminated manager — never to anyone else. */}
      {council?.isRevealed && eliminated && isMyTorch && (outCardOpen
        ? <SurvivorShareCard moment="voted_out" sport={summary.seasonCalendar?.sport ?? 'NFL'} leagueName={summary.config.seasonThemeLabel ?? 'Survivor League'} week={council.week} headline={`${names[eliminated] ?? 'A manager'} has left the island`} caption="The Torch Ceremony result is final." />
        : <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/20 bg-[#080b11] p-4 text-white">
            <p className="text-sm text-white/70">Want to share your exit? Only you can see this.</p>
            <button type="button" onClick={() => setOutCardOpen(true)} className="min-h-[44px] rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-200">Make a share card</button>
          </section>)}

      {/* Immunity markers (placeholder – backend can expose who has immunity) */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <Shield className="h-5 w-5 text-emerald-400" />
          Immunity
        </h2>
        <p className="text-sm text-white/50">Individual immunity (from challenges) and tribe immunity are shown on the Tribe Board when active.</p>
      </section>

      {/* Voted-out history (scroll reveal) */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Skull className="h-5 w-5 text-rose-400" />
          Voted out history
        </h2>
        {votedOutHistory.length === 0 ? (
          <p className="text-sm text-white/50">No one has been voted out yet.</p>
        ) : (
          <ul className="space-y-2">
            {votedOutHistory.map((entry, i) => (
              <li
                key={`${entry.rosterId}-${entry.week}-${i}`}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm"
              >
                <span className="text-white/80">
                  Week {entry.week ?? '?'} · {entry.rosterId ? (names[entry.rosterId] ?? entry.rosterId) : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
