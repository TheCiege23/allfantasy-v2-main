/**
 * READ-ONLY audit of the identity stores, ahead of converging them onto PlatformIdentity.
 *
 * The same fact — "this AF user is this Sleeper user" — is currently written to THREE
 * places that do not agree with each other:
 *
 *   1. AppUser.legacyUserId -> LegacyUser   unique + enforced (linkAfUserToLegacy 409s)
 *   2. UserProfile.sleeperUserId            NOT unique; the write is silently SKIPPED
 *                                           when the id is already on another profile
 *   3. PlatformIdentity                     unique + throws, but written from one route
 *
 * Convergence cannot be enforced until we know what already violates it, because turning
 * on a constraint that existing rows break locks real users out of their own accounts.
 * This script answers that, and nothing else: it performs NO writes.
 *
 * Run:  npx tsx scripts/audit-identity-duplicates.ts
 * ⚠ Reads whatever `.env.local` points at — which in this repo is PRODUCTION.
 */
import * as dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const prisma = new PrismaClient()

function heading(title: string) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)
}

async function main() {
  const target = (process.env.DATABASE_URL ?? '').replace(/:[^:@/]+@/, ':***@')
  console.log(`DB target: ${target || '(unset)'}`)

  // ── Coverage: how much of the intended source of truth actually exists ──────────
  heading('1. PlatformIdentity coverage (the intended single source of truth)')
  const identityTotal = await prisma.platformIdentity.count()
  const identityByPlatform = await prisma.platformIdentity.groupBy({
    by: ['platform'],
    _count: { _all: true },
  })
  console.log(`total rows: ${identityTotal}`)
  for (const row of identityByPlatform) {
    console.log(`  ${row.platform}: ${row._count._all}`)
  }

  const appUsers = await prisma.appUser.count()
  const linkedViaLegacy = await prisma.appUser.count({ where: { legacyUserId: { not: null } } })
  const profilesWithSleeper = await prisma.userProfile.count({
    where: { sleeperUserId: { not: null } },
  })
  console.log(`\nAppUser total: ${appUsers}`)
  console.log(`  with legacyUserId (store 1): ${linkedViaLegacy}`)
  console.log(`  UserProfile.sleeperUserId set (store 2): ${profilesWithSleeper}`)
  console.log(`  PlatformIdentity rows (store 3): ${identityTotal}`)

  // ── The duplicates that block enforcement ──────────────────────────────────────
  // One Sleeper account sitting on more than one AF user. These CANNOT be resolved by
  // code — a human has to pick which account wins — so they are the gate on enforcement.
  heading('2. Sleeper ids claimed by MORE THAN ONE AppUser (blocks enforcement)')
  const dupProfiles = await prisma.userProfile.groupBy({
    by: ['sleeperUserId'],
    where: { sleeperUserId: { not: null } },
    _count: { _all: true },
    having: { sleeperUserId: { _count: { gt: 1 } } },
  })
  if (dupProfiles.length === 0) {
    console.log('none — no Sleeper id is on two profiles')
  } else {
    console.log(`${dupProfiles.length} Sleeper id(s) duplicated across profiles:\n`)
    for (const row of dupProfiles) {
      const holders = await prisma.userProfile.findMany({
        where: { sleeperUserId: row.sleeperUserId },
        select: { userId: true, sleeperUsername: true },
      })
      const users = await prisma.appUser.findMany({
        where: { id: { in: holders.map((h) => h.userId) } },
        select: { id: true, email: true, username: true, createdAt: true, legacyUserId: true },
      })
      console.log(`  sleeperUserId=${row.sleeperUserId} (${row._count._all} accounts)`)
      for (const u of users) {
        const providers = await prisma.authAccount.findMany({
          where: { userId: u.id },
          select: { provider: true },
        })
        const how = providers.length ? providers.map((p) => p.provider).join('+') : 'password'
        console.log(
          `    - ${u.email ?? '(no email)'}  @${u.username ?? '?'}  via=${how}  ` +
            `created=${u.createdAt.toISOString().slice(0, 10)}  legacyLinked=${Boolean(u.legacyUserId)}`,
        )
      }
    }
  }

  // ── The consistency bug, quantified ────────────────────────────────────────────
  // linkAfUserToLegacy writes AppUser.legacyUserId and then SKIPS the UserProfile write
  // when the Sleeper id is already taken. Those users read as linked via store 1 and
  // unlinked via store 2, depending on which one the calling code happens to consult.
  heading('3. Store 1 vs store 2 disagreement (the silent-skip bug)')
  const legacyLinked = await prisma.appUser.findMany({
    where: { legacyUserId: { not: null } },
    select: { id: true, email: true, legacyUserId: true },
  })
  const legacyIds = legacyLinked.map((u) => u.legacyUserId!).filter(Boolean)
  const legacyRows = await prisma.legacyUser.findMany({
    where: { id: { in: legacyIds } },
    select: { id: true, sleeperUserId: true, sleeperUsername: true },
  })
  const legacyById = new Map(legacyRows.map((l) => [l.id, l]))
  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: legacyLinked.map((u) => u.id) } },
    select: { userId: true, sleeperUserId: true },
  })
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]))

  const mismatched: string[] = []
  for (const u of legacyLinked) {
    const legacy = legacyById.get(u.legacyUserId!)
    if (!legacy) continue
    const profileSleeper = profileByUser.get(u.id)?.sleeperUserId ?? null
    if (profileSleeper !== legacy.sleeperUserId) {
      mismatched.push(
        `  ${u.email ?? u.id}: legacy=${legacy.sleeperUserId} profile=${profileSleeper ?? 'NULL'}`,
      )
    }
  }
  console.log(`${mismatched.length} of ${legacyLinked.length} legacy-linked users disagree:`)
  mismatched.slice(0, 40).forEach((m) => console.log(m))
  if (mismatched.length > 40) console.log(`  ... and ${mismatched.length - 40} more`)

  // ── What a backfill would have to create ───────────────────────────────────────
  heading('4. Backfill size (rows PlatformIdentity is missing)')
  const existing = await prisma.platformIdentity.findMany({
    where: { platform: 'sleeper' },
    select: { platformUserId: true },
  })
  const have = new Set(existing.map((e) => e.platformUserId))
  const wanted = new Set<string>()
  for (const l of legacyRows) if (l.sleeperUserId) wanted.add(l.sleeperUserId)
  for (const p of await prisma.userProfile.findMany({
    where: { sleeperUserId: { not: null } },
    select: { sleeperUserId: true },
  })) {
    if (p.sleeperUserId) wanted.add(p.sleeperUserId)
  }
  const missing = [...wanted].filter((id) => !have.has(id))
  console.log(`distinct Sleeper ids across stores 1+2: ${wanted.size}`)
  console.log(`already in PlatformIdentity: ${have.size}`)
  console.log(`would be created by a backfill: ${missing.length}`)

  heading('VERDICT')
  if (dupProfiles.length === 0) {
    console.log('No cross-account Sleeper duplicates — enforcement can be turned on safely.')
  } else {
    console.log(
      `${dupProfiles.length} duplicate Sleeper id(s) must be resolved by a human BEFORE\n` +
        'enforcement, or those users will be locked out of one of their accounts.',
    )
  }
}

main()
  .catch((err) => {
    console.error('[audit-identity-duplicates] failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
