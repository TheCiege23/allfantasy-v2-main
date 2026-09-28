/** Run with an explicitly authorized DATABASE_URL. Enforces READ ONLY at the database. */
const { Client } = require('pg')
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query('BEGIN READ ONLY')
    await db.query("SET LOCAL statement_timeout = '20s'")
    const queries = {
      draftIndexes: "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='draft_sessions' AND indexname LIKE '%leagueId%'",
      openDraftConflicts: 'SELECT count(*)::int AS leagues FROM (SELECT "leagueId" FROM draft_sessions WHERE status <> \'completed\' GROUP BY 1 HAVING count(*)>1) d',
      identityImages: 'SELECT sport,count(*)::int AS rows,count(*) FILTER(WHERE NULLIF("imageUrl",\'\') IS NOT NULL)::int AS images FROM "SportsPlayer" GROUP BY sport ORDER BY sport',
      teamLogos: 'SELECT sport,count(*)::int AS rows,count(*) FILTER(WHERE NULLIF(logo,\'\') IS NOT NULL)::int AS logos FROM "SportsTeam" GROUP BY sport ORDER BY sport',
      adpCoverage: 'SELECT sport,season,source,count(*)::int AS rows,max(created_at) AS latest FROM adp_data WHERE season >= 2025 GROUP BY 1,2,3 ORDER BY 1,2,3',
      seasonStats: 'SELECT sport,season,source,count(*)::int AS rows,count(*) FILTER(WHERE "fantasyPointsPerGame" IS NOT NULL)::int AS with_ppg,max("updatedAt") AS latest FROM player_season_stats WHERE season::text IN (\'2025\',\'2026\',\'2025-2026\',\'2026-2027\') GROUP BY 1,2,3 ORDER BY 1,2,3',
    }
    const report = { observedAt: new Date().toISOString() }
    for (const [name, sql] of Object.entries(queries)) report[name] = (await db.query(sql)).rows
    await db.query('ROLLBACK')
    console.log(JSON.stringify(report, null, 2))
  } finally { await db.end() }
}
main().catch(error => { console.error('Read-only audit failed:', error.code || error.name); process.exitCode = 1 })
