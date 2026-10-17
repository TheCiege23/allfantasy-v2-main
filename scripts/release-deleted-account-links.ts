/**
 * One-time repair: release what accounts deleted BEFORE the fix still hold.
 *
 * /api/user/delete used to anonymize only the AppUser row, so every account
 * deleted before lib/account/releaseDeletedAccountLinks existed still owns its
 * Sleeper link, phone, Discord/Spotify identities and tokens, platform
 * identities, claimed teams and Legacy claim — and the unique ones block the
 * same person from linking them to a new account. This runs the same release
 * over those accounts.
 *
 * 2026-10: the release now also DELETES stored platform credentials (league_auths,
 * YahooConnection, database sessions), so accounts deleted before that are reported
 * and released here too.
 *
 * Deleted accounts are recognised by the anonymized email the route writes:
 * `deleted+<id>@deleted.invalid`.
 *
 *   npx tsx scripts/release-deleted-account-links.ts                 # dry run: reports, writes nothing
 *   npx tsx scripts/release-deleted-account-links.ts --apply         # writes (refused on production…)
 *   npx tsx scripts/release-deleted-account-links.ts --apply --production   # …unless you say so
 *
 * Idempotent: an already-released account reports zeros.
 */
import { PrismaClient } from "@prisma/client"

import { describeDbTarget, isProductionDbTarget } from "./_db-target-identity"
import { releaseDeletedAccountLinks } from "../lib/account/releaseDeletedAccountLinks"

const apply = process.argv.includes("--apply")
const allowProduction = process.argv.includes("--production")

async function main() {
  const url = process.env.DATABASE_URL
  console.log(`[release-deleted-account-links] target: ${describeDbTarget(url)}`)
  if (apply && isProductionDbTarget(url) && !allowProduction) {
    console.error("Refusing to write to production without --production.")
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    const deleted = await prisma.appUser.findMany({
      where: { email: { startsWith: "deleted+", endsWith: "@deleted.invalid" } },
      select: { id: true, legacyUserId: true },
    })
    console.log(`${deleted.length} deleted account(s).`)

    let still = 0
    for (const u of deleted) {
      const [profile, identities, teams, credentials, yahoo, sessions] = await Promise.all([
        prisma.userProfile.findUnique({
          where: { userId: u.id },
          select: { sleeperUserId: true, phone: true, discordUserId: true, discordAccessToken: true, spotifyAccessToken: true },
        }),
        prisma.platformIdentity.count({ where: { userId: u.id } }),
        prisma.leagueTeam.count({ where: { claimedByUserId: u.id } }),
        prisma.leagueAuth.count({ where: { userId: u.id } }),
        prisma.yahooConnection.count({ where: { userId: u.id } }),
        prisma.authSession.count({ where: { userId: u.id } }),
      ])
      const holds = {
        sleeper: Boolean(profile?.sleeperUserId),
        phone: Boolean(profile?.phone),
        discord: Boolean(profile?.discordUserId || profile?.discordAccessToken),
        spotifyToken: Boolean(profile?.spotifyAccessToken),
        platformIdentities: identities,
        claimedTeams: teams,
        legacy: Boolean(u.legacyUserId),
        platformCredentials: credentials,
        yahooConnections: yahoo,
        sessions,
      }
      const anything =
        holds.sleeper || holds.phone || holds.discord || holds.spotifyToken || identities > 0 || teams > 0 || holds.legacy ||
        credentials > 0 || yahoo > 0 || sessions > 0
      if (!anything) continue
      still += 1
      // Ids only — never the phone, handle or token themselves.
      console.log(`  ${u.id}`, JSON.stringify(holds))
      if (apply) {
        const released = await prisma.$transaction((tx) => releaseDeletedAccountLinks(tx, u.id))
        console.log(`    released`, JSON.stringify(released))
      }
    }
    console.log(`${still} still held something.${apply ? " Released." : " Dry run — nothing written. Re-run with --apply."}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
