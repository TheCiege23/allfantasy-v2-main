/**
 * Harness-only fetch stub so the import screen can be reviewed in its real states with no
 * database: ESPN reads as connected or not, and a Sleeper lookup returns a long league list.
 *
 * An inline <script>, not a client effect: it has to run before the app's own fetch wrappers
 * capture `window.fetch`, or they keep calling the real one. Never shipped outside /e2e.
 */
import { headers } from 'next/headers'

const NAMES = [
  'KBI Smoke Black', 'KBFL', 'Parbur', 'Its gonna be Maye 26', 'The Deep!', 'Sunday Night Redraft',
  'Office Dynasty', 'Taco Tuesday Superflex', 'Waiver Wire Wizards — 2QB Salary Cap Keeper League',
  'Gridiron Ghosts', 'Bench Mob', 'Red Zone Rejects',
]

export async function MockFetch({ mode }: { mode: string }) {
  // Under the nonce CSP an inline script without this request's nonce is refused.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const leagues = NAMES.map((name, i) => ({
    sourceId: `11800000000000000${String(i).padStart(2, '0')}`,
    name,
    sport: i === 5 ? 'nba' : 'nfl',
    season: '2026',
    totalTeams: i === 1 ? 32 : 12,
    previouslyDeleted: i === 3,
  }))
  const code = `(() => {
    const mode = ${JSON.stringify(mode)};
    const leagues = ${JSON.stringify(leagues)};
    const real = window.fetch.bind(window);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/league/auth')) return json({ auths: mode === 'espn-connected' ? [{ platform: 'espn', hasEspnCookies: true, updatedAt: '2026-11-01T00:00:00Z' }] : [] });
      if (url.includes('/api/leagues/import/discover')) return json(mode === 'leagues' ? { leagues, accountLabel: 'ciege82' } : { leagues: [] });
      if (url.includes('/api/leagues/import/preview')) {
        await new Promise((r) => setTimeout(r, 900));
        return json({
          league: { name: 'Taco Tuesday Superflex' },
          importable: true,
          dataQuality: {
            coverageNarrative: { sentence: 'Sleeper does not publish trade history from before 2024.', missing: [], partial: ['tradeHistory'] },
            coverageSummary: [
              { key: 'leagueSettings', state: 'full' }, { key: 'currentRosters', state: 'full', count: 12 },
              { key: 'scoringSettings', state: 'full' }, { key: 'currentStandings', state: 'full' },
              { key: 'currentSchedule', state: 'full' }, { key: 'draftHistory', state: 'full', count: 3 },
              { key: 'tradeHistory', state: 'partial', count: 41 }, { key: 'previousSeasons', state: 'full', count: 3 },
              { key: 'playerIdentityMap', state: 'full' },
            ],
          },
        });
      }
      if (url.includes('/api/leagues/import/commit')) {
        // Long enough to see the progress screen.
        await new Promise((r) => setTimeout(r, mode === 'slow' ? 60000 : 6000));
        return json({ leagueId: 'lg_demo', name: 'Taco Tuesday Superflex', historicalBackfill: { backfill: { success: true, seasonsDiscovered: 3, seasonsImported: 3, seasonsSkipped: 0 } } });
      }
      return real(input, init);
    };
  })();`
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: code }} />
}
