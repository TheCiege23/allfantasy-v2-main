/**
 * Backfill `SportsPlayer.dob` for NFL defenders from the nflverse players release.
 *
 *   npx tsx scripts/backfill-player-dob.ts          # DRY RUN — reports, writes nothing
 *   npx tsx scripts/backfill-player-dob.ts --write   # applies
 *   npx tsx scripts/backfill-player-dob.ts --all     # every NFL position, not just defenders
 *
 * WHY. `dob` is populated on 0 of 583 rostered defenders, so the only join available to
 * `lib/idp-projections/draftCapital.ts` is name + college + position — and Sleeper says
 * "Ole Miss" where nflverse says "Mississippi", which pushed 25% of that join onto a
 * unique-name fallback. A real birth date makes the key deterministic.
 *
 * It also unblocks the exact-age work: `coercePlayerAge` and `birthDateFromVendorValue` in
 * `lib/sports-data/playerAge.ts` already exist and have had nothing to read.
 *
 * ⚠ DRY RUN IS THE DEFAULT AND THE TARGET IS PRINTED, because `.env` and `.env.local` in this
 * repo point at PRODUCTION. There is deliberately NO hostname guard: a substring check on the
 * connection string is exactly the guard that was found inverted in `-nonprod` scripts, passing
 * on prod and refusing on test. Read the printed target instead.
 *
 * ⚠ ONLY UNAMBIGUOUS MATCHES ARE WRITTEN. A wrong birth date is worse than a missing one — it
 * would silently key the draft-capital join to the wrong man, which is the failure the whole
 * ordering in `draftCapital.ts` exists to avoid.
 */
import { PrismaClient } from '@prisma/client'

const PLAYERS =
  'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'

const APPLY = process.argv.includes('--write')
const ALL_POSITIONS = process.argv.includes('--all')

const DEFENSIVE = ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'EDGE', 'OLB', 'ILB', 'MLB', 'SS', 'FS', 'NT']

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function positionGroup(pos: string): string {
  const p = pos.toUpperCase().trim()
  if (['CB', 'S', 'SS', 'FS', 'SAF', 'DB'].includes(p)) return 'DB'
  if (['DE', 'DT', 'NT', 'DL', 'EDGE'].includes(p)) return 'DL'
  if (['LB', 'OLB', 'ILB', 'MLB'].includes(p)) return 'LB'
  return p
}

async function main() {
  const prisma = new PrismaClient()

  const url = process.env.DATABASE_URL ?? ''
  const host = url.match(/@([^/:]+)/)?.[1] ?? '(unknown)'
  console.log(`DB target host: ${host}`)
  console.log(APPLY ? 'MODE: WRITE' : 'MODE: DRY RUN (pass --write to apply)')
  console.log(ALL_POSITIONS ? 'SCOPE: all NFL positions' : 'SCOPE: defenders only')
  console.log('')

  const res = await fetch(PLAYERS)
  if (!res.ok) throw new Error(`${res.status} fetching players.csv`)
  const lines = (await res.text()).split('\n').filter((l) => l.trim().length > 0)
  const header = splitCsvLine(lines[0])
  const col = (n: string) => {
    const i = header.indexOf(n)
    if (i < 0) throw new Error(`players.csv has no column "${n}" — header changed upstream`)
    return i
  }
  const iName = col('display_name')
  const iCollege = col('college_name')
  const iPos = col('position')
  const iGroup = col('position_group')
  const iBirth = col('birth_date')

  /** name+college+posGroup -> dob, and name -> dobs (to detect ambiguity). */
  const byKey = new Map<string, string>()
  const byName = new Map<string, Set<string>>()

  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i])
    const birth = (f[iBirth] ?? '').trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) continue
    const n = normalizeName(f[iName] ?? '')
    if (!n) continue
    const grp = positionGroup(f[iGroup] || f[iPos] || '')
    const college = ((f[iCollege] ?? '').split(';')[0] ?? '').toLowerCase().trim()
    if (college) byKey.set(`${n}|${college}|${grp}`, birth)
    const set = byName.get(n) ?? new Set<string>()
    set.add(birth)
    byName.set(n, set)
  }
  console.log(`nflverse rows with a birth date: ${byName.size} distinct names`)

  const targets = await prisma.sportsPlayer.findMany({
    where: {
      sport: 'NFL',
      source: 'sleeper',
      dob: null,
      ...(ALL_POSITIONS ? {} : { position: { in: DEFENSIVE } }),
    },
    select: { id: true, name: true, college: true, position: true },
  })
  console.log(`our NFL players missing dob: ${targets.length}`)

  let viaKey = 0
  let viaUniqueName = 0
  let ambiguous = 0
  let noMatch = 0
  const updates: Array<{ id: string; dob: string; how: string; name: string }> = []

  for (const p of targets) {
    const n = normalizeName(p.name)
    const college = (p.college ?? '').toLowerCase().trim()
    const grp = positionGroup(p.position ?? '')

    const keyed = college ? byKey.get(`${n}|${college}|${grp}`) : undefined
    if (keyed) {
      viaKey++
      updates.push({ id: p.id, dob: keyed, how: 'name+college+pos', name: p.name })
      continue
    }
    const set = byName.get(n)
    if (!set) {
      noMatch++
      continue
    }
    if (set.size === 1) {
      viaUniqueName++
      updates.push({ id: p.id, dob: [...set][0], how: 'unique name', name: p.name })
      continue
    }
    /*
     * The same name maps to more than one birth date upstream. Writing either would attach one
     * man's identity to another — refuse, and let him keep a null dob.
     */
    ambiguous++
  }

  console.log('')
  console.log(`resolvable via name+college+pos: ${viaKey}`)
  console.log(`resolvable via unique name:      ${viaUniqueName}`)
  console.log(`AMBIGUOUS (refused):             ${ambiguous}`)
  console.log(`no match upstream:               ${noMatch}`)
  console.log(`>> would write ${updates.length} of ${targets.length}`)
  console.log('')
  console.log('sample:')
  for (const u of updates.slice(0, 8)) {
    console.log(`  ${u.name.padEnd(24)} ${u.dob}   [${u.how}]`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Pass --write to apply.')
    await prisma.$disconnect()
    return
  }

  let written = 0
  for (const u of updates) {
    await prisma.sportsPlayer.update({ where: { id: u.id }, data: { dob: u.dob } })
    written++
  }
  /*
   * Counted from the table, not from the loop. A count of attempts is not a count of rows —
   * the same mistake that once reported 3,427 seeded stat lines into an empty table.
   */
  const verified = await prisma.sportsPlayer.count({
    where: {
      sport: 'NFL',
      source: 'sleeper',
      dob: { not: null },
      ...(ALL_POSITIONS ? {} : { position: { in: DEFENSIVE } }),
    },
  })
  console.log(`\nattempted ${written} updates; ${verified} rows now carry a dob.`)

  await prisma.$disconnect()
}

void main()
