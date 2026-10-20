import MockDraftSleeperRoomClient from '@/components/mock-draft/MockDraftSleeperRoomClient'

/** The /e2e layout blocks this route in production. Exercise the real /mock-draft component. */
export default function ProductionMockDraftHarness() {
  return <MockDraftSleeperRoomClient viewerId="e2e-mobile-viewer" initialSport="NBA" />
}
