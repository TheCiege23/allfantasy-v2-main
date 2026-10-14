'use client'

import { useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import { buildRecapShareText, tagRecapInviteLink } from '@/lib/league-chat/recapShare'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { RECAP_SHARE } from '@/lib/analytics/eventNames'

/**
 * "Share with your league" under Chimmy's weekly recap.
 *
 * Most leagues have one AllFantasy member and the rest of the league talks somewhere else (see
 * lib/league-chat/recapShare.ts for the numbers), so this hands the recap to the phone's share sheet —
 * Sleeper, a group text, Discord — with the league's invite link at the end. Without a share sheet
 * (most desktops) it copies the text and says so.
 *
 * The link comes from the existing `GET /api/leagues/join?leagueId=` (any member may read it; it mints
 * an invite code for an imported league that has none). It is fetched on the first tap, not on render:
 * a recap in the scrollback should cost nothing until someone wants to share it. If the link cannot be
 * had, the recap is still shared, without the claim line.
 */
export function RecapShareButton({
  leagueId,
  leagueName,
  recap,
  className = 'af-cm-recap-share',
}: {
  leagueId: string
  leagueName?: string | null
  recap: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'shared' | 'failed'>('idle')
  const link = useRef<string | null | undefined>(undefined)

  async function inviteLink(): Promise<string | null> {
    if (link.current !== undefined) return link.current
    try {
      const res = await fetch(`/api/leagues/join?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      const data = res.ok ? ((await res.json().catch(() => null)) as { inviteLink?: unknown } | null) : null
      link.current = typeof data?.inviteLink === 'string' ? tagRecapInviteLink(data.inviteLink) : null
    } catch {
      link.current = null
    }
    return link.current
  }

  async function share() {
    if (state === 'busy') return
    setState('busy')
    sendProductAnalyticsBeacon(RECAP_SHARE.TAP, { leagueId })
    const invite = await inviteLink()
    const text = buildRecapShareText(recap, invite)
    /* How the tap ended — the share sheet itself reports nothing back, so this is all we will know. */
    const done = (outcome: 'shared' | 'copied' | 'cancelled' | 'failed') => {
      sendProductAnalyticsBeacon(RECAP_SHARE.DONE, { leagueId, outcome, hasLink: Boolean(invite) })
      setState(outcome === 'cancelled' ? 'idle' : outcome)
    }
    const nav = typeof navigator !== 'undefined' ? navigator : null
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: leagueName ? `${leagueName} recap` : 'Weekly recap', text })
        done('shared')
        return
      } catch (err) {
        /* Closing the sheet is a choice, not a failure — go back to the button as it was. */
        if (err instanceof Error && err.name === 'AbortError') {
          done('cancelled')
          return
        }
        /* Any other refusal (no permission, an unsupported target) falls through to copying. */
      }
    }
    try {
      await nav?.clipboard?.writeText(text)
      if (!nav?.clipboard) throw new Error('no clipboard')
      done('copied')
    } catch {
      done('failed')
    }
  }

  const label =
    state === 'busy'
      ? 'Getting your invite link…'
      : state === 'copied'
        ? 'Copied — paste it in your league’s group chat'
        : state === 'shared'
          ? 'Shared'
          : state === 'failed'
            ? 'Could not share — try again'
            : 'Share with your league'

  return (
    <button
      type="button"
      className={className}
      data-state={state}
      onClick={(e) => {
        e.stopPropagation()
        void share()
      }}
      disabled={state === 'busy'}
      aria-live="polite"
    >
      <Share2 aria-hidden="true" size={14} />
      <span>{label}</span>
    </button>
  )
}

export default RecapShareButton
