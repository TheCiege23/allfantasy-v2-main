/** Test fixtures only; refuses every host except the known isolated test database. */
async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
  const knownNeonTestDb = databaseUrl.hostname.startsWith('ep-muddy-leaf-') && databaseUrl.hostname.endsWith('.neon.tech')
  const isolatedLocalDb = process.env.AF_LOCAL_LEAGUE_RUNTIME === '1' && databaseUrl.hostname === '127.0.0.1' &&
    databaseUrl.port === '54327' && databaseUrl.pathname === '/allfantasy_staging'
  if (!knownNeonTestDb && !isolatedLocalDb) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  globalThis.fetch=async()=>{throw new Error('EXTERNAL_HTTP_DISABLED')}
  const {prisma}=await import('../lib/prisma')
  const {getEffectiveLeagueRosterTemplate,starterEligiblePlayerPositionsFromTemplate}=await import('../lib/league/getEffectiveLeagueRosterTemplate')
  const {rosterFingerprintFromEligible}=await import('../lib/draft-room/draft-pool-eligible-positions')
  const leagueId=process.argv[2]
  const template=await getEffectiveLeagueRosterTemplate(leagueId)
  const eligible=starterEligiblePlayerPositionsFromTemplate(template.template)
  const rosterFp=(template.hasPersistedRosterSchema?'cfg':'nocfg')+':starters:'+rosterFingerprintFromEligible(eligible.size?eligible:new Set(template.allowedPositions))
  const ctx={standardCacheKey:'native-auth-fixture:'+leagueId,rosterFp}
  const league=await prisma.league.findUniqueOrThrow({where:{id:leagueId}})
  if(!league.name?.startsWith('native-browser-'))throw new Error('SYNTHETIC_BROWSER_LEAGUE_REQUIRED')
  await prisma.draftSession.updateMany({where:{leagueId,status:'pre_draft'},data:{timerSeconds:3600}})
  const entries=Array.from({length:8},(_,i)=>({playerId:league.name+'-p'+(i+1),name:'Fixture Receiver '+(i+1),position:'WR',team:'BUF',adp:i+1}))
  await prisma.draftPoolCache.create({data:{leagueId,cacheKey:ctx.standardCacheKey,sourceFingerprint:ctx.rosterFp,entryCount:entries.length,sport:'NFL',poolType:'pro',expiresAt:new Date(Date.now()+3600000),payload:{entries,sport:'NFL',count:entries.length,rosterConfigurationIncomplete:false}}})
  await prisma.$disconnect()
}
main().catch((error)=>{console.error(error);process.exitCode=1})
