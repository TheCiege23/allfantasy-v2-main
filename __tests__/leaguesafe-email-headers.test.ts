// @vitest-environment node
import { describe, expect, it } from "vitest"
import { inspectLeagueSafeHeaders } from "@/lib/leaguesafe/email-headers"

// Synthetic RFC headers only. These are NOT proposed LeagueSafe email templates.
const domain = "notices.example"
function email(auth = "mx.google.com; dkim=pass header.i=@notices.example; spf=pass; dmarc=pass", extra = "") {
  return [
    'From: "Capture fixture" <alerts@notices.example>',
    "To: allfantasysportsapp+fixture@gmail.com",
    "Subject: Synthetic capture fixture",
    "Message-ID: <synthetic@example.invalid>",
    ...(auth ? ["Authentication-Results: " + auth] : []),
    ...(extra ? [extra] : []),
    "", "Unknown body; no payment/league/amount fields are assumed.",
  ].join("\r\n")
}
const inspect = (raw: string) => inspectLeagueSafeHeaders(raw, [domain])

describe("LeagueSafe generic envelope headers", () => {
  it("retains metadata and SPF/DKIM/DMARC from Gmail", () => {
    expect(inspect(email())).toMatchObject({
      from: '"Capture fixture" <alerts@notices.example>',
      to: "allfantasysportsapp+fixture@gmail.com",
      rfcMessageId: "<synthetic@example.invalid>", rejectionReason: null,
      authResults: { spf: "pass", dkim: "pass", dmarc: "pass", dkimDomains: [domain] },
    })
  })
  it("supports folded authentication headers and explicit signing domains", () => {
    expect(inspect(email("mx.google.com;\r\n\tdkim=pass header.d=notices.example;\r\n spf=softfail")).rejectionReason).toBeNull()
  })
  it("supports LF headers and mixed-case names/results", () => {
    expect(inspect(email("MX.GOOGLE.COM; DKIM=PASS header.i=@NOTICES.EXAMPLE").replaceAll("\r\n", "\n")).rejectionReason).toBeNull()
  })
  it.each([
    "", "mx.google.com; spf=pass; dmarc=pass",
    "mx.google.com; dkim=fail header.i=@notices.example",
    "mx.google.com; dkim=pass header.i=@shared-relay.example",
    "mx.google.com; dkim=pass header.i=@notices.example.evil.invalid",
    "mx.google.com; dkim=pass header.i=@sub.notices.example",
    "mx.google.com; dkim=pass",
    "attacker.invalid; dkim=pass header.i=@notices.example",
    'mx.google.com; dkim=fail reason="; dkim=pass header.i=@notices.example"',
    "mx.google.com; dkim=fail (dkim=pass header.i=@notices.example)",
    'mx.google.com; dkim=pass reason="header.i=@notices.example" header.i=@evil.invalid',
    "mx.google.com; dkim=fail header.i=@notices.example; arc=pass header.i=@notices.example",
  ])("rejects absent, failed, unrelated, or spoofed DKIM: %s", (auth) => {
    expect(inspect(email(auth)).rejectionReason).not.toBeNull()
  })
  it("does not accept a later injected passing Authentication-Results", () => {
    const raw = email("mx.google.com; dkim=fail header.i=@notices.example",
      "Authentication-Results: mx.google.com; dkim=pass header.i=@notices.example")
    expect(inspect(raw).rejectionReason).toBe("leaguesafe_dkim_did_not_pass")
    expect(inspect(raw).authResults.headers).toHaveLength(2)
  })
  it("does not skip an untrusted first authentication service", () => {
    const raw = email("untrusted.invalid; dkim=fail",
      "Authentication-Results: mx.google.com; dkim=pass header.i=@notices.example")
    expect(inspect(raw).rejectionReason).toBe("missing_trusted_gmail_authentication")
  })
  it("accepts an allowed signature alongside an unrelated signature", () => {
    expect(inspect(email("mx.google.com; dkim=pass header.i=@relay.example; dkim=pass header.d=notices.example")).rejectionReason).toBeNull()
  })
  it("requires the From domain to be explicitly allowed too", () => {
    expect(inspect(email().replace("alerts@notices.example", "alerts@evil.invalid")).rejectionReason).toBe("sender_domain_not_allowed")
  })
  it("rejects multiple From mailboxes and duplicate From headers", () => {
    expect(inspect(email().replace('"Capture fixture" <alerts@notices.example>', "a@notices.example, b@notices.example")).rejectionReason).not.toBeNull()
    expect(inspect(email(undefined, "From: alerts@notices.example")).rejectionReason).toBe("malformed_headers")
  })
  it("records malformed messages for rejected capture without throwing", () => {
    expect(inspect("not an RFC message").rejectionReason).toBe("malformed_headers")
    expect(inspect(email().replace("Subject:", "Invalid header")) .rejectionReason).toBe("malformed_headers")
  })
  it("ignores Authentication-Results text in a body", () => {
    expect(inspect(email("") + "\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@notices.example").rejectionReason).not.toBeNull()
  })
  it("does not require a sender-supplied Message-ID", () => {
    expect(inspect(email().replace("Message-ID: <synthetic@example.invalid>\r\n", ""))).toMatchObject({
      rejectionReason: null, rfcMessageId: null,
    })
  })
})
