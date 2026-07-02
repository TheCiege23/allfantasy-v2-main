'use client'

import { CreateLeagueV2Client } from '@/app/create-league/v2/CreateLeagueV2Client'

/**
 * Primary Create League route. The v2 client owns the simplified G30 flow,
 * including import entry points and dashboard cancellation.
 */
export function CreateLeaguePageClient({ userId }: { userId: string }) {
  return <CreateLeagueV2Client userId={userId} />
}
