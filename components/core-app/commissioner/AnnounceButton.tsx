'use client'

import { useState } from 'react'
import BroadcastModal from '@/components/commish/BroadcastModal'

/**
 * Opens the existing @everyone composer, pre-set to this league.
 *
 * Rendered only for the league owner of a league created in AllFantasy: the
 * broadcast route accepts only `League.userId` and refuses imported leagues, so
 * showing it to anyone else would be a button that always fails.
 */
export function AnnounceButton({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="af-btn af-ch-channel-action" data-primary="true" onClick={() => setOpen(true)}>
        Send an announcement
      </button>
      <BroadcastModal open={open} onClose={() => setOpen(false)} defaultLeagueId={leagueId} />
    </>
  )
}
