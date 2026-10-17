'use client'

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
export function SurvivorTribalCouncilView({ summary, names }: SurvivorTribalCouncilViewProps) {
  const { council, votedOutHistory, currentWeek } = summary
  const deadline = council?.voteDeadlineAt ? new Date(council.voteDeadlineAt) : null
  const isClosed = !!council?.closedAt
  const eliminated = council?.eliminatedRosterId

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

      {council?.isRevealed && eliminated && <SurvivorShareCard moment="voted_out" sport={summary.seasonCalendar?.sport ?? 'NFL'} leagueName={summary.config.seasonThemeLabel ?? 'Survivor League'} week={council.week} headline={`${names[eliminated] ?? 'A manager'} has left the island`} caption="The Torch Ceremony result is final." />}

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
