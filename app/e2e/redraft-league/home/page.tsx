import { renderRedraftLeagueHarness } from './harnessPage'

/** Redraft League home batch (A1) harness: League home. See ./harnessPage.tsx. 404 in production. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return renderRedraftLeagueHarness('home', searchParams)
}
