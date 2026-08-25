/** READ-ONLY. How many leagues genuinely roster individual defenders? Never writes. */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring } from '../lib/core-app/scoringNotes'
import { extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

/**
 * Keys that CANNOT belong to a team-defense unit.
 *
 * Every Sleeper league ships bare `sack`/`int`/`ff`/`fum_rec`/`safe`/`def_td` as its DEF-unit
 * scoring. Tackle keys have no team equivalent, and an `idp_`-prefixed key is explicit.
 */
const STRICT = (k: string, v: unknown) =>
  typeof v === 'number' &&
  v !== 0 &&
  (k.startsWith('idp_') || ['tkl', 'tkl_solo', 'tkl_ast', 'tkl_loss'].includes(k))

async function main() {
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, settings: true },
  })
  let readable = 0
  let loose = 0
  let strict = 0
  const looseOnly: string[] = []

  for (const l of leagues) {
    const s = extractScoringSettings(l.settings)
    if (!s) continue
    readable++
    const isLoose = hasIdpScoring(s)
    const isStrict = Object.entries(s).some(([k, v]) => STRICT(k, v))
    if (isLoose) loose++
    if (isStrict) strict++
    if (isLoose && !isStrict) looseOnly.push(l.name ?? l.id)
  }

  console.log(`leagues total:                      ${leagues.length}`)
  console.log(`with readable scoring:              ${readable}`)
  console.log(`hasIdpScoring() says IDP:           ${loose}`)
  console.log(`carries a genuinely IDP-only key:   ${strict}`)
  console.log(`\nFALSE POSITIVES (loose but not strict): ${looseOnly.length}`)
  for (const n of looseOnly.slice(0, 12)) console.log(`   ${n}`)
  if (looseOnly.length > 12) console.log(`   ... and ${looseOnly.length - 12} more`)

  // Do any of those false positives actually roster a defender?
  console.log('\nDo the false-positive leagues roster defenders at all?')
  const sample = leagues.filter((l) => {
    const s = extractScoringSettings(l.settings)
    return s && hasIdpScoring(s) && !Object.entries(s).some(([k, v]) => STRICT(k, v))
  })
  let checked = 0
  let withDefenders = 0
  for (const l of sample.slice(0, 15)) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: l.id },
      select: { playerData: true },
    })
    const ids = new Set<string>()
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      const arr = pd.players
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string') ids.add(v)
    }
    if (ids.size === 0) continue
    checked++
    const defenders = await prisma.sportsPlayer.count({
      where: { sleeperId: { in: [...ids] }, position: { in: ['LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S'] } },
    })
    if (defenders > 0) withDefenders++
    console.log(`   ${(l.name ?? l.id).slice(0, 40).padEnd(42)} rostered=${ids.size} defenders=${defenders}`)
  }
  console.log(`\n${withDefenders}/${checked} false-positive leagues actually roster a defender.`)
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
