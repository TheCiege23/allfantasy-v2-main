'use client'

import { useState } from 'react'
import BroadcastModal from '@/components/commish/BroadcastModal'

/**
 * Opens the existing @everyone composer, pre-set to this league.
 *
 * Rendered for the head commissioner and co-commissioners of a league created in
 * AllFantasy (`viewerCanBroadcast`) — the same people the broadcast route and the
 * composer's league list accept (`lib/commissioner/broadcastAccess.ts`). The
 * composer shows imported leagues read-only, so the button is not offered there.
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
