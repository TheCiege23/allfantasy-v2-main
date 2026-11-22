// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { decodeNotification, parseLeagueSafeNotification } from "@/lib/leaguesafe/notification-parser"

const raw = (name: string) => readFileSync(`__tests__/fixtures/leaguesafe/${name}.eml`, "utf8")
const input = (name: string, messageId = "abcdef123") => ({ rawBody: raw(name), messageId, receivedAt: new Date("2026-02-01T12:00:00Z") })
const parse = (name: string, messageId?: string) => parseLeagueSafeNotification(input(name, messageId))

describe("public fixture provenance and redaction", () => {
  it.each(readdirSync("__tests__/fixtures/leaguesafe").filter(file => file.endsWith(".eml")))("keeps %s synthetic and matches its reviewed checksum", async file => {
    const bytes = readFileSync(`__tests__/fixtures/leaguesafe/${file}`)
    const checksum = createHash("sha256").update(bytes).digest("hex")
    expect(readFileSync("__tests__/fixtures/leaguesafe/README.md", "utf8")).toContain(`${checksum}  ${file}`)
    const PostalMime = (await import("postal-mime")).default
    const email = await PostalMime.parse(bytes)
    const text = email.headers.map(header => header.value).join("\n") + email.html
    for (const address of text.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9_.-]+\.[a-zA-Z]{2,}/g) ?? []) {
      expect(address.endsWith("@example.invalid") || address === "noreply@leaguesafe.com").toBe(true)
    }
    for (const url of email.html?.match(/https?:\/\/[^\s<>"']+/g) ?? []) {
      expect(url.startsWith("https://example.invalid/") || url === "https://www.leaguesafe.com/league/1234567").toBe(true)
    }
    expect(email.headers.some(header => ["dkim-signature", "received", "return-path"].includes(header.key))).toBe(false)
    expect(text).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)
    expect(email.attachments).toHaveLength(0)
  })
})

describe("verified, redacted LeagueSafe notification templates", () => {
  it.each([
    ["payment-received", "payment_received"], ["wallet-refund", "wallet_refund_processed"],
    ["wallet-refund-variant", "wallet_refund_processed"], ["league-refund", "league_refund_processed"],
    ["wallet-credit", "wallet_credit"], ["allocation-approved", "allocation_approved"],
    ["allocation-vote-request", "allocation_vote_requested"], ["payout-structure-update", "payout_structure_updated"],
  ])("decodes %s from MIME and selects %s", async (fixture, type) => {
    const result = await parse(fixture)
    expect(result?.details.type).toBe(type)
    expect(result?.source).toEqual({ gmailMessageId: "abcdef123", receivedAt: "2026-02-01T12:00:00.000Z", notificationSentAt: "2026-01-01T12:00:00.000Z" })
    expect(result?.occurredAt).toBeNull()
    expect(result?.currency).toBe("USD")
  })
  it("keeps unknown payer email and league id null; computes exact cents without using the recipient as payer", async () => {
    expect((await parse("payment-received"))?.details).toEqual({ type: "payment_received", league: { name: "Sample League", id: null },
      payerDisplayName: "Sample Payer", payerEmail: null, amountCents: 1250, leagueBalanceCents: 3750, ownersPaid: 3 })
  })
  it("extracts a refund transaction reference without inventing a league or treating wallet credit as external payment", async () => {
    expect((await parse("wallet-refund"))?.details).toEqual({ type: "wallet_refund_processed", league: null,
      amountCents: 825, transactionId: "REFUND-SAMPLE-A", confirmation: "CONF-SAMPLE-A", destination: "fanball_wallet" })
    expect((await parse("wallet-credit"))?.details).toMatchObject({ type: "wallet_credit", amountCents: 650, destination: "sportshub_account" })
    expect((await parse("league-refund"))?.details).toMatchObject({ type: "league_refund_processed", ownerDisplayText: "Sample Owner", amountCents: 325 })
  })
  it("reads allocation rows once, ignoring repeated Wins amounts and preserving proposal versus approval", async () => {
    for (const fixture of ["allocation-approved", "allocation-vote-request"]) {
      const result = (await parse(fixture))?.details
      expect(result && "allocations" in result && result.allocations).toHaveLength(11)
      if (result && "allocations" in result) {
        expect(result.allocations[0]).toEqual({ ownerDisplayName: "Sample Owner 1", winningsCents: 10000,
          additionalFeesCents: fixture === "allocation-approved" ? null : 0 })
        expect(result.allocations.reduce((sum, row) => sum + row.winningsCents, 0)).toBe(19900)
      }
      expect(JSON.stringify(result)).not.toContain("https:") // No voting tokens/links in output.
    }
  })
  it("uses observed league-link id but leaves empty prize table empty rather than inferring free-text distributions", async () => {
    expect((await parse("payout-structure-update"))?.details).toMatchObject({ type: "payout_structure_updated",
      league: { name: "Sample League", id: "1234567" }, prizes: [] })
  })
  it("preserves the timezone-free poll deadline as text without inventing a timestamp", async () => {
    expect((await parse("allocation-vote-request"))?.details).toMatchObject({
      voteExpiresText: "Thursday, April 9, 2026 at 11:43:22 AM",
    })
  })
  it("has stable, version-independent transaction keys across message ids only where a transaction id exists", async () => {
    const a = await parse("wallet-refund", "aa"), b = await parse("wallet-refund", "bb"), c = await parse("wallet-refund-variant", "cc")
    expect(a?.dedupeKey).toBe(b?.dedupeKey)
    expect(a?.dedupeScope).toBe("transaction")
    expect(a?.dedupeKey).not.toBe(c?.dedupeKey)
    expect((await parse("payment-received", "aa"))?.dedupeKey).not.toBe((await parse("payment-received", "bb"))?.dedupeKey)
    expect((await parse("payment-received", "aa"))?.dedupeScope).toBe("message")
    const duplicateRfc = { ...input("payment-received", "aa"), rawBody: raw("payment-received").replace(/Message-ID: .+/, "Message-ID: <forged@example.invalid>") }
    expect((await parseLeagueSafeNotification(duplicateRfc))?.dedupeKey).toBe((await parse("payment-received", "aa"))?.dedupeKey)
  })
})

async function edited(fixture: string, edit: (html: string) => string, subject?: string) {
  // Decode the REDACTED fixture; exercise the parser using different valid MIME encoding.
  const PostalMime = (await import("postal-mime")).default
  const decoded = await PostalMime.parse(raw(fixture))
  return parseLeagueSafeNotification({ ...input(fixture), rawBody:
    `Subject: ${subject ?? decoded.subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(edit(decoded.html!)).toString("base64")}` })
}

describe("conservative failure, MIME and content boundaries", () => {
  it("does not throw for unknown, unsupported plain-text, malformed or oversized messages", async () => {
    for (const rawBody of ["", "not MIME", "Subject: receipt\n\n$99.00", "Subject: x\n\n" + "a".repeat(2 * 1024 * 1024), "Subject: x\n\n\0"]) {
      await expect(parseLeagueSafeNotification({ ...input("payment-received"), rawBody })).resolves.toBeNull()
    }
  })
  it("requires matching subject and repeated body values; rejects overflow and invalid fractional cents", async () => {
    expect(await edited("payment-received", html => html, "Different notification")).toBeNull()
    expect(await edited("payment-received", html => html.replace("$12.50", "$12.51"))).toBeNull()
    expect(await edited("payment-received", html => html.replaceAll("$12.50", "$12.505"))).toBeNull()
    expect(await edited("payment-received", html => html.replaceAll("$12.50", "$99999999999.00"), "Sample Payer made a $99999999999.00 payment to Sample League")).toBeNull()
  })
  it("ignores hidden/script text and does not fetch or execute remote HTML", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"))
    try {
      const result = await edited("payment-received", html => html.replace("<body", '<script>throw new Error("do not execute")</script><div hidden>Who: Evil Amount: $1.00</div><img src="https://example.invalid/private"><body'))
      expect(result?.details.type).toBe("payment_received")
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })
  it("does not parse an attached original as the outer notification", async () => {
    const rawBody = `Subject: Sample transfer\nContent-Type: multipart/mixed; boundary=sample\n\n--sample\nContent-Type: text/plain\n\nPlease inspect only.\n--sample\nContent-Type: message/rfc822\nContent-Disposition: attachment; filename=sample.eml\n\n${raw("payment-received")}\n--sample--`
    expect(await parseLeagueSafeNotification({ ...input("payment-received"), rawBody })).toBeNull()
  })
  it("rejects ambiguous tables, incomplete rows and unexpected fees", async () => {
    expect(await edited("allocation-approved", html => html.replaceAll("Sample Owner 1", ""))).toBeNull()
    expect(await edited("allocation-vote-request", html => html.replaceAll("$0.00", "$1.00"))).toBeNull()
  })
  it("limits nested MIME and duplicate subject headers", async () => {
    const rawBody = Array.from({ length: 20 }, (_, i) => `Content-Type: multipart/mixed; boundary=b${i}\n\n--b${i}\n`).join("") + raw("payment-received")
    expect(await decodeNotification(rawBody)).toBeNull()
    expect(await decodeNotification("Subject: duplicate\n" + raw("payment-received"))).toBeNull()
  })
  it("enforces MIME breadth and header limits even when a valid payment body is present", async () => {
    const PostalMime = (await import("postal-mime")).default
    const decoded = await PostalMime.parse(raw("payment-received"))
    const manyParts = `Subject: ${decoded.subject}\nContent-Type: multipart/mixed; boundary=parts\n\n--parts\nContent-Type: text/html\n\n${decoded.html}\n` +
      Array.from({ length: 101 }, () => "--parts\nContent-Type: text/plain\nContent-Disposition: attachment\n\nignored\n").join("") + "--parts--"
    expect(await decodeNotification(manyParts)).toBeNull()
    expect(await decodeNotification("X-Oversized: " + "x".repeat(64 * 1024) + "\n" + raw("payment-received"))).toBeNull()
  })
  it("does not invent a zone for missing, ambiguous or timezone-free notification dates", async () => {
    const withoutZone = raw("payment-received").replace("Thu, 01 Jan 2026 12:00:00 +0000", "Thu, 01 Jan 2026 12:00:00")
    expect((await decodeNotification(withoutZone))?.notificationSentAt).toBeNull()
    expect((await decodeNotification("Date: Thu, 01 Jan 2026 13:00:00 +0000\n" + raw("payment-received")))?.notificationSentAt).toBeNull()
  })
})
