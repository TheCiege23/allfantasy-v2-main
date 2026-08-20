/**
 * Rolling Insights player-id crosswalk.
 *
 *   npx tsx scripts/build-ri-player-crosswalk.ts [--write]
 *
 * ⚠ THIS EXISTS BECAUSE RI PLAYER IDS ARE NOT SLEEPER PLAYER IDS, AND THE SPACES
 * COLLIDE NUMERICALLY. Verified in production before this was written:
 *
 *     RI 8735 = Ollie Gordon II (RB)  ->  our sleeper:8735 = Jairon McVea (DB)
 *     RI 143  = Marcus Mariota (QB)   ->  our sleeper:143  = John Carlson (TE)
 *
 * 16 of 25 sampled ids "resolved" — every one to a different human. A high match
 * rate on the wrong key looks exactly like a working join, which is why the live
 * provider is hard-disabled until this crosswalk exists and passes its floor.
 *
 * ⚠ MATCHING IS BY NAME AND POSITION, NEVER BY ID. That is the entire point. Ids
 * are what lied; names and positions are what can be checked.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const RI_URL = 'https://rest.datafeeds.rolling-insights.com/api/v1/player-info/NFL'

/**
 * Minimum share of ACTIVE RI players that must map before this is usable.
 *
 * ⚠ FAIL LOUD BELOW THE FLOOR. A partial crosswalk is worse than none: the mapped
 * players score correctly and the unmapped ones score zero, which reads as "that
 * guy had a quiet game" rather than "we lost him". Same discipline as the nflverse
 * ingest.
 */
const MIN_COVERAGE = 0.85

/** nflverse/RI positions are finer-grained than ours. Shared vocabulary. */
const POS_GROUP: Record<string, string> = {
  SAF: 'DB', S: 'DB', FS: 'DB', SS: 'DB', CB: 'DB', DB: 'DB',
  DT: 'DL', DE: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL',
  ILB: 'LB', OLB: 'LB', MLB: 'LB', LB: 'LB',
  OT: 'OL', OG: 'OL', C: 'OL', G: 'OL', T: 'OL', OL: 'OL',
  HB: 'RB', FB: 'RB', RB: 'RB', WR: 'WR', TE: 'TE', QB: 'QB', K: 'K', P: 'P', LS: 'LS',
}
const group = (p: string) => POS_GROUP[(p || '').toUpperCase().trim()] ?? (p || '').toUpperCase().trim()

function normName(n: string): string {
  return (n || '')
    .toLowerCase()
    .replace(/[.,'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * RI gives full team names ("Arizona Cardinals"); our Player table holds
 * abbreviations ("ARI"). The last word is the mascot, unique across the league
 * except for the New York and Los Angeles pairs, which the map handles.
 *
 * WARNING: RAMS ARE 'LAR' HERE, NOT 'LA'. I first wrote 'LA' (nflverse's spelling)
 * and our table uses LAR exclusively — so no Rams player could ever team-verify.
 * It did not show as a failure because those players fell through to the
 * duplicate-collapse path and mapped anyway, just unverified. A wrong constant
 * that degrades silently is exactly the class of bug this file was written to
 * fix.
 *
 * WARNING: TEAM IS THE DISAMBIGUATOR THAT ACTUALLY EXISTS HERE. Birth year was the
 * obvious choice and is USELESS: birthYear and birthDate are null for all 13,931
 * of our NFL players. Measured before relying on it, which is why this pivoted
 * rather than shipping a disambiguator that silently never fires.
 */
const TEAM_BY_MASCOT: Record<string, string> = {
  cardinals: 'ARI', falcons: 'ATL', ravens: 'BAL', bills: 'BUF', panthers: 'CAR',
  bears: 'CHI', bengals: 'CIN', browns: 'CLE', cowboys: 'DAL', broncos: 'DEN',
  lions: 'DET', packers: 'GB', texans: 'HOU', colts: 'IND', jaguars: 'JAX',
  chiefs: 'KC', raiders: 'LV', chargers: 'LAC', rams: 'LAR', dolphins: 'MIA',
  vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG', jets: 'NYJ',
  eagles: 'PHI', steelers: 'PIT', seahawks: 'SEA', niners: 'SF',
  buccaneers: 'TB', titans: 'TEN', commanders: 'WAS', redskins: 'WAS', football: 'WAS',
}
function teamAbbrev(fullName: unknown): string | null {
  if (typeof fullName !== 'string' || !fullName.trim()) return null
  const last = fullName.trim().toLowerCase().split(/\s+/).pop() ?? ''
  if (last === '49ers') return 'SF'
  return TEAM_BY_MASCOT[last] ?? null
}

/** RI's `age` field is actually a birth DATE string, e.g. "March 15, 1994". */
function birthYearOf(age: unknown): number | null {
  if (typeof age !== 'string') return null
  const m = age.match(/\b(19|20)\d{2}\b/)
  return m ? Number(m[0]) : null
}

type RiPlayer = {
  player_id: number | string
  player: string
  position: string
  team?: string
  status?: string
  age?: string
}

async function main() {
  const token = process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim()
  if (!token) throw new Error('ROLLING_INSIGHTS_RSC_TOKEN is not set (CLIENT_SECRET2 is the other-sports token)')

  const res = await fetch(`${RI_URL}?RSC_token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`player-info HTTP ${res.status}`)
  const payload = (await res.json()) as { data?: { NFL?: RiPlayer[] } }
  const riPlayers = payload.data?.NFL ?? []
  console.log(`RI players: ${riPlayers.length}`)

  const ours = await prisma.player.findMany({
    where: { sport: 'NFL' },
    select: { id: true, name: true, position: true, birthYear: true, birthDate: true, team: true },
  })
  console.log(`our NFL players: ${ours.length}`)

  /*
   * Index by name+position. Values are ARRAYS, not single ids — a name+position
   * pair is not unique (two Josh Allens, one QB one LB, would collide on name
   * alone; same-position namesakes exist too). Collisions are resolved by birth
   * year, and anything still ambiguous is LEFT UNMAPPED rather than guessed.
   */
  const byKey = new Map<string, typeof ours>()
  for (const p of ours) {
    const k = `${normName(p.name)}|${group(p.position)}`
    const arr = byKey.get(k) ?? []
    arr.push(p)
    byKey.set(k, arr)
  }

  let matched = 0
  let ambiguous = 0
  let unmatched = 0
  let birthVerified = 0
  let teamVerified = 0
  let duplicateResolved = 0
  const rows: Array<{ ourId: string; riId: string; name: string; confidence: number; verified: boolean }> = []
  const unmatchedSample: string[] = []
  const ambiguousSample: string[] = []

  // Only ACTIVE players matter for live scoring; inactive/retired inflate the
  // denominator and hide a real coverage problem.
  const active = riPlayers.filter((r) => (r.status ?? '').toUpperCase() !== 'INACT')
  console.log(`active RI players: ${active.length}\n`)

  for (const r of active) {
    const key = `${normName(r.player)}|${group(r.position)}`
    const candidates = byKey.get(key) ?? []

    if (candidates.length === 0) {
      unmatched++
      if (unmatchedSample.length < 6) unmatchedSample.push(`${r.player} (${r.position})`)
      continue
    }

    let chosen = candidates[0]
    let verified = false

    if (candidates.length > 1) {
      /*
       * Disambiguation ladder, strongest signal first:
       *   1. exact team match - an active RI player has a team, and so does the
       *      correct one of our duplicate rows
       *   2. birth year - kept because it is the RIGHT signal and costs nothing
       *      once the column is populated; it simply never fires today
       *   3. the single candidate that HAS a team, when the rest are orphaned
       *      duplicate rows with team = null
       * Anything still ambiguous is LEFT UNMAPPED. A wrong map here is the exact
       * bug this file exists to prevent.
       */
      const riTeam = teamAbbrev(r.team)
      let narrowed = riTeam ? candidates.filter((c) => (c.team ?? '').toUpperCase() === riTeam) : []
      if (narrowed.length === 1) {
        chosen = narrowed[0]
        verified = true
        teamVerified++
      } else {
        const ry = birthYearOf(r.age)
        narrowed = ry
          ? candidates.filter((c) => c.birthYear === ry || c.birthDate?.getUTCFullYear() === ry)
          : []
        if (narrowed.length === 1) {
          chosen = narrowed[0]
          verified = true
          birthVerified++
        } else {
          /*
           * DUPLICATE ROWS ARE NOT NAMESAKES. Measured on our own table: 794
           * name+position pairs carry more than one row, and "Kyle Williams (WR)"
           * appears TWICE with the same team NE. Those are duplicates of one human
           * from repeated imports, not two people — so choosing between them is
           * not a guess, it is a no-op.
           *
           * The genuine-collision case is candidates on DIFFERENT teams. Only that
           * stays unmapped.
           */
          const teams = new Set(
            candidates.map((c) => (c.team ?? '').toUpperCase().trim()).filter((t) => t !== '')
          )
          if (teams.size <= 1) {
            // Prefer a row that actually carries the team, then lowest id, so the
            // choice is deterministic across runs rather than insertion-ordered.
            const withTeam = candidates.filter((c) => (c.team ?? '').trim() !== '')
            const pool = withTeam.length > 0 ? withTeam : candidates
            chosen = [...pool].sort((a, b) => a.id.localeCompare(b.id))[0]
            verified = false
            duplicateResolved++
          } else {
            ambiguous++
            if (ambiguousSample.length < 6) {
              ambiguousSample.push(`${r.player} (${r.position}) on ${[...teams].join('/')}`)
            }
            continue
          }
        }
      }
    } else {
      // Single candidate — corroborate with birth year when both sides have one.
      const riTeam = teamAbbrev(r.team)
      const ourTeam = (chosen.team ?? '').toUpperCase() || null
      if (riTeam && ourTeam && riTeam === ourTeam) {
        verified = true
        teamVerified++
      }
      const ry = birthYearOf(r.age)
      const oy = chosen.birthYear ?? chosen.birthDate?.getUTCFullYear() ?? null
      if (ry && oy) {
        if (ry !== oy) {
          // Same name and position, different birth year: not the same human.
          unmatched++
          if (unmatchedSample.length < 6) unmatchedSample.push(`${r.player} (birth ${ry} vs ${oy})`)
          continue
        }
        verified = true
        birthVerified++
      }
    }

    matched++
    rows.push({
      ourId: chosen.id,
      riId: String(r.player_id),
      name: r.player,
      confidence: verified ? 1 : 0.8,
      verified,
    })
  }

  const coverage = matched / Math.max(active.length, 1)
  console.log(`matched:        ${matched}`)
  console.log(`  team-verified:  ${teamVerified}`)
  console.log(`  duplicate rows collapsed: ${duplicateResolved}`)
  console.log(`  birth-verified: ${birthVerified}  (birthYear is null for ALL our players today)`)
  console.log(`ambiguous (skipped): ${ambiguous}`)
  console.log(`unmatched:      ${unmatched}`)
  console.log(`coverage:       ${(coverage * 100).toFixed(1)}%  (floor ${MIN_COVERAGE * 100}%)`)
  if (unmatchedSample.length) console.log(`\nunmatched sample: ${unmatchedSample.join(', ')}`)
  if (ambiguousSample.length) console.log(`ambiguous sample: ${ambiguousSample.join(', ')}`)

  /*
   * ⚠ THE PROOF THAT THIS FIXES THE ORIGINAL BUG. Re-check the three ids that
   * exposed it: they must now map to the RIGHT humans, not to whoever happened to
   * hold that number in Sleeper's space.
   */
  console.log('\nregression check — the ids that exposed the collision:')
  for (const [riId, expect] of [['8735', 'Ollie Gordon'], ['143', 'Marcus Mariota'], ['3185', 'Nick Mullens']]) {
    const row = rows.find((x) => x.riId === riId)
    if (!row) { console.log(`   RI ${riId}: not mapped (expected ${expect})`); continue }
    const our = ours.find((o) => o.id === row.ourId)
    const ok = normName(our?.name ?? '').includes(normName(expect).split(' ')[1] ?? '')
    console.log(`   RI ${riId} -> ${our?.name} ${ok ? '✓' : '✗ MISMATCH'}`)
  }

  if (coverage < MIN_COVERAGE) {
    console.error(`\n⚠ COVERAGE ${(coverage * 100).toFixed(1)}% IS BELOW THE ${MIN_COVERAGE * 100}% FLOOR — refusing to write.`)
    console.error('A partial crosswalk scores mapped players correctly and unmapped ones at ZERO,')
    console.error('which reads as "quiet game" rather than "we lost him".')
    process.exit(1)
  }

  if (!WRITE) {
    console.log('\n(dry run — pass --write to persist)')
    process.exit(0)
  }

  let written = 0
  for (const r of rows) {
    await prisma.playerProviderIdentity.upsert({
      where: {
        uniq_player_provider_identity: {
          provider: 'rolling_insights',
          sportKey: 'NFL',
          leagueKey: 'NFL',
          providerPlayerId: r.riId,
        },
      },
      update: { playerId: r.ourId, displayName: r.name, confidence: r.confidence, verified: r.verified, lastSeenAt: new Date() },
      create: {
        playerId: r.ourId,
        sportKey: 'NFL',
        leagueKey: 'NFL',
        provider: 'rolling_insights',
        providerPlayerId: r.riId,
        displayName: r.name,
        confidence: r.confidence,
        verified: r.verified,
        source: 'ri_player_info',
        fetchedAt: new Date(),
        lastSeenAt: new Date(),
      },
    })
    written++
  }
  console.log(`\nwrote ${written} crosswalk rows`)
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
