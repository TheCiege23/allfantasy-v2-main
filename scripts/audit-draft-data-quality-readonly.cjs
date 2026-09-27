/** Read-only stored draft-data inventory. Never calls a provider or invokes a resolver. */
const { Client } = require('pg')
const sports = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED')
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000 })
  try {
    await db.connect()
    await db.query('BEGIN READ ONLY')
    await db.query("SET LOCAL statement_timeout='20s'")
    const readOnly = (await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only
    if (readOnly !== 'on') throw new Error('READ_ONLY_REQUIRED')
    const boards = (await db.query(`WITH latest AS (
      SELECT DISTINCT ON (sport, format, scoring, source) sport, format, scoring, source, season, week
      FROM adp_data WHERE sport = ANY($1::text[])
      ORDER BY sport, format, scoring, source, season DESC, week DESC, created_at DESC
    ) SELECT a.sport, a.format, a.scoring, a.source, a.season, a.week,
      count(*)::int AS rows, count(DISTINCT a.player_id)::int AS players,
      count(*) FILTER (WHERE a.adp <= 0 OR a.adp::text IN ('NaN','Infinity','-Infinity'))::int AS invalid,
      min(a.adp) AS minimum, max(a.adp) AS maximum, max(a.created_at) AS updated
      FROM adp_data a JOIN latest l USING(sport,format,scoring,source,season,week)
      GROUP BY a.sport,a.format,a.scoring,a.source,a.season,a.week
      ORDER BY a.sport,a.format,a.scoring,a.source`, [sports])).rows
    const storedPlayers = (await db.query(`SELECT sport, count(*)::int AS players,
      count(*) FILTER (WHERE adp > 0)::int AS positive_adp,
      count(*) FILTER (WHERE NULLIF(headshot_url,'') IS NOT NULL)::int AS headshot_candidates,
      count(*) FILTER (WHERE NULLIF(logo_url,'') IS NOT NULL)::int AS logo_candidates,
      count(*) FILTER (WHERE stats::jsonb NOT IN ('{}'::jsonb,'null'::jsonb))::int AS nonempty_stats,
      max(last_updated) AS updated FROM sports_players WHERE sport = ANY($1::text[]) GROUP BY sport ORDER BY sport`, [sports])).rows
    const identityAssets = (await db.query(`SELECT sport, count(*)::int AS identities,
      count(*) FILTER (WHERE NULLIF("imageUrl",'') IS NOT NULL)::int AS image_candidates
      FROM "SportsPlayer" WHERE sport = ANY($1::text[]) GROUP BY sport ORDER BY sport`, [sports])).rows
    await db.query('ROLLBACK')
    console.log(JSON.stringify({ asOf: new Date().toISOString(), transactionReadOnly: true,
      scope: 'Stored cache inventory only. Counts are not a deduplicated active draft pool, verified identity, reachable media, observed current-season stats, or live browser acceptance.', sports, boards, storedPlayers, identityAssets }, null, 2))
  } finally { await db.end() }
}
main().catch(error => { console.error('Read-only draft inventory failed:', error.code ?? error.name); process.exitCode = 1 })
