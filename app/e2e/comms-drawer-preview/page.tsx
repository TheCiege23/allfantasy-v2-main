import CommsDrawerPreviewClient from './CommsDrawerPreviewClient'

/**
 * Screenshot harness for the comms drawer — sample data, no database, no sign-in. The /e2e layout
 * returns notFound() in production, so this never ships to allfantasy.ai.
 *
 * ?tab=league|chimmy|huddle|dms|discord   ?league=none (no league picked)   ?mode=light
 */
export default async function CommsDrawerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  return <CommsDrawerPreviewClient tab={sp.tab ?? 'league'} league={sp.league ?? 'L1'} mode={sp.mode ?? 'dark'} />
}
