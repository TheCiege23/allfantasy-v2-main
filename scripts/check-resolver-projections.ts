import { PrismaClient } from '@prisma/client'
import { getResolvedDraftPoolForLeague } from '../lib/draft-room/getResolvedDraftPoolForLeague'

const p = new PrismaClient()
;(async () => {
  // Find an NFL league
  // Target the user's actual zombie league from the screenshot.
  const league = await p.league.findFirst({
    where: { id: '2a58f9c6-a6e5-4985-85da-c1ce7a792269' },
    select: { id: true, name: true, sport: true },
  })
  if (!league) {
    console.log('NO_NFL_LEAGUE')
    await p.$disconnect()
    return
  }
  console.log('league:', league)

  const result = await getResolvedDraftPoolForLeague(league.id)
  console.log('entries count:', result.entries?.length ?? 0)
  console.log('sport:', result.sport)

  const entries = (result.entries ?? []) as any[]
  const withSplits = entries.filter((e) => e.nflDraftProjectionSplits != null)
  const bySource: Record<string, number> = {}
  let withRushYds = 0, withRecYds = 0, withPassYds = 0
  for (const e of withSplits) {
    const s = e.nflDraftProjectionSplits as any
    const k = String(s?.source ?? 'null')
    bySource[k] = (bySource[k] ?? 0) + 1
    if (s?.rushing?.yds != null) withRushYds++
    if (s?.receiving?.yds != null) withRecYds++
    if (s?.passing?.yds != null) withPassYds++
  }
  console.log('entries with splits:', withSplits.length, '/', entries.length)
  console.log('splits by source:', bySource)
  console.log('per-stat populated counts:', { withRushYds, withRecYds, withPassYds })

  const btj = entries.find((e: any) => /brian thomas/i.test(e.name ?? ''))
  if (btj) {
    console.log('Brian Thomas Jr. entry keys:', Object.keys(btj))
    console.log('  name:', btj.name)
    console.log('  position:', btj.position)
    console.log('  sport:', btj.sport)
    console.log('  nflDraftProjectionSplits:', JSON.stringify((btj as any).nflDraftProjectionSplits, null, 2))
    console.log('  display.stats:', JSON.stringify((btj as any).display?.stats, null, 2))
  } else {
    console.log('no Brian Thomas Jr. found; first 3 names:', result.entries?.slice(0, 3).map((e: any) => e.name))
    const sample = result.entries?.find((e: any) => (e as any).nflDraftProjectionSplits != null)
    if (sample) {
      console.log('sample with splits:', sample.name, JSON.stringify((sample as any).nflDraftProjectionSplits))
    } else {
      console.log('NO ENTRIES HAVE nflDraftProjectionSplits')
    }
  }
  await p.$disconnect()
})()
