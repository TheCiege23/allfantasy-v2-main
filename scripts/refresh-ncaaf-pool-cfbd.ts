/**
 * Refresh the NCAAF player pool (sportsPlayer) with current FBS skill players
 * from CFBD, mapped to the existing rolling_insights team identities.
 *
 * The NCAAF pool is rolling_insights-sourced (~61k rows) and bloated with FCS,
 * all positions, and stale players, with no team logos. This script:
 *   1. Loads CFBD FBS teams (136, with ESPN logos) + current FBS rosters.
 *   2. Matches each CFBD school to the existing RI sportsTeam (by normalized
 *      name / abbreviation) so we reuse teamId + team string (no dup teams).
 *   3. Upserts current FBS skill players as source='cfbd' aligned to those
 *      teams — the resolver dedups by name|pos|team and prefers cfbd (rank 7)
 *      so fresh rows win over stale RI duplicates.
 *   4. Backfills team logos onto matched RI sportsTeam rows (currently null).
 *   5. (--prune-non-fbs) deletes NCAAF pool rows whose team is not an FBS team.
 *
 * Safe + idempotent. Dry-run by default.
 *   npx tsx scripts/refresh-ncaaf-pool-cfbd.ts                 # dry run
 *   npx tsx scripts/refresh-ncaaf-pool-cfbd.ts --apply         # upsert players + logos
 *   npx tsx scripts/refresh-ncaaf-pool-cfbd.ts --apply --prune-non-fbs
 */

import fs from 'node:fs'

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) {
        let v = m[2].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        process.env[m[1]] = v
      }
    }
  } catch {}
}

const APPLY = process.argv.includes('--apply')
const PRUNE = process.argv.includes('--prune-non-fbs')
// Replace the skill pool: delete non-cfbd skill-position rows so transferred /
// graduated players don't linger at their old school. CFBD becomes the single
// source of truth for current QB/RB/WR/TE/K; non-skill RI rows are untouched.
const REPLACE_SKILL = process.argv.includes('--replace-skill')
const RI_SKILL_POSITIONS = ['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'PK', 'ATH']
const yearArg = process.argv[process.argv.indexOf('--year') + 1]
const SEASON = /^\d{4}$/.test(yearArg ?? '') ? (yearArg as string) : '2025'
const CFBD_BASE = 'https://api.collegefootballdata.com'
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'PK', 'ATH'])
const POSITION_MAP: Record<string, string> = { FB: 'RB', PK: 'K' }

function cfbdKey(): string {
  const raw = process.env.CFBD_API_KEY || process.env.CFBD_KEY || process.env.COLLEGE_FOOTBALL_DATA_API_KEY || ''
  let v = raw.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1).trim()
  return v
}

async function cfbd<T>(path: string): Promise<T> {
  const res = await fetch(`${CFBD_BASE}${path}`, { headers: { Authorization: `Bearer ${cfbdKey()}`, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`CFBD ${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Normalize a team name for matching across providers. */
function normTeam(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(/\b(university|the|of|at|college)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type FbsTeam = { school: string; abbreviation: string | null; alternateNames: string[]; logo: string | null }
type RiTeam = { externalId: string; name: string; shortName: string | null }

/** Manual aliases for CFBD schools whose name doesn't normalize to the RI name. */
const SCHOOL_ALIASES: Record<string, string> = {
  'NC State': 'North Carolina State',
}

/**
 * Direct RI-externalId overrides for ambiguous names that normalize identically
 * (the only collision in NCAAF is Miami FL [19] vs Miami OH [112]).
 */
const SCHOOL_TO_RI_EXTERNAL_ID: Record<string, string> = {
  Miami: '19', // Miami (FL) — University of Miami
  'Miami (OH)': '112', // Miami (OH) — Miami University
}

function matchSchoolToRi(
  team: FbsTeam,
  riByNorm: Map<string, RiTeam>,
  riByShort: Map<string, RiTeam>,
  riByExtId: Map<string, RiTeam>,
): RiTeam | null {
  const override = SCHOOL_TO_RI_EXTERNAL_ID[team.school]
  if (override && riByExtId.has(override)) return riByExtId.get(override)!
  const alias = SCHOOL_ALIASES[team.school]
  const candidates = [team.school, ...(alias ? [alias] : []), ...(team.alternateNames ?? [])]
  for (const c of candidates) {
    const hit = riByNorm.get(normTeam(c))
    if (hit) return hit
  }
  // Abbreviation ↔ shortName
  if (team.abbreviation) {
    const hit = riByShort.get(team.abbreviation.toUpperCase())
    if (hit) return hit
  }
  // Containment fallback (one normalized name contains the other)
  const target = normTeam(team.school)
  for (const [norm, ri] of riByNorm) {
    if (norm && (norm.includes(target) || target.includes(norm))) return ri
  }
  return null
}

async function main() {
  if (!cfbdKey()) {
    console.error('No CFBD key.')
    process.exit(1)
  }

  console.log(`[refresh] fetching CFBD FBS teams + rosters for ${SEASON}…`)
  const [teamsRaw, rosterRaw] = await Promise.all([
    cfbd<Array<Record<string, unknown>>>(`/teams/fbs?year=${SEASON}`),
    cfbd<Array<Record<string, unknown>>>(`/roster?year=${SEASON}&classification=fbs`),
  ])

  const fbsTeams: FbsTeam[] = teamsRaw.map((t) => ({
    school: String(t.school ?? '').trim(),
    abbreviation: t.abbreviation ? String(t.abbreviation) : null,
    alternateNames: Array.isArray(t.alternateNames) ? (t.alternateNames as unknown[]).map(String) : [],
    logo: Array.isArray(t.logos) && t.logos.length > 0 ? String((t.logos as unknown[])[0]).replace(/^http:/, 'https:') : null,
  }))
  const fbsSchoolNorm = new Set(fbsTeams.map((t) => normTeam(t.school)))

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  const riTeams = (await prisma.sportsTeam.findMany({
    where: { sport: 'NCAAF' },
    select: { externalId: true, name: true, shortName: true, logo: true },
  })) as Array<RiTeam & { logo: string | null }>
  const riByNorm = new Map<string, RiTeam>()
  const riByShort = new Map<string, RiTeam>()
  const riByExtId = new Map<string, RiTeam>()
  for (const r of riTeams) {
    riByNorm.set(normTeam(r.name), r)
    if (r.shortName) riByShort.set(r.shortName.toUpperCase(), r)
    riByExtId.set(r.externalId, r)
  }

  // Match schools → RI identity + build logo updates.
  const schoolToRi = new Map<string, RiTeam>()
  const unmatchedSchools: string[] = []
  const logoUpdates: Array<{ externalId: string; logo: string }> = []
  const riLogoByExt = new Map(riTeams.map((r) => [r.externalId, r.logo]))
  for (const team of fbsTeams) {
    const ri = matchSchoolToRi(team, riByNorm, riByShort, riByExtId)
    if (ri) {
      schoolToRi.set(team.school, ri)
      if (team.logo && !riLogoByExt.get(ri.externalId)) logoUpdates.push({ externalId: ri.externalId, logo: team.logo })
    } else {
      unmatchedSchools.push(team.school)
    }
  }

  // Build current FBS skill player seeds aligned to RI team identity.
  type Seed = { externalId: string; name: string; team: string; teamId: string | null; position: string; college: string }
  const seedById = new Map<string, Seed>()
  for (const p of rosterRaw) {
    const name = `${String(p.firstName ?? '').trim()} ${String(p.lastName ?? '').trim()}`.trim()
    const pos = String(p.position ?? '').trim().toUpperCase()
    const school = String(p.team ?? '').trim()
    const extId = String(p.id ?? '').trim()
    if (!name || !school || !extId || !FANTASY_POSITIONS.has(pos)) continue
    const ri = schoolToRi.get(school)
    seedById.set(extId, {
      externalId: extId,
      name: name.slice(0, 128),
      team: (ri?.name ?? school).slice(0, 64),
      teamId: ri?.externalId ?? null,
      position: POSITION_MAP[pos] ?? pos,
      college: school.slice(0, 64),
    })
  }
  const seeds = [...seedById.values()]
  const withTeamId = seeds.filter((s) => s.teamId).length

  // Prune candidates: NCAAF pool rows whose team is not an FBS team.
  const nonFbsCount = await prisma.sportsPlayer.count({
    where: { sport: 'NCAAF', NOT: { team: { in: [...schoolToRi.values()].map((r) => r.name) } } },
  })
  // Replace-skill candidates: stale non-cfbd skill-position rows (fixes transfers).
  const staleSkillCount = await prisma.sportsPlayer.count({
    where: { sport: 'NCAAF', source: { not: 'cfbd' }, position: { in: RI_SKILL_POSITIONS } },
  })

  console.log('──────── DRY-RUN REPORT ────────')
  console.log(`CFBD FBS teams: ${fbsTeams.length} | matched to RI: ${schoolToRi.size} | unmatched: ${unmatchedSchools.length}`)
  if (unmatchedSchools.length) console.log(`  unmatched schools: ${unmatchedSchools.join(', ')}`)
  console.log(`Roster rows: ${rosterRaw.length} → current FBS skill seeds: ${seeds.length} (${withTeamId} mapped to an RI teamId)`)
  console.log(`Team logos to backfill (RI teams currently without a logo): ${logoUpdates.length}`)
  console.log(`Players to upsert (source='cfbd'): ${seeds.length}`)
  console.log(`--prune-non-fbs would DELETE NCAAF pool rows not on an FBS team: ${nonFbsCount}`)
  console.log(`--replace-skill would DELETE stale non-cfbd skill rows (fixes transfers): ${staleSkillCount}`)
  console.log('────────────────────────────────')

  if (!APPLY) {
    console.log('DRY RUN — no writes. Re-run with --apply (optionally --prune-non-fbs).')
    await prisma.$disconnect()
    process.exit(0)
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const beforePool = await prisma.sportsPlayer.count({ where: { sport: 'NCAAF' } })

  // 1. Backfill team logos.
  for (const u of logoUpdates) {
    await prisma.sportsTeam.updateMany({ where: { sport: 'NCAAF', externalId: u.externalId, logo: null }, data: { logo: u.logo } })
  }
  console.log(`[apply] backfilled ${logoUpdates.length} team logos`)

  // 2. Upsert players.
  let written = 0
  const BATCH = 100
  for (let i = 0; i < seeds.length; i += BATCH) {
    const batch = seeds.slice(i, i + BATCH)
    await prisma.$transaction(
      batch.map((s) =>
        prisma.sportsPlayer.upsert({
          where: { sport_externalId_source: { sport: 'NCAAF', externalId: s.externalId, source: 'cfbd' } },
          update: { name: s.name, position: s.position, team: s.team, teamId: s.teamId, college: s.college, status: 'active', expiresAt },
          create: {
            sport: 'NCAAF',
            externalId: s.externalId,
            source: 'cfbd',
            name: s.name,
            position: s.position,
            team: s.team,
            teamId: s.teamId,
            college: s.college,
            status: 'active',
            expiresAt,
          },
        }),
      ),
    )
    written += batch.length
    if (written % 1000 === 0 || written === seeds.length) console.log(`[apply] upserted ${written}/${seeds.length} players`)
  }

  // 3. Optional prunes.
  if (REPLACE_SKILL) {
    const del = await prisma.sportsPlayer.deleteMany({
      where: { sport: 'NCAAF', source: { not: 'cfbd' }, position: { in: RI_SKILL_POSITIONS } },
    })
    console.log(`[apply] replaced skill pool — deleted ${del.count} stale non-cfbd skill rows`)
  } else if (PRUNE) {
    const del = await prisma.sportsPlayer.deleteMany({
      where: { sport: 'NCAAF', source: { not: 'cfbd' }, NOT: { team: { in: [...schoolToRi.values()].map((r) => r.name) } } },
    })
    console.log(`[apply] pruned ${del.count} non-FBS NCAAF pool rows`)
  }

  const afterPool = await prisma.sportsPlayer.count({ where: { sport: 'NCAAF' } })
  const cfbdRows = await prisma.sportsPlayer.count({ where: { sport: 'NCAAF', source: 'cfbd' } })
  console.log(`[apply] NCAAF pool: ${beforePool} → ${afterPool} (cfbd rows: ${cfbdRows})`)
  await prisma.$disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('[refresh] FATAL', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
