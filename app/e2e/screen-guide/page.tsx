import ScreenGuideHarnessClient from './ScreenGuideHarnessClient'

/**
 * DB-free render of the "What's this page?" strip and the "How AllFantasy works" sheet inside the
 * real AfCoreShell (2026-11-20). The screen body is a SAMPLE placeholder. Production is refused by
 * app/e2e/layout.tsx.
 *
 *   /e2e/screen-guide?screen=my-team            the strip for /core/my-team
 *   /e2e/screen-guide?screen=waivers&league=x   inside a league (links keep the league)
 *   /e2e/screen-guide?screen=                   the cross-league Home
 */
export default async function ScreenGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const screen = typeof sp.screen === 'string' ? sp.screen : 'my-team'
  return <ScreenGuideHarnessClient screen={screen} />
}
