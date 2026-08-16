/**
 * Backfill `PlatformIdentity` from the two older identity stores.
 *
 * `PlatformIdentity` is the row `resolveLinkedAccounts` reads to decide whether two
 * AppUsers are the same human, but historically it was written from a single import
 * route, so it is empty while `AppUser.legacyUserId` and `UserProfile.sleeperUserId`
 * hold real links. Until it is populated the duplicate-league gate has nothing to match
 * on and silently lets everything through.
 *
 * DRY RUN BY DEFAULT — prints the plan and writes nothing.
 *   npx tsx scripts/backfill-platform-identity.ts            # preview
 *   npx tsx scripts/backfill-platform-identity.ts --apply    # write
 *
 * ⚠ Targets whatever `.env.local` points at — PRODUCTION in this repo.
 *
 * Safe to re-run: each row is keyed on (platform, platformUserId), already-correct rows
 * are skipped, and a pair pointing at a DIFFERENT user is reported rather than
 * overwritten — reassigning one would silently move a Sleeper account between accounts.
 */
import * as dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

type Candidate = {
  userId: string
  platformUserId: string
  platformUsername: string
  displayName: string | null
  avatarUrl: string | null
  source: 'legacyUser' | 'userProfile'
}

async function collectCandidates(): Promise<Candidate[]> {
  const byPlatformId = new Map<string, Candidate>()

  // Store 1 — AppUser.legacyUserId -> LegacyUser. Preferred: it is the enforced link.
  const legacyLinked = await prisma.appUser.findMany({
    where: { legacyUserId: { not: null } },
    select: { id: true, legacyUserId: true },
  })
  const legacyRows = await prisma.legacyUser.findMany({
    where: { id: { in: legacyLinked.map((u) => u.legacyUserId!).filter(Boolean) } },
    select: { id: true, sleeperUserId: true, sleeperUsername: true, displayName: true, avatarUrl: true },
  })
  const legacyById = new Map(legacyRows.map((l) => [l.id, l]))
  for (const u of legacyLinked) {
    const legacy = legacyById.get(u.legacyUserId!)
    if (!legacy?.sleeperUserId) continue
    byPlatformId.set(legacy.sleeperUserId, {
      userId: u.id,
      platformUserId: legacy.sleeperUserId,
      platformUsername: legacy.sleeperUsername,
      displayName: legacy.displayName,
      avatarUrl: legacy.avatarUrl,
      source: 'legacyUser',
    })
  }

  // Store 2 — UserProfile.sleeperUserId. Only fills gaps store 1 did not cover.
  const profiles = await prisma.userProfile.findMany({
    where: { sleeperUserId: { not: null } },
    select: { userId: true, sleeperUserId: true, sleeperUsername: true, displayName: true },
  })
  for (const p of profiles) {
    if (!p.sleeperUserId || byPlatformId.has(p.sleeperUserId)) continue
    byPlatformId.set(p.sleeperUserId, {
      userId: p.userId,
      platformUserId: p.sleeperUserId,
      platformUsername: p.sleeperUsername ?? p.sleeperUserId,
      displayName: p.displayName,
      avatarUrl: null,
      source: 'userProfile',
    })
  }

  return [...byPlatformId.values()]
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`DB: ${(process.env.DATABASE_URL ?? '').replace(/:[^:@/]+@/, ':***@') || '(unset)'}\n`)

  const candidates = await collectCandidates()
  console.log(`candidates from stores 1+2: ${candidates.length}\n`)

  let created = 0
  let skipped = 0
  const conflicts: string[] = []

  for (const c of candidates) {
    const existing = await prisma.platformIdentity.findFirst({
      where: { platform: 'sleeper', platformUserId: c.platformUserId },
      select: { id: true, userId: true },
    })

    if (existing) {
      if (existing.userId === c.userId) {
        skipped += 1
        continue
      }
      // Two AF users claim one Sleeper account. Never auto-resolve — a human must choose.
      conflicts.push(
        `  sleeper:${c.platformUserId} — PlatformIdentity says ${existing.userId}, store says ${c.userId}`,
      )
      continue
    }

    console.log(
      `  ${APPLY ? 'CREATE' : 'would create'} sleeper:${c.platformUserId} ` +
        `(@${c.platformUsername}) -> ${c.userId}  [via ${c.source}]`,
    )
    if (APPLY) {
      await prisma.platformIdentity.create({
        data: {
          userId: c.userId,
          platform: 'sleeper',
          platformUserId: c.platformUserId,
          platformUsername: c.platformUsername,
          displayName: c.displayName ?? c.platformUsername,
          avatarUrl: c.avatarUrl,
          firstImportAt: new Date(),
          lastSyncedAt: new Date(),
        },
      })
    }
    created += 1
  }

  console.log(
    `\n${APPLY ? 'created' : 'would create'}: ${created}   already correct: ${skipped}   conflicts: ${conflicts.length}`,
  )
  if (conflicts.length > 0) {
    console.log('\nCONFLICTS — resolve by hand before enforcing:')
    conflicts.forEach((c) => console.log(c))
    process.exitCode = 1
  }
  if (!APPLY && created > 0) console.log('\nRe-run with --apply to write.')
}

main()
  .catch((err) => {
    console.error('[backfill-platform-identity] failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
