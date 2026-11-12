import HomeGuideHarnessClient from './HomeGuideHarnessClient'

/**
 * DB-free render of the /core home's guide layout (2026-11-12) inside the real AfCoreShell: the
 * headline, the tiered decision queue with its "why it matters" lines, the leagues-you-run card and
 * the season pulse. Every figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/home-guide                 a manager who also runs leagues
 *   /e2e/home-guide?role=player     a manager who runs none — the commissioner card is absent
 *   /e2e/home-guide?empty=1         a quiet day — nothing needs you
 */
export default async function HomeGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <HomeGuideHarnessClient commissioner={sp.role !== 'player'} empty={sp.empty === '1'} />
}
