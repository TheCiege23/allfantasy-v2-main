/**
 * One-time purge: delete every stored legacy MFL session (MFLConnection).
 *
 * Those rows came from the MFL username-and-password login on /af-legacy, retired 2026-10.
 * Each holds MFL's MFL_USER_ID session cookie in PLAINTEXT, no user id (the row is keyed by
 * a browser cookie), and nothing reads them any more — /api/auth/mfl and /api/mfl/leagues
 * are deleted. The 2026-10 Terms and Privacy Policy say AllFantasy never asks for or stores a
 * platform password; a live session cookie minted from one should not outlive the flow.
 *
 *   npx tsx scripts/purge-legacy-mfl-sessions.ts                         # dry run: counts only
 *   npx tsx scripts/purge-legacy-mfl-sessions.ts --apply                 # deletes (refused on production…)
 *   npx tsx scripts/purge-legacy-mfl-sessions.ts --apply --production    # …unless you say so
 *
 * Prints counts and dates only — never a username or cookie.
 */
import { PrismaClient } from "@prisma/client"

import { describeDbTarget, isProductionDbTarget } from "./_db-target-identity"

const apply = process.argv.includes("--apply")
const allowProduction = process.argv.includes("--production")

async function main() {
  const url = process.env.DATABASE_URL
  console.log(`[purge-legacy-mfl-sessions] target: ${describeDbTarget(url)}`)
  if (apply && isProductionDbTarget(url) && !allowProduction) {
    console.error("Refusing to write to production without --production.")
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    const rows = await prisma.mFLConnection.aggregate({
      _count: { _all: true },
      _min: { updatedAt: true },
      _max: { updatedAt: true },
    })
    console.log(
      `${rows._count._all} legacy MFL session(s), last updated between ${rows._min.updatedAt?.toISOString() ?? "-"} and ${
        rows._max.updatedAt?.toISOString() ?? "-"
      }.`,
    )
    if (!apply) {
      console.log("Dry run — nothing written. Re-run with --apply.")
      return
    }
    const deleted = await prisma.mFLConnection.deleteMany({})
    console.log(`Deleted ${deleted.count}.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
