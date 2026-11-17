'use client'

import { DraftRoom } from '@/app/draft/components/DraftRoom'

/**
 * The league mock room (/draft/mock/[id]) without its server page, which needs a session and a
 * MockDraftRoom row. The /e2e layout blocks this route in production; the spec stubs every draft API.
 */
export default function LeagueMockRoomHarness() {
  return (
    <DraftRoom
      mode="mock"
      sessionId="mock:e2e-room"
      roomId="e2e-room"
      leagueId={null}
      userId="e2e-viewer"
      userName="E2E Viewer"
      inviteCode="E2EROOM1"
      isCommissioner
    />
  )
}
