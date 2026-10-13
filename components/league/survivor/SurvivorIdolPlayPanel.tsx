'use client'

import { useState } from 'react'

export type PlayableIdol = { idolId: string; powerType: string; label: string; alreadyPlayed: boolean }

const POWER_COPY: Record<string, { title: string; action: string; needsTarget: boolean; supported: boolean }> = {
  vote_shield: { title: 'Vote Shield', action: 'play-idol', needsTarget: false, supported: true },
  extra_vote: { title: 'Extra Vote', action: 'play-extra-vote', needsTarget: true, supported: true },
  skip_tribal: { title: 'Council Pass', action: 'play-skip-tribal', needsTarget: false, supported: true },
  vote_steal: { title: 'Vote Steal', action: 'play-vote-steal', needsTarget: true, supported: true },
  triple_steal: { title: 'Triple Steal', action: '', needsTarget: false, supported: false },
  auto_waiver_pickup: { title: 'Auto Waiver Pickup', action: '', needsTarget: false, supported: false },
}

/**
 * Owner-only council idol play panel. Roster raid powers have their own vault flow.
 */
export function SurvivorIdolPlayPanel({
  idols,
  windowOpen,
  busy,
  onPlay,
  voteDeadline,
}: {
  idols: PlayableIdol[]
  windowOpen: boolean
  busy: boolean
  onPlay: (action: string, needsTarget: boolean, label: string) => void
  voteDeadline?: string | null
}) {
  const [pending, setPending] = useState<{ action: string; needsTarget: boolean; title: string } | null>(null)
  if (idols.length === 0) {
    return <p className="text-xs text-neutral-500">You hold no playable powers at this council.</p>
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Your hidden powers</div>
      <div className="flex flex-col gap-2">
        {idols.map((idol) => {
          const copy = POWER_COPY[idol.powerType] ?? { title: idol.label, action: '', needsTarget: false, supported: false }
          const disabled = busy || idol.alreadyPlayed || !copy.supported || (copy.action !== 'play-idol' && !windowOpen)
          return (
            <div key={idol.idolId} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-3 py-2">
              <div>
                <div className="text-sm text-neutral-100">{copy.title}</div>
                {!copy.supported ? (
                  <div className="text-[11px] text-neutral-500">Resolution coming in a later phase — inventory only.</div>
                ) : idol.alreadyPlayed ? (
                  <div className="text-[11px] text-emerald-400">Played</div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPending({ action: copy.action, needsTarget: copy.needsTarget, title: copy.title })}
                className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {idol.alreadyPlayed ? 'Done' : copy.supported ? 'Play' : 'Disabled'}
              </button>
            </div>
          )
        })}
      </div>
      {pending && <div role="group" aria-label={`Confirm ${pending.title}`} className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 text-sm text-amber-100">
        <p className="font-bold">Play {pending.title}?</p>
        <p className="mt-1 text-xs text-amber-100/80">{pending.action === 'play-idol' ? 'Your immunity takes effect at this Council. No target is needed.' : pending.needsTarget ? 'Check the selected manager and ballot target above before confirming.' : 'This power will take effect at this Council.'}</p>
        {voteDeadline && <p className="mt-1 text-xs">Vote deadline: {new Date(voteDeadline).toLocaleString()}</p>}
        <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded border border-white/20 px-3 py-2">Cancel</button><button type="button" disabled={busy} onClick={() => { onPlay(pending.action, pending.needsTarget, pending.title); setPending(null) }} className="rounded bg-amber-400 px-3 py-2 font-bold text-black disabled:opacity-50">Confirm idol play</button></div>
      </div>}
    </div>
  )
}

export default SurvivorIdolPlayPanel
