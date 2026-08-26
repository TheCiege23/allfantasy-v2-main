import type { FantasyCalcSettings } from '@/lib/fantasycalc'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc-fetch'
import { writeFantasyCalcValuesToDb } from '@/lib/fantasycalc-db'

const DEFAULT_SETTINGS: FantasyCalcSettings[] = [
  { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 },
  { isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 },
  { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 },
]

function parseProfilesArg(): FantasyCalcSettings[] {
  const arg = process.argv.find((value) => value.startsWith('--profiles='))
  if (!arg) return DEFAULT_SETTINGS

  const raw = arg.split('=')[1] ?? ''
  const requested = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)

  if (!requested.length) return DEFAULT_SETTINGS

  const result: FantasyCalcSettings[] = []
  for (const token of requested) {
    if (token === 'dynasty_sf') {
      result.push({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })
    } else if (token === 'dynasty_1qb') {
      result.push({ isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 })
    } else if (token === 'redraft_1qb') {
      result.push({ isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 })
    }
  }

  return result.length ? result : DEFAULT_SETTINGS
}

async function main() {
  const profiles = parseProfilesArg()
  const ttlHoursArg = process.argv.find((value) => value.startsWith('--ttlHours='))
  const ttlHours = Number((ttlHoursArg?.split('=')[1] ?? '6').trim())
  const ttlMs = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : 6 * 60 * 60 * 1000

  console.log(`[FantasyCalc Sync] starting (${profiles.length} profile(s), ttl=${Math.round(ttlMs / 3600000)}h)`)

  let totalPlayers = 0
  for (const settings of profiles) {
    const label = `${settings.isDynasty ? 'dynasty' : 'redraft'}-${settings.numQbs}qb-${settings.numTeams}t-ppr${settings.ppr}`
    console.log(`[FantasyCalc Sync] fetching ${label}`)

    const players = await fetchFantasyCalcValues(settings)
    const writeResult = await writeFantasyCalcValuesToDb(settings, players, { ttlMs })
    totalPlayers += players.length

    console.log(
      `[FantasyCalc Sync] stored ${label}: ${writeResult.count} players, key=${writeResult.cacheKey}, expires=${writeResult.expiresAt.toISOString()}`
    )
  }

  console.log(`[FantasyCalc Sync] complete (${totalPlayers} total players written)`)
}

main().catch((error) => {
  console.error('[FantasyCalc Sync] failed:', error)
  process.exit(1)
})
