'use client'

import { useState } from 'react'
import BroadcastModal from '@/components/commish/BroadcastModal'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * Opens the existing @everyone composer, pre-set to this league.
 *
 * Rendered for the head commissioner and co-commissioners of a league created in
 * AllFantasy (`viewerCanBroadcast`) — the same people the broadcast route and the
 * composer's league list accept (`lib/commissioner/broadcastAccess.ts`). The
 * composer shows imported leagues read-only, so the button is not offered there.
 */
export function AnnounceButton({
  leagueId,
  label,
  className = 'af-btn af-ch-channel-action',
}: {
  leagueId: string
  label?: string
  className?: string
}) {
  const { language } = useOptionalLanguage()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} data-primary="true" onClick={() => setOpen(true)}>
        {label ?? hubCopy('Send an announcement', language)}
      </button>
      <BroadcastModal open={open} onClose={() => setOpen(false)} defaultLeagueId={leagueId} />
    </>
  )
}
