'use client'

export type PlayableIdol = { idolId: string; powerType: string; label: string; alreadyPlayed: boolean }

const POWER_COPY: Record<string, { title: string; action: string; needsTarget: boolean; supported: boolean }> = {
  vote_shield: { title: 'Vote Shield', action: 'play-idol', needsTarget: false, supported: true },
  extra_vote: { title: 'Extra Vote', action: 'play-extra-vote', needsTarget: true, supported: true },
  skip_tribal: { title: 'Council Pass', action: 'play-skip-tribal', needsTarget: false, supported: true },
  triple_steal: { title: 'Triple Steal', action: '', needsTarget: false, supported: false },
  auto_waiver_pickup: { title: 'Auto Waiver Pickup', action: '', needsTarget: false, supported: false },
}

/**
 * Owner-only idol play panel. Shows the acting user's playable powers; vote_shield/extra_vote/
 * skip_tribal call real route actions, Triple Steal / Auto Waiver Pickup are truthfully disabled
 * (resolution deferred). No dead buttons.
 */
export function SurvivorIdolPlayPanel({
  idols,
  windowOpen,
  busy,
  onPlay,
}: {
  idols: PlayableIdol[]
  windowOpen: boolean
  busy: boolean
  onPlay: (action: string, needsTarget: boolean, label: string) => void
}) {
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
                onClick={() => onPlay(copy.action, copy.needsTarget, copy.title)}
                className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {idol.alreadyPlayed ? 'Done' : copy.supported ? 'Play' : 'Disabled'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SurvivorIdolPlayPanel
