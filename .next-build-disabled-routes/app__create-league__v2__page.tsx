import { permanentRedirect } from 'next/navigation'

import { buildCreateLeagueCanonicalHref } from '@/lib/routes/createLeagueCanonical'

export const dynamic = 'force-dynamic'

/**
 * Legacy URL — canonical Create League lives at `/create-league`.
 * Permanent redirect preserves query strings (`?v2=1`, `?e2eAuth=1`, templates, etc.).
 */
export default async function CreateLeagueV2LegacyRedirect({
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
