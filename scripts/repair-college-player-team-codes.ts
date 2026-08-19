/**
 * Repair college SportsPlayerRecord team codes + basketball positions in place.
 *
 * Why: `normalizeTeamAbbrev` (NFL-only) passed full college institution names through to the
 * VarChar(32) `sports_players.team` column. Rows over 32 chars crashed their whole upsert batch
 * (NCAAB stalled at 100 rows vs 18,209 source players); rows at ≤32 were stored with raw
 * school-name "codes". The football position map also relabelled basketball Centers as 'OL'.
 *
 * This script rewrites EXISTING rows by id — team → sport-aware short code, position →
 * sport-aware normalization — so ids never change and no duplicates are created. The blocked
 * (never-written) players arrive via the next import-players cron run, not this script.
 *
 * Standalone (no server-only deps), mirrors scripts/import-ncaaf-players-cfbd.ts conventions.
 *
 * Usage:
 *   npx tsx scripts/repair-college-player-team-codes.ts --sport NCAAF --sport NCAAB            # dry run
 *   npx tsx scripts/repair-college-player-team-codes.ts --sport NCAAF --apply                  # write
 *   flags: --sport <S> (repeatable)  --dry-run (default)  --apply  --batch-size N  --resume-after <id>
 */

import fs from 'node:fs'
import {
  normalizePositionForSport,
  normalizeTeamCode,
  TEAM_CODE_MAX_LENGTH,
  type TeamCodeNormalization,
} from '../lib/team-abbrev'

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

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const sports: string[] = []
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--sport' && args[i + 1]) sports.push(args[i + 1].toUpperCase())
}
if (sports.length === 0) sports.push('NCAAF', 'NCAAB')
const batchIdx = args.indexOf('--batch-size')
const BATCH = batchIdx >= 0 && Number(args[batchIdx + 1]) > 0 ? Number(args[batchIdx + 1]) : 500
const resumeIdx = args.indexOf('--resume-after')
const RESUME_AFTER = resumeIdx >= 0 ? args[resumeIdx + 1] : null

async function main() {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  const totals = {
    scanned: 0,
    changed: 0,
    unchanged: 0,
    failed: 0,
    missingTeam: 0,
    positionChanged: 0,
    byNormalization: { canonical: 0, provider_code: 0, mapped: 0, derived: 0, truncated_fallback: 0, missing: 0 } as Record<TeamCodeNormalization, number>,
  }

  for (const sport of sports) {
    const teams = await prisma.sportsTeam.findMany({ where: { sport }, select: { name: true, shortName: true } })
    const teamCodeMap = new Map<string, string>()
    for (const team of teams) {
      const short = team.shortName?.trim()
      if (team.name && short) teamCodeMap.set(team.name.trim().toUpperCase(), short)
    }
    console.log(`[repair] ${sport}: team map loaded (${teamCodeMap.size} names)`)

    let cursor: string | null = RESUME_AFTER
    for (;;) {
      const rows: Array<{ id: string; team: string; position: string }> = await prisma.sportsPlayerRecord.findMany({
        where: { sport },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, team: true, position: true },
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id

      for (const row of rows) {
        totals.scanned += 1
        try {
          if (!row.team?.trim()) {
            totals.missingTeam += 1
            continue
          }
          const normalized = normalizeTeamCode({ sport, rawTeam: row.team, teamCodeMap })
          const newTeam = normalized.code ?? 'FA'
          const newPosition = normalizePositionForSport(sport, row.position) ?? row.position
          const teamChanged = newTeam !== row.team
          const positionChanged = newPosition !== row.position

          if (!teamChanged && !positionChanged) {
            totals.unchanged += 1
            continue
          }
          if (newTeam.length > TEAM_CODE_MAX_LENGTH) throw new Error(`code still too long: ${newTeam}`)

          totals.byNormalization[normalized.normalization] += 1
          if (positionChanged) totals.positionChanged += 1
          totals.changed += 1

          if (APPLY) {
            await prisma.sportsPlayerRecord.update({
              where: { id: row.id },
              data: { team: newTeam, ...(positionChanged ? { position: newPosition } : {}) },
            })
          } else if (totals.changed <= 10) {
            console.log(`  would change: ${row.id}  team "${row.team}" -> "${newTeam}"${positionChanged ? `  pos "${row.position}" -> "${newPosition}"` : ''}`)
          }
        } catch (e) {
          totals.failed += 1
          console.error(`  FAILED ${row.id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      console.log(`[repair] ${sport}: scanned=${totals.scanned} changed=${totals.changed} (cursor ${cursor})`)
    }
  }

  console.log(`\n[repair] ${APPLY ? 'APPLIED' : 'DRY RUN'} — totals:`)
  console.log(JSON.stringify(totals, null, 2))
  await prisma.$disconnect()
  if (!APPLY) console.log('\nRe-run with --apply to persist.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
