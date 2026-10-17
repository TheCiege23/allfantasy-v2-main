'use client'

import { CreateLeagueV2Client } from '@/app/create-league/v2/CreateLeagueV2Client'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import type { ImportedLeagueSummary } from '@/components/create-league-v2/CreateLeagueWizard'

/**
 * Primary Create League route. The v2 client owns the simplified G30 flow,
 * including import entry points and dashboard cancellation.
 */
export function CreateLeaguePageClient({
  userId,
  importTemplate,
  importSourceName,
  importSourceLeagueId,
  importedLeagues,
}: {
  userId: string
  importTemplate?: CreateLeagueV2State
  importSourceName?: string
  importSourceLeagueId?: string
  importedLeagues?: ImportedLeagueSummary[]
}) {
  return <CreateLeagueV2Client userId={userId} importTemplate={importTemplate} importSourceName={importSourceName} importSourceLeagueId={importSourceLeagueId} importedLeagues={importedLeagues} />
}
