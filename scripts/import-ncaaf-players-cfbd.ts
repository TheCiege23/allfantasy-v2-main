/**
 * One-shot NCAAF player import from CFBD → SportsPlayerRecord.
 *
 * Standalone (no server-only deps) so it runs via tsx. Mirrors the exact
 * upsert shape `runSportsDataImporter` uses, and the same /roster fetch +
 * position filter as `cfbdProvider`. Idempotent: upserts by id `NCAAF:<cfbdId>`.
 *
 * Usage:
 *   npx tsx scripts/import-ncaaf-players-cfbd.ts            # dry run (no writes)
 *   npx tsx scripts/import-ncaaf-players-cfbd.ts --apply    # write to DB
 *   npx tsx scripts/import-ncaaf-players-cfbd.ts --apply --year 2025
 */

import fs from 'node:fs'

// ── env load (manual; no dotenv dependency) ──────────────────────────────
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
const yearArg = process.argv[process.argv.indexOf('--year') + 1]
const SEASON = /^\d{4}$/.test(yearArg ?? '') ? yearArg : '2025'

const CFBD_BASE = 'https://api.collegefootballdata.com'
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'PK', 'ATH'])
// Canonicalize CFBD synonyms to the fantasy positions used in configs/ncaaf.ts.
const POSITION_MAP: Record<string, string> = { FB: 'RB', PK: 'K' }

function cfbdKey(): string {
  const raw = process.env.CFBD_API_KEY || process.env.CFBD_KEY || process.env.COLLEGE_FOOTBALL_DATA_API_KEY || ''
  let v = raw.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1).trim()
  return v
}

type Seed = { id: string; name: string; team: string; position: string }

function mapRoster(rows: Array<Record<string, unknown>>): Seed[] {
  const seeds: Seed[] = []
  for (const p of rows) {
    const first = String(p.firstName ?? p.first_name ?? '').trim()
    const last = String(p.lastName ?? p.last_name ?? '').trim()
    const name = `${first} ${last}`.trim()
    const rawPos = String(p.position ?? '').trim().toUpperCase()
    if (!name || !FANTASY_POSITIONS.has(rawPos)) continue
    const team = String(p.team ?? '').trim().slice(0, 32)
    if (!team) continue
    const externalId = String(p.id ?? '').trim()
    const id = externalId ? `NCAAF:${externalId}` : `NCAAF:${name.toLowerCase().replace(/\s+/g, '-')}:${team}`
    seeds.push({ id, name: name.slice(0, 128), team, position: POSITION_MAP[rawPos] ?? rawPos })
  }
  // De-dupe by id (CFBD can list a player twice across roster snapshots).
  const byId = new Map<string, Seed>()
  for (const s of seeds) byId.set(s.id, s)
  return [...byId.values()]
}

async function main() {
  const key = cfbdKey()
  if (!key) {
    console.error('No CFBD key found (CFBD_API_KEY / CFBD_KEY).')
    process.exit(1)
  }

  const url = `${CFBD_BASE}/roster?year=${SEASON}&classification=fbs`
  console.log(`[ncaaf-import] fetching ${url}`)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
  if (!res.ok) {
    console.error(`[ncaaf-import] CFBD roster fetch failed: HTTP ${res.status}`)
    process.exit(1)
  }
  const raw = (await res.json()) as Array<Record<string, unknown>>
  const seeds = mapRoster(raw)
  const byPos = seeds.reduce<Record<string, number>>((acc, s) => ((acc[s.position] = (acc[s.position] ?? 0) + 1), acc), {})
  console.log(`[ncaaf-import] season ${SEASON}: ${raw.length} raw roster rows → ${seeds.length} unique fantasy players`)
  console.log(`[ncaaf-import] by position:`, JSON.stringify(byPos))
  console.log(`[ncaaf-import] sample:`, seeds.slice(0, 5).map((s) => `${s.position} ${s.name} (${s.team})`).join(', '))

  if (!APPLY) {
    console.log('[ncaaf-import] DRY RUN — no DB writes. Re-run with --apply to persist.')
    process.exit(0)
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const before = await prisma.sportsPlayerRecord.count({ where: { sport: 'NCAAF' } })
  console.log(`[ncaaf-import] NCAAF players before: ${before}`)

  let written = 0
  const BATCH = 100
  for (let i = 0; i < seeds.length; i += BATCH) {
    const batch = seeds.slice(i, i + BATCH)
    await prisma.$transaction(
      batch.map((s) =>
        prisma.sportsPlayerRecord.upsert({
          where: { id: s.id },
          update: { sport: 'NCAAF', name: s.name, team: s.team, position: s.position, dataSource: 'cfbd' },
          create: {
            id: s.id,
            sport: 'NCAAF',
            name: s.name,
            team: s.team,
            position: s.position,
            stats: {},
            projections: {},
            adp: null,
            dynastyValue: null,
            injuryStatus: null,
            injuryNotes: null,
            news: [],
            dataSource: 'cfbd',
          },
        }),
      ),
    )
    written += batch.length
    if (written % 500 === 0 || written === seeds.length) console.log(`[ncaaf-import] upserted ${written}/${seeds.length}`)
  }

  const after = await prisma.sportsPlayerRecord.count({ where: { sport: 'NCAAF' } })
  console.log(`[ncaaf-import] NCAAF players after: ${after} (was ${before})`)
  await prisma.$disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('[ncaaf-import] FATAL', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
