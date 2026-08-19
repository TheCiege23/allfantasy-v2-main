'use client'

import { useSearchParams } from 'next/navigation'
import { resolveLockedFeature } from '@/lib/monetization/lockedFeature'
import '@/components/monetization/af-monetization.css'

/**
 * "You hit X. Nothing was lost." — the banner the gate pattern was missing.
 *
 * ⚠ THE REASSURANCE IS THE POINT, NOT THE LABEL. Someone arrives here mid-task,
 * having been stopped. The handoff specifies a `--warn-soft` banner that names the
 * feature AND says nothing was lost, because the unspoken worry on a paywall is
 * that the draft pick, the trade, or the waiver claim went away when the modal
 * appeared. Naming the feature without answering that leaves the anxiety intact.
 *
 * ⚠ RENDERS NOTHING WHEN THE FEATURE IS UNKNOWN. `resolveLockedFeature` returns
 * null for any value not verified against a real caller, and null must stay
 * silent — a banner reading "you hit the some_new_key feature" is worse than no
 * banner, because it converts a reassurance into evidence that we do not know what
 * happened either.
 */
export function LockedFeatureBanner() {
  const searchParams = useSearchParams()
  const feature = resolveLockedFeature(searchParams?.get('feature'))
  if (!feature) return null

  return (
    <div className="af-mz-lockbanner" role="status">
      <span className="af-mz-lockbanner-glyph" aria-hidden>
        ⦿
      </span>
      <div>
        <p className="af-mz-lockbanner-title">
          You were using <strong>{feature.label}</strong>.
        </p>
        <p className="af-mz-lockbanner-body">
          Nothing was lost — pick a plan below, or use tokens for one-off access, and you can carry
          straight on.
        </p>
      </div>
    </div>
  )
}

export default LockedFeatureBanner
