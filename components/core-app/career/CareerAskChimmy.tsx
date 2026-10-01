'use client'

import type { CareerChimmyPrompt } from '@/lib/core-app/careerChimmy'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from '@/components/core-app/comms/commsEvents'
import { haptic } from '@/lib/platform/haptics'

/**
 * Opens the Chimmy drawer with a career question in the composer.
 *
 * ⚠ PREFILL, NEVER SEND. The question lands in the box and the user presses send — see
 * `commsEvents.ts`. A league career passes its `leagueId` so the drawer scopes to that
 * league rather than whichever one it was last left on.
 */
export function askChimmyAboutCareer(ask: string, leagueId?: string) {
  // A tap's own acknowledgement on a phone (phase 6); a no-op on desktop.
  haptic('light')
  const detail: CommsOpenDetail = { tab: 'chimmy', prefill: ask, ...(leagueId ? { leagueId } : {}) }
  window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
}

export function CareerAskChimmy({
  prompts,
  leagueId,
  title = 'Ask Chimmy about your career',
}: {
  prompts: CareerChimmyPrompt[]
  leagueId?: string
  title?: string
}) {
  if (prompts.length === 0) return null
  return (
    <section className="af-crl-ask" aria-label={title}>
      <p className="af-crl-head">
        <span className="af-crl-mark" aria-hidden>
          ✦
        </span>
        {title}
      </p>
      <div className="af-crl-chips">
        {prompts.map((p) => (
          <button
            key={p.key}
            type="button"
            className="af-crl-chip"
            title={p.ask}
            onClick={() => askChimmyAboutCareer(p.ask, leagueId)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </section>
  )
}
