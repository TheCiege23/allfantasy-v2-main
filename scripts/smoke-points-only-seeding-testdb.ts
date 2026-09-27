/** Focused persisted seeding fixture; only accepts the known test database. */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { bootstrapLeaguePlayoffConfig } from '../lib/playoff-defaults/LeaguePlayoffBootstrapService'
import { getSeedingRulesForLeague } from '../lib/playoff-defaults/PlayoffSeedingResolver'
import { updateStandings } from '../lib/redraft/standingsEngine'
import { generateNflRedraftPlayoffRuntimeBracket } from '../lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }
async function main() {
 const host = new URL(process.env.DATABASE_URL ?? '').hostname
 check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
 check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
 configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
 const marker = 'seed-' + randomUUID().slice(0,8), users: string[] = []
 let leagueId: string | undefined
 try {
  for (let i=0; i<4; i++) users.push((await prisma.appUser.create({data:{username:marker+'-'+i,email:marker+'-'+i+'@example.invalid'}})).id)
  const v = validateCreatePayload({concept:'best_ball',sport:'NFL',teamCount:4,draftType:'snake',scoringPreset:'fb_ppr',leagueName:marker,timezone:'America/Chicago',conceptSetup:{bestBall:{matchupFormat:'cumulative',playoffTeams:2}}})
  if (!v.ok) throw new Error(v.error)
  leagueId=(await prisma.$transaction(tx=>createCanonicalLeagueInTransaction(tx,users[0],v.data,runPresetEngine({...v.data,commissionerId:users[0]})),{timeout:120000})).leagueId
  check((await prisma.league.findUniqueOrThrow({where:{id:leagueId}})).playoffSeedingRule === 'points_only', 'CANONICAL_SAVED_CHOICE')
  await bootstrapLeaguePlayoffConfig(leagueId)
  check((await getSeedingRulesForLeague(leagueId))?.seeding_rules === 'points_only', 'BOOTSTRAP_SAVED_CHOICE')
  const season=await prisma.redraftSeason.create({data:{leagueId,sport:'NFL',season:2026,totalWeeks:17,playoffStartWeek:16,currentWeek:16,status:'active'}})
  const rosters=[]
  for(let i=0;i<4;i++) rosters.push(await prisma.redraftRoster.create({data:{seasonId:season.id,leagueId,ownerId:users[i],ownerName:'Team '+(i+1)}}))
  await prisma.redraftMatchup.createMany({data:[{seasonId:season.id,leagueId,week:1,homeRosterId:rosters[0].id,awayRosterId:rosters[1].id,homeScore:100,awayScore:90,status:'final'},{seasonId:season.id,leagueId,week:1,homeRosterId:rosters[2].id,awayRosterId:rosters[3].id,homeScore:200,awayScore:210,status:'final'}]})
  await updateStandings(season.id,1)
  await updateStandings(season.id,1)
  const ranked=await prisma.redraftRoster.findMany({where:{seasonId:season.id},orderBy:{playoffSeed:'asc'}})
  check(ranked.map(r=>r.ownerId).join() === [users[3],users[2],users[0],users[1]].join(), 'POINTS_ONLY_STANDINGS')
  check(ranked[1].wins === 0 && ranked[1].pointsFor === 200,'NO_DUPLICATE_POINTS_ON_RETRY')
  await generateNflRedraftPlayoffRuntimeBracket({seasonId:season.id,playoffTeams:2,actorUserId:users[0],lockBracket:true})
  const seeds=await prisma.redraftPlayoffSeed.findMany({where:{seasonId:season.id},orderBy:{seed:'asc'}})
  check(seeds[0]?.rosterId===rosters[3].id && seeds[1]?.rosterId===rosters[2].id,'POINTS_ONLY_BRACKET_QUALIFIERS')
  console.log(JSON.stringify({teams:4,savedRule:'points_only',bootstrapPreserved:true,standingsTeams:ranked.map(r=>users.indexOf(r.ownerId)+1),playoffQualifiers:[4,3],recomputeIdempotent:true,limitations:'Fixture season and finalized matchup scores; no draft, optimizer, provider refresh or postseason advancement exercised.'},null,2))
 } finally {
  if(leagueId) await prisma.league.deleteMany({where:{id:leagueId}})
  await prisma.appUser.deleteMany({where:{id:{in:users}}})
  check(!leagueId || await prisma.league.count({where:{id:leagueId}})===0,'LEAGUE_CLEANUP')
  check(await prisma.appUser.count({where:{id:{in:users}}})===0,'USER_CLEANUP')
  console.log('Fixture cleanup verified: zero leagues and users remain')
  await prisma.$disconnect()
 }
}
main().catch(error=>{console.error('Seeding fixture failed:',error.message);process.exitCode=1})
