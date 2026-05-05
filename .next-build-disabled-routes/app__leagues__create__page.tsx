import { permanentRedirect } from 'next/navigation'

import { buildCreateLeagueCanonicalHref } from '@/lib/routes/createLeagueCanonical'

export const dynamic = 'force-dynamic'

/**
 * Legacy URL — canonical Create League is `/create-league`.
 * Permanent redirect; query string preserved.
 */
export default async function LeaguesCreateLegacyRedirect({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}) {
  const sp =
    searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  permanentRedirect(buildCreateLeagueCanonicalHref(sp))
}
