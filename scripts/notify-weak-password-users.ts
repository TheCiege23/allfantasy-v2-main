/**
 * Notify REAL users whose password matches one that is publicly known.
 *
 * WHY THIS IS SEPARATE FROM `neutralize-fixture-accounts.ts`
 * That script rotates fixture accounts. It deliberately refuses to touch real ones, because
 * silently changing a live person's password is an outage, not a remediation. The remaining
 * exposure is therefore a communication problem, not a database one: tell the person, give them
 * a reset link, and let them act.
 *
 * WHAT IT DOES NOT DO
 *  - Does not change any password. The user stays in control of their own account.
 *  - Does not put the password in the email. Telling someone their password over email is worse
 *    than the problem, and the message has to survive being forwarded or read over a shoulder.
 *  - Does not claim a breach. There is no evidence any of these accounts was accessed, and
 *    implying otherwise would be both alarming and untrue.
 *  - Does not email test addresses. Those get rotated instead; see the other script.
 *
 * Re-checks each recipient's hash immediately before sending, so a user who already changed
 * their password is never emailed about it.
 *
 * Usage — the `server-only` shim must be preloaded, because `lib/resend-client.ts` imports
 * `server-only`, which throws under plain Node. Plain `npx tsx` on this file will not run.
 *
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/notify-weak-password-users.ts
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/notify-weak-password-users.ts --apply
 *
 * NOTE ON PATHS: the examples above assume cwd is the checkout that CONTAINS this file. This
 * branch is usually a git worktree while the primary tree sits on another branch, so from the
 * primary tree give the worktree path for the SCRIPT and keep the preload local (both copies of
 * the shim are identical):
 *
 *   node --require ./scripts/_audit-preload.cjs --import tsx \
 *     ./.claude/worktrees/<worktree>/scripts/notify-weak-password-users.ts --apply
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { sendTemplatedEmail } from '../lib/resend-client'

const APPLY = process.argv.includes('--apply')

/** Passwords published in this repo's fixtures/specs, hence effectively public. */
const KNOWN_PUBLIC_PASSWORDS = ['Password123!', 'Password1!', 'password123', 'Test1234!']

/** Test domains are rotated, not emailed. */
const TEST_EMAIL_DOMAINS = ['@example.com', '@example.org', '@example.net', '@allfantasy.local']

/**
 * A hard cap. This script exists to contact a very small number of people; if the query ever
 * matches a crowd, that is a bug or a much bigger incident, and either way it deserves a human
 * looking at it before a mass mailing goes out.
 */
const MAX_RECIPIENTS = 5

type Row = { id: string; email: string | null; username: string | null; passwordHash: string | null }

const isTestAddress = (email: string | null): boolean => {
  const e = (email ?? '').trim().toLowerCase()
  return !!e && TEST_EMAIL_DOMAINS.some((d) => e.endsWith(d))
}

function buildEmail(username: string | null): { subject: string; html: string } {
  const greeting = username ? `Hi ${username},` : 'Hi,'
  return {
    subject: 'Please update your AllFantasy password',
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:520px">
  <p>${greeting}</p>
  <p>
    During a routine internal security review we found that the password on your AllFantasy
    account is one that appears on public lists of common passwords. That makes it much easier
    to guess than it should be, so we would like you to change it.
  </p>
  <p>
    <strong>This is not a report of a break-in.</strong> We have no indication that anyone has
    accessed your account, and nothing about your account has been changed. We are contacting
    you so you can update it before it becomes a problem, rather than after.
  </p>
  <p>
    You can set a new password here:<br />
    <a href="https://www.allfantasy.ai/reset-password" style="color:#2563eb">https://www.allfantasy.ai/reset-password</a>
  </p>
  <p>
    If you use that same password anywhere else, it is worth changing it there too — that is
    where reused passwords usually cause the most damage.
  </p>
  <p>Thanks for helping us keep your account secure.<br />— The AllFantasy team</p>
</div>`.trim(),
  }
}

async function main() {
  const target = await prisma.$queryRawUnsafe<Array<{ db: string }>>(
    `SELECT current_database() AS db`,
  )
  console.log(`target: ${target[0].db}`)
  console.log(APPLY ? 'MODE: APPLY (sends email)' : 'MODE: dry run (sends nothing)')

  const all = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id, email, username, "passwordHash" FROM "app_users" WHERE email IS NOT NULL ORDER BY id`,
  )

  const recipients: Row[] = []
  for (const u of all) {
    if (!u.passwordHash || isTestAddress(u.email)) continue
    for (const p of KNOWN_PUBLIC_PASSWORDS) {
      if (await bcrypt.compare(p, u.passwordHash)) { recipients.push(u); break }
    }
  }

  console.log(`\nreal accounts using a publicly-known password: ${recipients.length}`)
  recipients.forEach((u) => console.log(`  ${u.email}  (${u.username ?? 'no username'})`))

  if (recipients.length === 0) {
    console.log('\nnothing to send.')
    await prisma.$disconnect()
    return
  }

  if (recipients.length > MAX_RECIPIENTS) {
    console.error(
      `\nABORTED: ${recipients.length} recipients exceeds the cap of ${MAX_RECIPIENTS}. ` +
        `This script is for a handful of people. Review before sending anything.`,
    )
    await prisma.$disconnect()
    process.exit(1)
  }

  const preview = buildEmail(recipients[0].username)
  console.log(`\n── subject ──\n${preview.subject}`)
  console.log(`\n── body (HTML) ──\n${preview.html}\n`)

  if (!APPLY) {
    console.log('dry run — nothing sent. Re-run with --apply to send.')
    await prisma.$disconnect()
    return
  }

  let sent = 0
  let failed = 0
  for (const u of recipients) {
    /*
     * Re-check immediately before sending. Between the scan above and this line the user may
     * have changed their password, and emailing someone a security warning they already acted on
     * is both confusing and a small breach of trust.
     */
    const fresh = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, email, username, "passwordHash" FROM "app_users" WHERE id = $1`,
      u.id,
    )
    const hash = fresh[0]?.passwordHash
    let stillWeak = false
    if (hash) {
      for (const p of KNOWN_PUBLIC_PASSWORDS) {
        if (await bcrypt.compare(p, hash)) { stillWeak = true; break }
      }
    }
    if (!stillWeak) {
      console.log(`  SKIP ${u.email} — password already changed since the scan`)
      continue
    }

    const { subject, html } = buildEmail(u.username)
    const res = await sendTemplatedEmail({ to: u.email as string, subject, html })
    if (res.ok) { sent++; console.log(`  SENT ${u.email}`) }
    else { failed++; console.error(`  FAIL ${u.email}: ${res.error}`) }
  }

  console.log(`\nsent: ${sent}  failed: ${failed}`)
  if (failed > 0) process.exitCode = 1

  console.log(
    '\nNote: this only informs them. Their password is unchanged and still weak until they act.\n' +
      'If they do not act, the next step is a forced reset — a product decision, not this script.',
  )

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
