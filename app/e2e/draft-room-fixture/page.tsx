import { notFound } from 'next/navigation'
import { getRequestNonce } from '@/lib/security/requestNonce'
import DraftRoomFixtureHarnessClient from './DraftRoomFixtureHarnessClient'
import { FIXTURE_LEAGUE_ID, fixtureApiResponses } from './fixtures'

/**
 * DB-free render of the REAL live draft room (`DraftBoard kind="live"` → `DraftRoomPageClient`), a
 * 10-team NFL snake draft at pick 2.04 with the viewer on the clock. Every name is SAMPLE data.
 *
 * /e2e/draft-room needs its API calls stubbed per Playwright test and otherwise sits on "Loading…";
 * this one seeds the first paint from `initialSnapshot` (as /drafts/[draftId] does) and answers the
 * room's own requests from an inline fetch stub (the /e2e/import-v5 MockFetch pattern), so it can be
 * opened in a browser and measured. Production is refused here and by app/e2e/layout.tsx.
 */
export const dynamic = 'force-dynamic'

export default async function DraftRoomFixturePage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const fx = fixtureApiResponses(Date.now())
  // Under the nonce CSP an inline script without this request's nonce is refused.
  const nonce = await getRequestNonce()
  // An inline <script>, not a client effect: it must replace fetch before the room's own wrappers run.
  const code = `(() => {
    const leagueBase = ${JSON.stringify(`/api/leagues/${FIXTURE_LEAGUE_ID}/`)};
    const league = ${JSON.stringify(fx.league)};
    const global = ${JSON.stringify(fx.global)};
    const real = window.fetch.bind(window);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return real(input, init);
      const p = url.pathname;
      if (p.startsWith(leagueBase)) {
        const rest = p.slice(leagueBase.length);
        if (Object.prototype.hasOwnProperty.call(league, rest)) return json(league[rest]);
        return json({});
      }
      if (Object.prototype.hasOwnProperty.call(global, p)) return json(global[p]);
      // Nothing in this harness may reach a route that touches the database.
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    };
  })();`
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: code }} />
      <DraftRoomFixtureHarnessClient initialSnapshot={fx.snapshot} poolCount={(fx.league['draft/pool'] as { count: number }).count} />
    </>
  )
}
