'use client'

import { ArrowRightLeft, Clock, Users } from 'lucide-react'

export type RedraftPlanningRibbonProps = {
  picksUntilUser: number | null
  userOnClock: boolean
  /** Next few pickers after current (slot + name) */
  onDeck: Array<{ slot: number; displayName: string }>
  thirdRoundReversal: boolean
  backToBackSoon: boolean
  /** Session has no viewer roster mapping — prompts claim flow instead of generic “waiting”. */
  viewerRosterMissing?: boolean
  /** Mounts ribbon before Start so board stack height matches live draft (layout parity). */
  preDraft?: boolean
}

export function RedraftPlanningRibbon({
  picksUntilUser,
  userOnClock,
  onDeck,
  thirdRoundReversal,
  backToBackSoon,
  viewerRosterMissing = false,
  preDraft = false,
}: RedraftPlanningRibbonProps) {
  const untilLabel =
    picksUntilUser == null
      ? null
      : picksUntilUser === 0
        ? "You're up now"
        : picksUntilUser === 1
          ? 'Your pick next'
          : `Your pick in ~${picksUntilUser} selections`

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-cyan-500/15 bg-[linear-gradient(92deg,rgba(34,211,238,0.08),rgba(15,23,42,0.55))] px-3 py-1.5 text-[11px] text-white/85 shadow-[inset_0_-1px_0_rgba(34,211,238,0.06)]"
      role="region"
      aria-label="Draft planning"
      data-testid="redraft-planning-ribbon"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" aria-hidden />
        {preDraft ? (
          <span className="font-medium text-white/90">
            Pre-draft — same board below; only status and timers change when the commissioner starts.
          </span>
        ) : userOnClock ? (
          <span className="font-semibold text-cyan-100">You are on the clock</span>
        ) : untilLabel ? (
          <span className="font-medium text-white/90">{untilLabel}</span>
        ) : viewerRosterMissing ? (
          <span className="text-amber-100/90">
            Link your roster from the league page to see your place in the draft order.
          </span>
        ) : (
          <span className="text-white/55">Waiting for draft state…</span>
        )}
      </div>

      {backToBackSoon && !userOnClock && !preDraft ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
          <ArrowRightLeft className="h-3 w-3" aria-hidden />
          Back-to-back picks coming — plan both slots
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 border-l border-white/10 pl-3">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
          <Users className="h-3 w-3" aria-hidden />
          Next up
        </span>
        <ol className="flex flex-wrap gap-2">
          {onDeck.length === 0 ? (
            <li className="text-[10px] text-white/38">Draft finishing…</li>
          ) : (
            onDeck.slice(0, 4).map((u, i) => (
              <li
                key={`${u.slot}-${i}`}
                className="flex items-center gap-1 rounded-md border border-white/10 bg-black/25 px-2 py-0.5"
              >
                <span className="font-mono text-[10px] text-cyan-200/80">T{u.slot}</span>
                <span className="max-w-[120px] truncate text-[11px] text-white/80">{u.displayName}</span>
              </li>
            ))
          )}
        </ol>
      </div>

      <p className="text-[10px] text-white/42 sm:pl-2">
        Snake: pick order reverses each round
        {thirdRoundReversal ? ' · 3rd-round reversal on' : ''}.
      </p>
    </div>
  )
}
