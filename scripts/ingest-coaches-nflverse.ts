/**
 * Coaching spec Phase 1a — head-coach identity and stints from nflverse games.csv.
 *
 * Free, community-maintained, PFR-sourced, and the highest-reliability coaching
 * data available. HEAD COACHES ONLY — coordinators are Phase 1b (Coaching Tree).
 *
 *   npx tsx scripts/ingest-coaches-nflverse.ts
 *
 * Idempotent: re-running upserts the same coaches and stints.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const GAMES_CSV = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'

/**
 * Franchise relocations, normalised so a coach's tenure is not split across two
 * codes for the same building.
 *
 * ⚠ games.csv carries 35 team codes for 32 franchises. Without this, a search for
 * Raiders history misses everything before the Las Vegas move, and the Chargers
 * and Rams each appear as two unrelated teams.
 *
 * `teamRaw` preserves the original code so the mapping stays auditable.
 */
const RELOCATIONS: Record<string, string> = {
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LA',
}

/**
 * Normalise a name for matching.
 *
 * ⚠ THIS IS A MATCH KEY, NOT AN IDENTITY. It collapses "Mike Shanahan" and
 * "Mike  Shanahan." to one key, which is the point — but it CANNOT separate a
 * father and son sharing a surname and initial. Coach identity is keyed on a
 * surrogate id for that reason; this only groups rows that are almost certainly
 * the same person within a single source.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

async function main() {
  console.log('fetching games.csv…')
  const res = await fetch(GAMES_CSV)
  if (!res.ok) throw new Error(`games.csv fetch failed: ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  const hdr = parseCsvLine(lines[0])
  const idx = (n: string) => hdr.indexOf(n)
  const iSeason = idx('season'), iHome = idx('home_team'), iAway = idx('away_team')
  const iHC = idx('home_coach'), iAC = idx('away_coach')

  if (iHC < 0 || iAC < 0) throw new Error('games.csv has no coach columns — shape drift')

  // Collect unique (coach, team, season) triples. A coach appears once per game;
  // we want one stint per season.
  const stints = new Map<string, { name: string; teamRaw: string; team: string; season: number }>()
  let rows = 0
  let missingCoach = 0

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i])
    if (c.length < 5) continue
    const season = Number(c[iSeason])
    if (!Number.isFinite(season)) continue
    rows++
    for (const [coachRaw, teamRaw] of [[c[iHC], c[iHome]], [c[iAC], c[iAway]]]) {
      const name = (coachRaw || '').trim()
      const tRaw = (teamRaw || '').trim().toUpperCase()
      if (!name || !tRaw) { missingCoach++; continue }
      const team = RELOCATIONS[tRaw] ?? tRaw
      stints.set(`${normaliseName(name)}|${team}|${season}`, { name, teamRaw: tRaw, team, season })
    }
  }

  console.log(`games parsed: ${rows} | coach slots missing: ${missingCoach}`)
  console.log(`distinct coach-team-season stints: ${stints.size}`)

  // ── Coaches
  const byName = new Map<string, string>() // normalised -> coach id
  const uniqueNames = new Map<string, string>()
  for (const s of stints.values()) uniqueNames.set(normaliseName(s.name), s.name)
  console.log(`distinct coaches: ${uniqueNames.size}`)

  for (const [norm, full] of uniqueNames) {
    const existing = await prisma.coach.findFirst({ where: { nameNormalized: norm }, select: { id: true } })
    if (existing) { byName.set(norm, existing.id); continue }
    const created = await prisma.coach.create({
      data: { fullName: full, nameNormalized: norm },
      select: { id: true },
    })
    byName.set(norm, created.id)
  }

  // ── Stints
  let written = 0
  for (const s of stints.values()) {
    const coachId = byName.get(normaliseName(s.name))
    if (!coachId) continue
    await prisma.coachStint.upsert({
      where: {
        coachId_teamId_season_role: { coachId, teamId: s.team, season: s.season, role: 'HC' },
      },
      update: { teamRaw: s.teamRaw, source: 'NFLVERSE', sourceConfidence: 'HIGH' },
      create: {
        coachId,
        teamId: s.team,
        teamRaw: s.teamRaw,
        season: s.season,
        role: 'HC',
        roleRaw: 'head_coach',
        // ⚠ Left NULL, never false — games.csv says who the head coach was, not
        // who called plays. See CoachStint.isPlayCaller.
        isPlayCaller: null,
        source: 'NFLVERSE',
        sourceConfidence: 'HIGH',
      },
    })
    written++
  }

  const coaches = await prisma.coach.count()
  const allStints = await prisma.coachStint.count()
  const seasons = await prisma.coachStint.aggregate({ _min: { season: true }, _max: { season: true } })
  console.log(`\nwritten: ${written}`)
  console.log(`Coach rows: ${coaches} | CoachStint rows: ${allStints}`)
  console.log(`season range: ${seasons._min.season}–${seasons._max.season}`)
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
