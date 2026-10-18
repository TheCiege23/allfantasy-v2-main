'use client'

/**
 * Player card "draft outlook" — will he last to your next pick, is he
 * falling, and who is circling. Numbers come from
 * `lib/draft-room/playerDraftOutlook` (market ADP + the Intel lookahead).
 */

import React from 'react'
import { formatAdpDelta, formatSurvival, survivalTone } from '@/lib/draft-room/draftPulse'
import type { PlayerDraftOutlook } from '@/lib/draft-room/playerDraftOutlook'

const MAX_NEEDERS_SHOWN = 3

function StatBox({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">{label}</p>
      <p className={`mt-0.5 text-[17px] font-bold tabular-nums ${tone ?? 'text-white'}`}>{value}</p>
    </div>
  )
}

export function PlayerDraftOutlookSection({ outlook, position }: { outlook: PlayerDraftOutlook; position: string }) {
  const survivalToneName = outlook.survival == null ? null : survivalTone(outlook.survival)
  const survivalColor =
    survivalToneName === 'likely'
      ? 'text-emerald-300'
      : survivalToneName === 'coin_flip'
        ? 'text-amber-300'
        : survivalToneName === 'unlikely'
          ? 'text-rose-300'
          : 'text-white/45'

  const past = outlook.pastAdpBy
  const pastLabel = past == null ? '—' : Math.abs(past) < 1 ? 'On ADP' : past > 0 ? `Falling ${formatAdpDelta(past)}` : `Early ${formatAdpDelta(past)}`
  const pastColor = past == null || Math.abs(past) < 1 ? 'text-white' : past > 0 ? 'text-emerald-300' : 'text-rose-300'

  const shownNeeders = outlook.needers.slice(0, MAX_NEEDERS_SHOWN)
  const moreNeeders = outlook.needers.length - shownNeeders.length

  return (
    <div className="border-b border-cyan-400/15 px-6 py-3" data-testid="player-detail-draft-outlook">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/90">Draft outlook</p>
      <div className="mt-2 flex gap-2">
        <StatBox
          label={outlook.leftAtLabel ? `Left @ ${outlook.leftAtLabel}` : 'Left @ your pick'}
          value={outlook.survival == null ? '—' : formatSurvival(outlook.survival)}
          tone={survivalColor}
        />
        <StatBox label="vs this pick" value={pastLabel} tone={pastColor} />
      </div>
      {outlook.managersBefore > 0 ? (
        <div className="mt-2 rounded-lg border border-violet-400/20 bg-violet-500/[0.07] px-3 py-2" data-testid="player-detail-draft-outlook-circling">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-200/90">Who&apos;s circling</p>
          <p className="mt-0.5 text-[13px] text-white">
            {outlook.needers.length} of {outlook.managersBefore} managers before your next pick still need a {position}.
          </p>
          {shownNeeders.length > 0 ? (
            <p className="text-[12px] text-white/60">
              {shownNeeders.join(' · ')}
              {moreNeeders > 0 ? ` +${moreNeeders} more` : ''}
            </p>
          ) : null}
          <p className={`mt-1 text-[12px] font-semibold ${outlook.projectedBy ? 'text-rose-200' : 'text-emerald-200'}`}>
            {outlook.projectedBy
              ? `Projected: ${outlook.projectedBy.displayName} takes him at ${outlook.projectedBy.pickLabel}.`
              : `Not projected to go before ${outlook.leftAtLabel ?? 'your next pick'}.`}
          </p>
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] text-white/45">Estimates from market ADP and what each manager still needs.</p>
    </div>
  )
}
