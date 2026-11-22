import 'server-only'

import { unstable_cache } from 'next/cache'
import { buildHardwood32Snapshot, HARDWOOD32_LEAGUE_ID, HARDWOOD32_WEEK } from './hardwood32'

const source = `https://api.sleeper.app/v1/league/${HARDWOOD32_LEAGUE_ID}`

async function readSleeper(path: string): Promise<unknown> {
  const response = await fetch(source + path, { signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`Sleeper returned HTTP ${response.status}.`)
  return response.json()
}

export const fetchHardwood32Snapshot = unstable_cache(async () => {
  const [league, rosters, users, matchups] = await Promise.all([
    readSleeper(''),
    readSleeper('/rosters'),
    readSleeper('/users'),
    readSleeper(`/matchups/${HARDWOOD32_WEEK}`),
  ])
  return buildHardwood32Snapshot({ league, rosters, users, matchups }, new Date().toISOString())
}, ['staging-hardwood-32', 'week-4'], { revalidate: 60 })
