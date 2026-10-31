import { renderRedraftLeagueHarness } from '../home/harnessPage'

/** Redraft League home batch (A1) harness: Draft HQ (DraftTab). See ../home/harnessPage.tsx. 404 in production. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return renderRedraftLeagueHarness('draft', searchParams)
}
