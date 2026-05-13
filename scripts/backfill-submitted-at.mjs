/**
 * scripts/backfill-submitted-at.mjs
 *
 * Safely backfills `submittedAt` for playoff bracket entries that have a
 * complete set of picks but no submission timestamp.
 *
 * Background: Before the fix in playoffService.ts, submitPlayoffBracketEntry()
 * did not persist `submittedAt`. Entries created before that fix may have all
 * their picks in place but `submittedAt = NULL`, which causes:
 *   - Lock reminders to target already-complete brackets
 *   - Lock enforcement (isLocked) to never fire for those entries
 *
 * Algorithm:
 *   For each PlayoffBracketChallenge:
 *     seriesCount = COUNT(PlayoffBracketSeries WHERE challengeId)
 *     For each PlayoffBracketEntry WHERE challengeId AND submittedAt IS NULL:
 *       pickCount = COUNT(PlayoffBracketPick WHERE entryId AND challengeId)
 *       IF pickCount >= seriesCount:
 *         SET submittedAt = COALESCE(updatedAt, createdAt)
 *
 * Usage:
 *   node scripts/backfill-submitted-at.mjs            # dry run (default)
 *   node scripts/backfill-submitted-at.mjs --execute  # apply changes
 *   node scripts/backfill-submitted-at.mjs --challengeId=<id>  # single challenge
 *
 * Safety:
 *   - Dry run by default — no DB mutations without --execute
 *   - Only touches entries with submittedAt IS NULL (idempotent)
 *   - Uses COALESCE(updatedAt, createdAt) — picks the most meaningful timestamp
 *   - Logs every entry it would touch / touches
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--execute')
const singleChallengeArg = args.find((a) => a.startsWith('--challengeId='))
const SINGLE_CHALLENGE_ID = singleChallengeArg ? singleChallengeArg.split('=')[1] : null

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== backfill-submitted-at ===')
  console.log(`mode       : ${DRY_RUN ? 'DRY RUN (no DB writes)' : '⚡ EXECUTE'}`)
  if (SINGLE_CHALLENGE_ID) {
    console.log(`challengeId: ${SINGLE_CHALLENGE_ID}`)
  }
  console.log()

  // 1. Discover challenges to process
  let challenges
  if (SINGLE_CHALLENGE_ID) {
    challenges = await prisma.$queryRaw`
      SELECT id, name, sport, "seasonYear"
      FROM "PlayoffBracketChallenge"
      WHERE id = ${SINGLE_CHALLENGE_ID}
    `
  } else {
    challenges = await prisma.$queryRaw`
      SELECT id, name, sport, "seasonYear"
      FROM "PlayoffBracketChallenge"
      ORDER BY "createdAt" DESC
    `
  }

  if (!challenges.length) {
    console.log('No challenges found.')
    return
  }

  console.log(`Found ${challenges.length} challenge(s) to inspect.\n`)

  let totalInspected = 0
  let totalEligible = 0
  let totalBackfilled = 0

  for (const challenge of challenges) {
    // 2. Count series for this challenge
    const seriesCountRows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "PlayoffBracketSeries"
      WHERE "challengeId" = ${challenge.id}
    `
    const seriesCount = Number(seriesCountRows[0]?.count ?? 0)

    if (seriesCount === 0) {
      console.log(`[${challenge.id.slice(0, 8)}] ${challenge.name} — no series, skipping`)
      continue
    }

    // 3. Find entries with submittedAt IS NULL
    const unsubmittedEntries = await prisma.$queryRaw`
      SELECT
        e.id,
        e.name,
        e."userId",
        e."createdAt",
        e."updatedAt",
        e."submittedAt",
        COUNT(p.id)::int AS "pickCount"
      FROM "PlayoffBracketEntry" e
      LEFT JOIN "PlayoffBracketPick" p
        ON p."entryId" = e.id AND p."challengeId" = e."challengeId"
      WHERE e."challengeId" = ${challenge.id}
        AND e."submittedAt" IS NULL
      GROUP BY e.id, e.name, e."userId", e."createdAt", e."updatedAt", e."submittedAt"
    `

    totalInspected += unsubmittedEntries.length

    console.log(
      `[${challenge.id.slice(0, 8)}] ${challenge.name} (${challenge.sport} ${challenge.seasonYear}) ` +
      `— seriesCount=${seriesCount} unsubmittedEntries=${unsubmittedEntries.length}`
    )

    if (unsubmittedEntries.length === 0) {
      console.log('  └─ all entries already have submittedAt, skipping\n')
      continue
    }

    // 4. Find eligible (complete) entries among unsubmitted
    const eligible = unsubmittedEntries.filter(
      (e) => Number(e.pickCount) >= seriesCount
    )
    totalEligible += eligible.length

    const incomplete = unsubmittedEntries.filter(
      (e) => Number(e.pickCount) < seriesCount
    )

    if (incomplete.length > 0) {
      console.log(`  ├─ ${incomplete.length} incomplete entries (skipped):`)
      for (const e of incomplete) {
        console.log(`  │   - ${e.id.slice(0, 8)} "${e.name}" picks=${e.pickCount}/${seriesCount}`)
      }
    }

    if (eligible.length === 0) {
      console.log('  └─ no eligible entries to backfill\n')
      continue
    }

    console.log(`  ├─ ${eligible.length} eligible entries to backfill:`)
    for (const entry of eligible) {
      // Use updatedAt (when last pick was made) if available, else createdAt
      const backfillTs = entry.updatedAt ?? entry.createdAt
      console.log(
        `  │   - ${entry.id.slice(0, 8)} "${entry.name}" picks=${entry.pickCount}/${seriesCount} ` +
        `→ submittedAt=${backfillTs.toISOString()}`
      )

      if (!DRY_RUN) {
        await prisma.$executeRaw`
          UPDATE "PlayoffBracketEntry"
          SET "submittedAt" = ${backfillTs}
          WHERE id = ${entry.id}
            AND "submittedAt" IS NULL
        `
        totalBackfilled++
      }
    }

    if (DRY_RUN) {
      console.log(`  └─ [dry run] would backfill ${eligible.length} entries\n`)
    } else {
      totalBackfilled += eligible.length
      console.log(`  └─ ✅ backfilled ${eligible.length} entries\n`)
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────')
  console.log(`challenges inspected : ${challenges.length}`)
  console.log(`entries without submittedAt: ${totalInspected}`)
  console.log(`eligible (complete)  : ${totalEligible}`)
  if (DRY_RUN) {
    console.log(`would backfill       : ${totalEligible}`)
    console.log()
    console.log('Run with --execute to apply changes.')
  } else {
    console.log(`backfilled           : ${totalBackfilled}`)
  }
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
