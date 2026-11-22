import 'server-only'

import { buildHardwood32Snapshot, HARDWOOD32_LEAGUE_ID, readHardwood32League } from './hardwood32'

const source = `https://api.sleeper.app/v1/league/${HARDWOOD32_LEAGUE_ID}`

async function readSleeper(path: string): Promise<unknown> {
  const response = await fetch(source + path, { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`Sleeper returned HTTP ${response.status}.`)
  return response.json()
}

export async function fetchHardwood32Snapshot() {
  const [league, rosters, users] = await Promise.all([
    readSleeper('').then(readHardwood32League),
    readSleeper('/rosters'),
    readSleeper('/users'),
  ])
  const { start_week, leg, last_scored_leg } = league.settings
  const weeks = new Map<number, unknown>()
  const last = Math.max(leg, last_scored_leg)
  for (let first = start_week; first <= last; first += 6) {
    const batch = await Promise.all(Array.from({ length: Math.min(6, last - first + 1) }, async (_, index) => {
      const week = first + index
      return [week, await readSleeper(`/matchups/${week}`)] as const
    }))
    for (const [week, rows] of batch) weeks.set(week, rows)
  }
  return buildHardwood32Snapshot({ league, rosters, users, weeks }, new Date().toISOString())
}
