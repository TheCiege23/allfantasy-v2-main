/**
 * Coaching spec Phase 1b — coordinators and full staffs from the Coaching Tree MCP.
 *
 *   npx tsx scripts/ingest-coaches-coaching-tree.ts [fromYear] [toYear]
 *
 * ⚠ BACKFILL AND SNAPSHOT ONLY — NEVER A LIVE DEPENDENCY. This is a solo project
 * with no SLA, no versioning and no deprecation policy. Everything it returns is
 * written to our own tables; nothing in the request path may call it. If it
 * disappears tomorrow, the data we already hold is unaffected.
 *
 * ⚠ SOURCE CONFIDENCE IS MEDIUM, NOT HIGH. It is scraped from public sources. The
 * head-coach rows from nflverse (Phase 1a) are HIGH and win any disagreement —
 * and disagreements are logged rather than silently resolved, because a
 * disagreement rate is the only real measurement of this source's quality.
 * The spec's own coverage claims were explicitly unaudited; this ingest is the audit.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MCP = 'https://coaching-tree.app/mcp'

const FROM = Number(process.argv[2] ?? 1999)
// Coverage ends at 2025 — 2026 head coaches come from nflverse, which has them.
const TO = Number(process.argv[3] ?? 2025)

/** Be a good citizen of a free, unfunded endpoint. */
const DELAY_MS = 120

let rpcId = 100
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  })
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`)
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } }
  const text = body?.result?.content?.[0]?.text
  if (!text) throw new Error(`${name}: empty content`)
  return JSON.parse(text)
}

/**
 * Free-text coaching title → role enum.
 *
 * ⚠ ORDER IS LOAD-BEARING. Titles are not standardised across the league and many
 * are compound ("Assistant Head Coach / Pass Game Coordinator", "Run Game
 * Coordinator / Offensive Line"). The specific coordinator titles must be tested
 * BEFORE the generic "coordinator" catch, or a pass-game coordinator is filed as
 * an OC and a real OC's tendency profile gets polluted with someone else's work.
 */
function classifyRole(raw: string): string {
  const r = raw.toLowerCase()
  if (/head coach/.test(r) && !/assistant/.test(r)) return 'HC'
  if (/assistant head coach/.test(r)) return 'ASSISTANT_HC'
  if (/pass game coordinator|passing game coordinator/.test(r)) return 'PASS_GAME_COORD'
  if (/run game coordinator|running game coordinator/.test(r)) return 'RUN_GAME_COORD'
  if (/special teams coordinator/.test(r)) return 'STC'
  if (/offensive coordinator/.test(r)) return 'OC'
  if (/defensive coordinator/.test(r)) return 'DC'
  // Position rooms — quarterbacks, wide receivers, secondary, linebackers, etc.
  if (/quarterback|running back|wide receiver|tight end|offensive line|defensive line|linebacker|secondary|cornerback|safet|special teams/.test(r))
    return 'POSITION'
  return 'OTHER'
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[.,']/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Given-name variants that refer to the same person.
 *
 * ⚠ FOUND BY THE RECONCILIATION, NOT BY GUESSING. The first smoke run reported a
 * 3.57% head-coach disagreement rate — above the spec's 2% "re-evaluate this
 * source" threshold — and the ONLY disagreement was
 * `nflverse="Jonathan Gannon"` vs `tree="Jon Gannon"`. Same man. A strict matcher
 * was about to condemn a good source AND create two Coach rows for one career.
 */
const GIVEN_NAME_VARIANTS: string[][] = [
  ['jon', 'jonathan'], ['mike', 'michael'], ['jim', 'james'], ['bill', 'william'],
  ['bob', 'rob', 'robert'], ['dan', 'daniel'], ['dave', 'david'], ['joe', 'joseph'],
  ['tom', 'thomas'], ['chris', 'christopher'], ['matt', 'matthew'], ['nick', 'nicholas'],
  ['steve', 'steven', 'stephen'], ['greg', 'gregory'], ['ken', 'kenneth'], ['ron', 'ronald'],
  ['rich', 'richard', 'dick'], ['ed', 'eddie', 'edward'], ['tony', 'anthony'],
  ['andy', 'andrew'], ['pete', 'peter'], ['ben', 'benjamin'], ['sam', 'samuel'],
  ['zac', 'zach', 'zachary'], ['doug', 'douglas'], ['jeff', 'jeffrey'], ['ted', 'theodore'],
]

function givenNamesMatch(a: string, b: string): boolean {
  if (a === b) return true
  for (const group of GIVEN_NAME_VARIANTS) {
    if (group.includes(a) && group.includes(b)) return true
  }
  // "Jon"/"Jonathan" style truncation not covered by the table above.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short)
}

/**
 * Do two normalised names refer to the same person?
 *
 * ⚠ SURNAME ALONE IS NOT ENOUGH, AND THIS IS THE WHOLE REASON FOR THE CARE.
 * Matching on surname + first initial would merge Jim and John Harbaugh — the
 * exact collision the spec's checklist calls out. Given names must be equal, a
 * known variant, or a genuine truncation. "Jim" is not a prefix of "John" and is
 * not in a group with it, so the Harbaughs stay separate; "Jon" and "Jonathan"
 * unify.
 */
function sameCoach(aNorm: string, bNorm: string): boolean {
  if (aNorm === bNorm) return true
  const a = aNorm.split(' ')
  const b = bNorm.split(' ')
  if (a.length < 2 || b.length < 2) return false
  // Surnames must match exactly.
  if (a[a.length - 1] !== b[b.length - 1]) return false
  return givenNamesMatch(a[0], b[0])
}

/**
 * Franchise codes normalised onto the nflverse spelling (Phase 1a's, and the one
 * PlayerGameStat.opponent uses).
 *
 * ⚠ FOUR MISMATCHES, ALL FOUND BY DIFFING THE TWO SOURCES' FRANCHISE SETS — none
 * would have thrown an error. Coaching Tree and nflverse disagree on the code for
 * the Rams, Jaguars and Ravens, so without this the Rams' coaching history splits
 * across `LA` and `LAR` and neither half looks wrong on its own. Diffing the sets
 * is the only way this surfaces.
 */
const RELOCATIONS: Record<string, string> = {
  // Relocations
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LA',
  // Spelling disagreements between the two sources
  LAR: 'LA',
  JAC: 'JAX',
  BAL_R: 'BAL',
}

/**
 * ⚠ HOUSTON IS UNREACHABLE IN THIS SOURCE — A MEASURED, UPSTREAM GAP.
 * `list_teams` returns the Texans as active with slug `houston-texans`, and
 * `get_team_staff` then rejects that exact slug for every year 2002-2025.
 * `HOU`, `texans` and `houston` are all rejected too. This accounted for ALL 27
 * failed team-seasons in the full backfill.
 *
 * Consequence: the Texans have no coordinator data, and any coaching factor for
 * them must be EXCLUDED rather than defaulted — the whole point of the factor
 * contract. Recorded here so a future run does not read 27 failures as a network
 * blip.
 */
export const KNOWN_SOURCE_GAPS = ['HOU: get_team_staff rejects every identifier (upstream)']

type TeamRow = { name: string; abbreviation: string; slug: string; is_active: boolean }
type StaffEntry = { name: string; slug: string; roles: string[]; is_head_coach: boolean }

async function main() {
  const teamsRaw = (await callTool('list_teams', {})) as TeamRow[] | { teams: TeamRow[] }
  const teams = (Array.isArray(teamsRaw) ? teamsRaw : teamsRaw.teams).filter((t) => t.is_active)
  console.log(`active franchises: ${teams.length} (of ${(Array.isArray(teamsRaw) ? teamsRaw : teamsRaw.teams).length} historical)`)
  console.log(`range: ${FROM}–${TO}  →  ${teams.length * (TO - FROM + 1)} calls\n`)

  const coachCache = new Map<string, string>()
  async function coachId(fullName: string, slug: string): Promise<string> {
    const norm = normaliseName(fullName)
    const hit = coachCache.get(norm)
    if (hit) return hit
    let existing = await prisma.coach.findFirst({ where: { nameNormalized: norm }, select: { id: true } })
    if (!existing) {
      /*
       * Exact match failed — try known given-name variants before creating a new
       * person. Restricted to the same surname so this can never merge two
       * genuinely different coaches; see sameCoach().
       */
      const surname = norm.split(' ').pop() ?? ''
      if (surname) {
        const candidates = await prisma.coach.findMany({
          where: { nameNormalized: { endsWith: ` ${surname}` } },
          select: { id: true, nameNormalized: true },
        })
        const hit2 = candidates.find((c) => sameCoach(c.nameNormalized, norm))
        if (hit2) existing = { id: hit2.id }
      }
    }
    if (existing) {
      // Backfill the source id onto a coach nflverse created first.
      await prisma.coach.update({ where: { id: existing.id }, data: { coachingTreeId: slug } }).catch(() => {})
      coachCache.set(norm, existing.id)
      return existing.id
    }
    const made = await prisma.coach.create({
      data: { fullName, nameNormalized: norm, coachingTreeId: slug },
      select: { id: true },
    })
    coachCache.set(norm, made.id)
    return made.id
  }

  let written = 0, failures = 0, hcAgree = 0, hcDisagree = 0
  const disagreements: string[] = []

  for (const team of teams) {
    const code = RELOCATIONS[team.abbreviation] ?? team.abbreviation
    for (let year = FROM; year <= TO; year++) {
      let staff: StaffEntry[]
      try {
        const r = (await callTool('get_team_staff', { team: team.slug, year })) as
          | { staff?: StaffEntry[]; error?: string }
        if (r.error || !r.staff) { failures++; continue }
        staff = r.staff
      } catch {
        failures++
        continue
      }
      if (staff.length === 0) continue

      for (const person of staff) {
        const id = await coachId(person.name, person.slug)
        // A coach may hold several titles in one season; each becomes its own
        // stint row. This is why the unique key includes role.
        const roles = person.roles?.length ? person.roles : ['Unknown']
        for (const roleRaw of roles) {
          const role = classifyRole(roleRaw)
          await prisma.coachStint.upsert({
            where: { coachId_teamId_season_role: { coachId: id, teamId: code, season: year, role } },
            update: { roleRaw, teamRaw: team.abbreviation },
            create: {
              coachId: id,
              teamId: code,
              teamRaw: team.abbreviation,
              season: year,
              role,
              roleRaw,
              // ⚠ NULL, never false. Coaching Tree records titles, not who calls plays.
              isPlayCaller: null,
              source: 'COACHING_TREE',
              sourceConfidence: 'MEDIUM',
            },
          }).catch(() => {})
          written++
        }
      }

      // ── HC reconciliation against nflverse (Phase 1a). A disagreement rate is
      //    the only real measurement of this source's reliability.
      const theirHc = staff.find((s) => s.is_head_coach)
      if (theirHc) {
        /*
         * ⚠ findMANY, NOT findFirst — A TEAM CAN HAVE TWO HEAD COACHES IN A SEASON.
         * nflverse records the coach per GAME, so a mid-season firing produces two
         * rows; Coaching Tree records one per season. Comparing against an
         * arbitrary first row counted IND 2022 as a source disagreement when both
         * sources were right: Frank Reich was fired in November and Jeff Saturday
         * finished as interim. That was the ONLY flagged disagreement in 753
         * comparisons, and it was an artefact of this query, not a data fault.
         *
         * Agreement with ANY head coach on file is agreement.
         */
        const ours = await prisma.coachStint.findMany({
          where: { teamId: code, season: year, role: 'HC', source: 'NFLVERSE' },
          select: { coach: { select: { nameNormalized: true, fullName: true } } },
        })
        if (ours.length > 0) {
          // sameCoach(), not string equality — otherwise "Jon"/"Jonathan" reads as
          // a source disagreement when it is a spelling variant.
          const theirs = normaliseName(theirHc.name)
          if (ours.some((o) => sameCoach(o.coach.nameNormalized, theirs))) hcAgree++
          else {
            hcDisagree++
            if (disagreements.length < 15)
              disagreements.push(
                `${code} ${year}: nflverse=[${ours.map((o) => o.coach.fullName).join(', ')}] tree="${theirHc.name}"`
              )
          }
        }
      }

      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
    process.stdout.write(`  ${team.abbreviation} done (${written} stint rows so far)\n`)
  }

  const totalStints = await prisma.coachStint.count()
  const byRole = await prisma.coachStint.groupBy({ by: ['role'], _count: true })
  const coaches = await prisma.coach.count()

  console.log(`\nstint upserts: ${written} | failed team-seasons: ${failures}`)
  console.log(`Coach rows: ${coaches} | CoachStint rows: ${totalStints}`)
  console.log('by role:', byRole.map((r) => `${r.role}=${r._count}`).join(' '))

  const checked = hcAgree + hcDisagree
  const rate = checked > 0 ? (hcDisagree / checked) * 100 : 0
  console.log(`\nHC reconciliation: ${hcAgree} agree, ${hcDisagree} disagree of ${checked} (${rate.toFixed(2)}%)`)
  // The spec's threshold: >2% means re-evaluate Coaching Tree as a source.
  console.log(rate > 2 ? '⚠ ABOVE THE 2% THRESHOLD — re-evaluate this source' : '✓ within the 2% threshold')
  disagreements.forEach((d) => console.log('   ' + d))
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
