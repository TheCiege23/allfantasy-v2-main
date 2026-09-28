/** Authorized read-only cache coverage. Never calls resolvers, providers, or cache writers. */
const {Client}=require('pg')
async function main(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED')
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect()
 try{
  await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='20s'")
  const report={observedAt:new Date().toISOString(),scope:'Stored SportsPlayerRecord cache and its top 300 ADP candidates per sport; not exact resolved league pools, URL reachability, or season-qualified stats.'}
  report.cacheCoverage=(await db.query(`SELECT sport,count(*)::int AS rows,
   count(*) FILTER(WHERE NULLIF(headshot_url,'') IS NOT NULL OR NULLIF(headshot_url_sm,'') IS NOT NULL OR NULLIF(headshot_url_lg,'') IS NOT NULL)::int AS with_headshot,
   count(*) FILTER(WHERE NULLIF(logo_url,'') IS NOT NULL)::int AS with_logo,
   count(*) FILTER(WHERE stats IS NOT NULL AND stats::text NOT IN ('{}','null','[]'))::int AS with_stats_object,
   count(*) FILTER(WHERE adp>0)::int AS with_adp,max(last_updated) AS newest_update
   FROM sports_players GROUP BY sport ORDER BY sport`)).rows
  report.topAdpCandidates=(await db.query(`WITH ranked AS (SELECT *,row_number() OVER(PARTITION BY sport ORDER BY adp,id) AS rank FROM sports_players WHERE adp>0)
   SELECT sport,count(*)::int AS candidates,
   count(*) FILTER(WHERE NULLIF(headshot_url,'') IS NOT NULL OR NULLIF(headshot_url_sm,'') IS NOT NULL OR NULLIF(headshot_url_lg,'') IS NOT NULL)::int AS with_headshot,
   count(*) FILTER(WHERE NULLIF(logo_url,'') IS NOT NULL)::int AS with_logo,
   count(*) FILTER(WHERE stats IS NOT NULL AND stats::text NOT IN ('{}','null','[]'))::int AS with_stats_object,
   min(last_updated) AS oldest_update,max(last_updated) AS newest_update FROM ranked WHERE rank<=300 GROUP BY sport ORDER BY sport`)).rows
  report.identityHeadshotFallback=(await db.query(`WITH ranked AS (SELECT *,row_number() OVER(PARTITION BY sport ORDER BY adp,id) AS rank FROM sports_players WHERE adp>0),
   candidates AS (SELECT * FROM ranked WHERE rank<=300)
   SELECT r.sport,r.position,count(*)::int AS candidate_records,
   count(*) FILTER(WHERE EXISTS(SELECT 1 FROM "SportsPlayer" p WHERE p.sport=r.sport AND
    (p."externalId"=r.id OR p."sleeperId"=r.id OR (lower(p.name)=lower(r.name) AND upper(p.position)=upper(r.position)))
    AND NULLIF(p."imageUrl",'') IS NOT NULL))::int AS with_identity_image_candidate
   FROM candidates r GROUP BY r.sport,r.position ORDER BY r.sport,r.position`)).rows
  await db.query('ROLLBACK');console.log(JSON.stringify(report,null,2))
 }finally{await db.end()}
}
main().catch(e=>{console.error('Read-only coverage audit failed:',e.code??e.name);process.exitCode=1})
