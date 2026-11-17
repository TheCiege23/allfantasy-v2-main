import HomeLayoutHarnessClient from './HomeLayoutHarnessClient'

/**
 * DB-free render of the /core home body (Dashboard3A) inside the real AfCoreShell, for checking the
 * two-column layout. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/home-layout                 the default layout (routine + matchups hidden, side cards on)
 *   /e2e/home-layout?main=1          with the main column's cards switched on
 *   /e2e/home-layout?side=0          with every side card switched off
 */
export default async function HomeLayoutHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <HomeLayoutHarnessClient main={sp.main === '1'} side={sp.side !== '0'} />
}
