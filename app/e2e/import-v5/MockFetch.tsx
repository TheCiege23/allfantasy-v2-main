/**
 * Harness-only fetch stub so the import screen can be reviewed in its real states with no
 * database: ESPN reads as connected or not, and a Sleeper lookup returns a long league list.
 *
 * An inline <script>, not a client effect: it has to run before the app's own fetch wrappers
 * capture `window.fetch`, or they keep calling the real one. Never shipped outside /e2e.
 */
import { getRequestNonce } from '@/lib/security/requestNonce'

const NAMES = [
  'KBI Smoke Black', 'KBFL', 'Parbur', 'Its gonna be Maye 26', 'The Deep!', 'Sunday Night Redraft',
  'Office Dynasty', 'Taco Tuesday Superflex', 'Waiver Wire Wizards — 2QB Salary Cap Keeper League',
  'Gridiron Ghosts', 'Bench Mob', 'Red Zone Rejects',
]

export async function MockFetch({ mode }: { mode: string }) {
  // Under the nonce CSP an inline script without this request's nonce is refused.
  const nonce = await getRequestNonce()
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
    // ?mock=yahoo-paste — the Yahoo copy-paste panel. Each "Read this page" answers with the next page
    // in this order, so clicking through shows every checklist state. Other modes keep it hidden.
    const ys = { pages: [], order: ['settings', 'standings', 'roster', 'draft'] };
    const ysTeams = ['Turf Toe', 'Gridiron Ghosts', 'Fourth & Long', 'Punt Club', 'Bench Mob', 'Red Zone Rejects'];
    const ysBase = 'https://football.fantasysports.yahoo.com/f1/987654';
    const ysChecklist = () => {
      const has = (k) => ys.pages.includes(k);
      const missing = [!has('settings') && 'League settings', !has('standings') && 'Standings'].filter(Boolean);
      return {
        leagueId: '987654', leagueName: has('settings') ? 'Sunday Funday' : null,
        settings: has('settings'), standings: has('standings'), draft: has('draft'),
        teams: has('standings') ? ysTeams.map((name, i) => ({ name, hasRoster: has('roster') && i === 0 })) : [],
        unmatchedRosters: [], ready: missing.length === 0, missing,
        links: { settings: ysBase + '/settings', standings: ysBase, draft: ysBase + '/draftresults' },
      };
    };
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/leagues/import/yahoo-snapshot')) {
        if (mode !== 'yahoo-paste') return json({ enabled: false });
        const method = (init && init.method) || 'GET';
        if (method === 'DELETE') { ys.pages = []; return json({ ok: true }); }
        if (method === 'POST') {
          // Record what actually arrived, so a bookmark hand-off can be checked byte for byte.
          try { const t = init.body && init.body.get && init.body.get('text'); window.__afLastPaste = { league: init.body.get('league'), length: t ? t.length : 0, head: t ? t.slice(0, 400) : '', text: t || '' }; } catch (e) {}
          await new Promise((r) => setTimeout(r, 700));
          const next = ys.order.find((k) => !ys.pages.includes(k)) || 'roster';
          if (!ys.pages.includes(next)) ys.pages.push(next);
          return json({ enabled: true, sourceId: 'yahoo-snapshot:987654', page: next, team: next === 'roster' ? 'Turf Toe' : undefined, checklist: ysChecklist() });
        }
        return url.includes('league=') ? json({ enabled: true, sourceId: 'yahoo-snapshot:987654', checklist: ysChecklist() }) : json({ enabled: true });
      }
      if (mode === 'yahoo-paste' && url.includes('/api/leagues/import/preview')) {
        await new Promise((r) => setTimeout(r, 700));
        return json({ league: { name: 'Sunday Funday', season: 2026, teamCount: 6, settings: { scoringLabel: 'PPR' } }, managers: [], rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'W/R/T', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'], draftPickCount: 90 });
      }
      if (mode === 'yahoo-paste' && url.includes('/api/leagues/import/commit')) {
        await new Promise((r) => setTimeout(r, 900));
        return json({ leagueId: 'lg_demo', league: { id: 'lg_demo', name: 'Sunday Funday', sport: 'NFL' } });
      }
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
