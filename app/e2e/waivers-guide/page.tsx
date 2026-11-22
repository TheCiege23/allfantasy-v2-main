import WaiversGuideHarnessClient from './WaiversGuideHarnessClient'

/**
 * DB-free render of a league's Waivers page with the 2026-11-13 guide: the "Best pickup" headline,
 * the plain "Worth adding" rows, the claim button, and the folded notes. Every figure is SAMPLE data.
 * Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/waivers-guide          a rolling-priority league
 *   /e2e/waivers-guide?faab=1   a FAAB league: Waiver intelligence and Competitive edge as well
 */
export default async function WaiversGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <WaiversGuideHarnessClient faab={sp.faab === '1'} />
}
