/**
 * Dashboard V2 dev-fixture seed: creates ONE league where the Local Dev User is a
 * manager/member only (not owner, not commissioner, not co-commissioner), so
 * Dashboard V2's Team Focus context can be verified live in the browser instead of
 * only by code inspection. Prisma Client only -- no raw SQL, no migrations, no deletes.
 *
 * Intended to run ONLY against an isolated dev/preview Neon branch (never production).
 * Run with: npx tsx scripts/seed-managed-only-dev-league.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

// Static `import` of lib/prisma would be hoisted ahead of any top-level dotenv.config()
// call (ESM/esbuild hoisting), so its module-level getDatabaseUrlOrThrow() would run
// before DATABASE_URL is set. Set the env var directly, synchronously, first.
const envPath = path.resolve(__dirname, '..', '.env.local')
const envRaw = fs.readFileSync(envPath, 'utf8')
const match = envRaw.split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l))
if (match) {
  process.env.DATABASE_URL = match.replace(/^DATABASE_URL=/, '').replace(/^['"]|['"]$/g, '')
}

const DEV_USER_LOOKUP = {
  id: 'local-dev-user',
  email: 'local-dev@allfantasy.local',
  username: 'local_dev_user',
}

async function main() {
  // Fail closed before the first write — see scripts/_assert-safe-seed-target.ts.
  assertSafeSeedTarget('seed-managed-only-dev-league')

  const { prisma } = await import('../lib/prisma')

  const localDevUser = await prisma.appUser.findFirst({
    where: {
      OR: [
        { id: DEV_USER_LOOKUP.id },
        { email: { equals: DEV_USER_LOOKUP.email, mode: 'insensitive' } },
        { username: DEV_USER_LOOKUP.username },
      ],
    },
  })

  if (!localDevUser) {
    throw new Error(
      'Local Dev User not found. Load /dashboard once via the dev-auth bypass first so ensureDevAuthUser() creates it.',
    )
  }

  const syntheticCommissioner = await prisma.appUser.create({
    data: {
      email: 'fixture-commissioner@allfantasy.local',
      username: 'fixture_commissioner',
      displayName: 'Fixture Commissioner',
      emailVerified: new Date(),
    },
  })

  const league = await (prisma as any).league.create({
    data: {
      userId: syntheticCommissioner.id,
      platform: 'allfantasy',
      platformLeagueId: `fixture-managed-only-${Date.now()}`,
      name: 'Dynasty Test League (Managed)',
      sport: 'NFL',
      season: 2026,
      leagueSize: 10,
      isDynasty: true,
      leagueType: 'dynasty',
      status: 'in_season',
      lifecycleState: 'in_season',
      isCommissioner: false,
    },
  })

  await (prisma as any).roster.create({
    data: {
      leagueId: league.id,
      platformUserId: syntheticCommissioner.id,
      playerData: {},
    },
  })

  await (prisma as any).roster.create({
    data: {
      leagueId: league.id,
      platformUserId: localDevUser.id,
      playerData: {},
    },
  })

  await (prisma as any).redraftLeagueMember.create({
    data: {
      leagueId: league.id,
      userId: localDevUser.id,
      role: 'MEMBER',
    },
  })

  console.log('Created managed-only fixture league:')
  console.log('  leagueId:', league.id)
  console.log('  leagueName:', league.name)
  console.log('  ownerUserId (synthetic commissioner):', syntheticCommissioner.id)
  console.log('  localDevUserId (member, not owner/commissioner):', localDevUser.id)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  process.exitCode = 1
  const { prisma } = await import('../lib/prisma')
  await prisma.$disconnect()
})
