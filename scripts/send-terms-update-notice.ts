/**
 * One-time: email every existing account holder about the 2026-10 legal documents.
 *
 * Owner-approved 2026-10-06. Run it only AFTER the documents are live in production — every link
 * in the email opens them. The email itself is lib/legal/termsUpdateNotice.ts.
 *
 *   npx tsx scripts/send-terms-update-notice.ts --preview=notice.html     # write the email to a file; no DB, no send
 *   npx tsx scripts/send-terms-update-notice.ts --to=you@example.com      # send ONE test copy; no DB
 *   npx tsx scripts/send-terms-update-notice.ts                           # dry run: count recipients, send nothing
 *   npx tsx scripts/send-terms-update-notice.ts --apply --production      # send to everyone
 *
 * Recipients: accounts with a VERIFIED email that is not an anonymized deleted account and not on a
 * known-undeliverable domain (lib/email/undeliverableDomains). Pass --include-unverified to add
 * unverified addresses too; that raises the bounce rate, which Resend counts against the domain.
 *
 * RESUMABLE. Every sent account id is appended to --progress (default
 * .terms-notice-2026-10.progress.jsonl in the current directory) and skipped on the next run, so a
 * run stopped half-way is finished by running it again. Each batch also carries a Resend
 * idempotency key, so a batch retried within 24 hours is not delivered twice.
 *
 * Needs RESEND_API_KEY and RESEND_FROM (or RESEND_FROM_EMAIL), plus DATABASE_URL except for
 * --preview and --to. Prints counts and account ids only, never an email address.
 */
import fs from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Resend } from "resend"

import { describeDbTarget, isProductionDbTarget } from "./_db-target-identity"
import { isUndeliverableEmailDomain } from "../lib/email/undeliverableDomains"
import { buildTermsUpdateNotice } from "../lib/legal/termsUpdateNotice"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const BATCH_SIZE = 100
const PAUSE_MS = 700 // Resend's default limit is 2 requests per second.
const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://allfantasy.ai").replace(/\/$/, "")

function resend(): { client: Resend; from: string } {
  const key = process.env.RESEND_API_KEY?.trim()
  const from = (process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL || "").trim()
  if (!key || !from) {
    console.error("RESEND_API_KEY and RESEND_FROM (or RESEND_FROM_EMAIL) must be set.")
    process.exit(2)
  }
  return { client: new Resend(key), from }
}

async function main() {
  const notice = buildTermsUpdateNotice(BASE_URL)

  const preview = option("preview")
  if (preview) {
    fs.writeFileSync(preview, notice.html, "utf8")
    console.log(`Wrote the email to ${preview}. Subject: ${notice.subject}`)
    return
  }

  const testTo = option("to")
  if (testTo) {
    const { client, from } = resend()
    const { error } = await client.emails.send({ from, to: testTo, subject: notice.subject, html: notice.html, text: notice.text })
    console.log(error ? `Test send failed: ${error.name}` : "Test copy sent.")
    process.exit(error ? 1 : 0)
  }

  const apply = flag("apply")
  const url = process.env.DATABASE_URL
  console.log(`[send-terms-update-notice] target: ${describeDbTarget(url)}`)
  if (apply && isProductionDbTarget(url) && !flag("production")) {
    console.error("Refusing to email production users without --production.")
    process.exit(2)
  }

  const progressFile = option("progress") ?? ".terms-notice-2026-10.progress.jsonl"
  const done = new Set<string>(
    fs.existsSync(progressFile)
      ? fs.readFileSync(progressFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id as string)
      : [],
  )

  const prisma = new PrismaClient()
  try {
    const users = await prisma.appUser.findMany({
      where: {
        email: { not: { startsWith: "deleted+" } },
        ...(flag("include-unverified") ? {} : { emailVerified: { not: null } }),
      },
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
    })
    const recipients = users.filter(
      (u) => u.email && u.email.includes("@") && !isUndeliverableEmailDomain(u.email) && !done.has(u.id),
    )
    console.log(
      `${users.length} candidate account(s); ${done.size} already sent; ${recipients.length} to send` +
        `${flag("include-unverified") ? " (including unverified addresses)" : " (verified addresses only)"}.`,
    )
    if (!apply) {
      console.log("Dry run — nothing sent. Re-run with --apply (and --production for production).")
      return
    }

    const { client, from } = resend()
    let sent = 0
    let failed = 0
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE)
      const { error } = await client.batch.send(
        batch.map((u) => ({ from, to: u.email!, subject: notice.subject, html: notice.html, text: notice.text })),
        { idempotencyKey: `terms-2026-10:${batch[0].id}:${batch.length}` },
      )
      if (error) {
        failed += batch.length
        console.error(`Batch ${i / BATCH_SIZE + 1} failed: ${error.name}. Its accounts stay unsent; re-run to retry.`)
      } else {
        sent += batch.length
        fs.appendFileSync(progressFile, batch.map((u) => JSON.stringify({ id: u.id })).join("\n") + "\n")
        console.log(`Batch ${i / BATCH_SIZE + 1}: sent ${batch.length} (total ${sent}).`)
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS))
    }
    console.log(`Done. Sent ${sent}, failed ${failed}.${failed ? " Re-run to retry the failures." : ""}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
