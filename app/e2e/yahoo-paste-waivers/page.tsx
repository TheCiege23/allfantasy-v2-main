import YahooPasteWaiversHarnessClient from './YahooPasteWaiversHarnessClient'

/**
 * DB-free render of a PASTED Yahoo league's Waivers page (lib/core-app/declaredAvailability.ts): the
 * "Worth adding" board and Chimmy's recommendations, in the two states the coverage bar decides. Every
 * figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/yahoo-paste-waivers                   below the bar: "We can't verify who's available…"
 *   /e2e/yahoo-paste-waivers?state=verified    above it: the list, and "N players … couldn't be matched"
 */
export default async function YahooPasteWaiversHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <YahooPasteWaiversHarnessClient verified={sp.state === 'verified'} />
}
