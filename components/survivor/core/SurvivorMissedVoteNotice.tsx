'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TribalCouncilView } from '@/lib/survivor/survivorTribalView'
import { SurvivorStateCard } from './SurvivorStateCard'

/**
 * survivor-core §7 "Your vote wasn't cast". Shown only to the viewer, from their OWN tribal view
 * (`/survivor/state` builds `you` for the requesting user), and only when:
 *  - the council read has started (`isRevealed` is the reveal gate's "started", never before), and
 *  - the viewer was an eligible voter, and
 *  - the viewer cast no ballot.
 * Nothing about other managers is read or shown. Rule: an uncast vote simply doesn't count.
 */
export function shouldShowMissedVote(view: Pick<TribalCouncilView, 'councilId' | 'isRevealed' | 'you'> | null | undefined): boolean {
  return Boolean(view?.councilId && view.isRevealed && view.you.isEligibleVoter && !view.you.hasVoted)
}

export function SurvivorMissedVoteNotice({ leagueId, councilId }: { leagueId: string; councilId: string | null | undefined }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    let active = true
    setShow(false)
    if (!councilId) return
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((payload: { tribalCouncil?: TribalCouncilView } | null) => {
        const view = payload?.tribalCouncil
        // Only for the council on screen, so a stale view never shows the card for a new council.
        if (active && view?.councilId === councilId) setShow(shouldShowMissedVote(view))
      })
      .catch(() => {})
    return () => { active = false }
  }, [leagueId, councilId])
  if (!show) return null
  return <div className="svk-card" style={{ marginBottom: 16 }}>
    <SurvivorStateCard state="missed_vote" showPill>
      <Link href="/settings?tab=notifications" className="svk-btn">Notification settings</Link>
    </SurvivorStateCard>
  </div>
}
