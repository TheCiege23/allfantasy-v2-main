/**
 * Kill the login vector on fixture accounts that reached a real database.
 *
 * ⚠ WHY THIS IS URGENT AND WHY IT ROTATES RATHER THAN DELETES
 * The war-room / survivor runtime seeds create login accounts with the password `Password123!`
 * hardcoded in the script — and this repository is PUBLIC. They had no target guard, so they
 * were run against production: as of 2026-08-17 prod held 22 such accounts across six seed
 * families, and all 22 accepted that published password. That is 22 working logins to a live
 * environment, published in a git repo anyone can read.
 *
 * This script replaces the password hash on those accounts with a random one nobody holds. It
 * deliberately does NOT delete them:
 *   - Deleting 22 users cascades into fixture leagues, rosters, matchups and subscriptions
 *     (10 leagues / 79 rosters / 5 of prod's 7 user_subscriptions), across relationships nobody
 *     has mapped. The blast radius of a bad delete is far larger than the problem.
 *   - Rotating the hash removes the entire vector with a one-column update on 22 rows. The
 *     fixture rows stay, inert, and can be cleaned up later as a separate deliberate exercise.
 * Rotation is the fix; cleanup is housekeeping. Do the fix first.
 *
 * Prevention lives in `scripts/_assert-safe-seed-target.ts`, which now fails closed in every
 * seed. This script only cleans up what those seeds wrote before the guard existed.
 *
 * Usage:
 *   npx tsx scripts/neutralize-fixture-accounts.ts            # dry run, writes nothing
 *   npx tsx scripts/neutralize-fixture-accounts.ts --apply    # snapshot, then rotate
 *
 * NOTE ON PATHS: these examples assume cwd is the checkout that CONTAINS this file. This
 * branch is usually checked out as a git worktree while the primary tree sits on another
 * branch, in which case run it from the primary tree with the worktree path, e.g.
 *   npx tsx .claude/worktrees/admiring-bassi-bff03b/scripts/neutralize-fixture-accounts.ts
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'

const APPLY = process.argv.includes('--apply')

/** Anchored to this file, not cwd: the snapshot holds production rows and must land beside the matching .gitignore rule. */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * ⚠ SELECTION IS BY HASH, NOT BY NAME. The first version of this script matched id prefixes
 * (`rwr-%`, `bbwr-%`, …) and found 22 accounts. That undercounted by eightfold: scanning every
 * row instead found 184 of 256 production accounts (72%) accepting a published password. Most
 * were `e2e.<timestamp>@example.com`, created by the Playwright suite pointing itself at
 * production — a family no id-prefix list would ever have guessed.
 *
 * So the rule is: read every account, and let bcrypt decide. A credential sweep scoped by
 * pattern tells you about the patterns you thought of.
 */
const KNOWN_FIXTURE_PASSWORDS = ['Password123!', 'Password1!', 'password123', 'Test1234!']

/**
 * ⚠ AND ROTATE ONLY TEST ADDRESSES. Accepting a weak password does NOT make an account a
 * fixture. Exactly one real user (`@gmail.com`, email-verified) also uses one of these
 * passwords; rotating them would lock a live person out of their own account, which is an
 * outage, not a remediation. That is a password-policy problem for the owner to handle by
 * forced reset or notification — not something this script should decide.
 *
 * Hence two independent conditions, both required: the hash accepts a published password AND
 * the address is a test domain. Anything else is reported and left untouched.
 */
const TEST_EMAIL_DOMAINS = ['@example.com', '@example.org', '@example.net', '@allfantasy.local']

type Row = { id: string; email: string | null; username: string | null; passwordHash: string | null }

function isTestAddress(email: string | null): boolean {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return false
  return TEST_EMAIL_DOMAINS.some((d) => e.endsWith(d))
}

async function main() {
  const target = await prisma.$queryRawUnsafe<Array<{ db: string; host: string | null }>>(
    `SELECT current_database() AS db, inet_server_addr()::text AS host`,
  )
  console.log(`target: ${target[0].db} @ ${target[0].host ?? 'local'}`)
  console.log(APPLY ? 'MODE: APPLY (writes)' : 'MODE: dry run (no writes)')

  // Every account, no pattern filter. See the note on KNOWN_FIXTURE_PASSWORDS.
  const candidates = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id, email, username, "passwordHash" FROM "app_users" ORDER BY id`,
  )

  const exposed: Row[] = []
  const realUsers: Row[] = []
  let safe = 0
  for (const u of candidates) {
    if (!u.passwordHash) continue
    let hit = false
    for (const p of KNOWN_FIXTURE_PASSWORDS) {
      if (await bcrypt.compare(p, u.passwordHash)) { hit = true; break }
    }
    if (!hit) { safe++; continue }
    if (isTestAddress(u.email)) exposed.push(u)
    else realUsers.push(u)
  }

  console.log(`\naccounts scanned: ${candidates.length}`)
  console.log(`  already safe (no known password):            ${safe}`)
  console.log(`  exposed AND a test address (will rotate):    ${exposed.length}`)
  console.log(`  exposed but NOT a test address (untouched):  ${realUsers.length}`)

  /*
   * Surface these loudly. They are the reason this script cannot simply rotate everything that
   * matches, and leaving them unmentioned would hide a real security issue behind a clean-looking
   * summary.
   */
  if (realUsers.length) {
    console.log('\n  ⚠ REAL ACCOUNTS using a published password — NOT rotated, needs a human decision:')
    realUsers.forEach((u) => console.log(`      ${u.email ?? u.id}  (${u.username ?? 'no username'})`))
    console.log('    Rotating these would lock real people out. Force a password reset or notify them.')
  }
  if (exposed.length) {
    const shown = exposed.slice(0, 10)
    console.log('\n  will rotate:')
    shown.forEach((u) => console.log(`      ${u.id}  ${u.email ?? ''}`))
    if (exposed.length > shown.length) console.log(`      … and ${exposed.length - shown.length} more`)
  }

  if (exposed.length === 0) {
    console.log('\nnothing to do.')
    await prisma.$disconnect()
    return
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply to rotate.')
    await prisma.$disconnect()
    return
  }

  /*
   * ⚠ SNAPSHOT BEFORE THE FIRST WRITE. Records the prior hashes so the change is reversible.
   * The path is gitignored — it contains production credentials material and this repo is public.
   */
  const takenAtIso = new Date().toISOString()
  const fs = await import('node:fs')
  const snapPath = path.join(
    SCRIPT_DIR,
    `.fixture-accounts-snapshot-${takenAtIso.replace(/[:.]/g, '-')}.json`,
  )
  fs.writeFileSync(
    snapPath,
    JSON.stringify({ takenAtIso, database: target[0].db, accounts: exposed }, null, 2),
    'utf8',
  )
  const written = fs.statSync(snapPath).size
  if (!written) {
    console.error('\nABORTED: snapshot is empty. Nothing rotated.')
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`\nsnapshot written: ${snapPath} (${exposed.length} accounts)`)

  // One transaction. Each account gets an INDEPENDENT random password nobody holds.
  const ids = exposed.map((u) => u.id)
  await prisma.$transaction(
    async (tx) => {
      for (const id of ids) {
        const random = crypto.randomBytes(32).toString('base64url')
        const hash = await bcrypt.hash(random, 10)
        await tx.$executeRawUnsafe(`UPDATE "app_users" SET "passwordHash" = $1 WHERE id = $2`, hash, id)
      }
    },
    { timeout: 600_000 },
  )
  console.log(`\napplied. rotated ${ids.length} account(s).`)

  // ⚠ POST-CONDITION, NOT A HOPE: none of them may still accept the published password.
  const after = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id, email, username, "passwordHash" FROM "app_users" WHERE id = ANY($1::text[])`,
    ids,
  )
  let stillExposed = 0
  for (const u of after) {
    if (!u.passwordHash) continue
    for (const p of KNOWN_FIXTURE_PASSWORDS) {
      if (await bcrypt.compare(p, u.passwordHash)) { stillExposed++; break }
    }
  }
  console.log(`accounts still accepting the published password: ${stillExposed} (must be 0)`)
  if (stillExposed !== 0) {
    console.error('POST-CONDITION FAILED — the vector is still open. Investigate immediately.')
    process.exitCode = 1
  }

  console.log(
    '\nRemaining follow-up, deliberately NOT done here:\n' +
      '  - The fixture rows themselves (10 leagues, 79 rosters, 52 Player rows, 5 subscriptions)\n' +
      '    are still present. They are inert without logins; removing them is a separate job.\n' +
      '\nAnd one that was considered and REJECTED after measuring it:\n' +
      '  - Moving `Password123!` out of the seeds into an env var. It is not read from the seed\n' +
      '    constant — roughly twenty e2e specs, unit tests and docs each hardcode their own copy,\n' +
      '    so this is a wide refactor across a suite that is already red on main, and it cannot be\n' +
      '    validated here. It also buys nothing now: a fixed password in test fixtures is only a\n' +
      '    vulnerability if the fixtures reach a real database, and both halves of that are closed\n' +
      '    — the guard refuses production, and the accounts that leaked are rotated. Revisit only\n' +
      '    if fixtures end up in a real environment again.',
  )

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
