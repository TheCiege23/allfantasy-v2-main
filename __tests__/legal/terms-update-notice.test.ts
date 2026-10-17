import { describe, expect, it } from "vitest"

import { arbitrationOptOutDeadline, buildTermsUpdateNotice } from "@/lib/legal/termsUpdateNotice"
import { LEGAL_LAST_UPDATED_BY_PAGE } from "@/lib/legal/legalVersions"

describe("the 2026-10 terms-update notice", () => {
  it("gives existing users the 30-day arbitration opt-out window Terms 18.9 promises", () => {
    expect(arbitrationOptOutDeadline("October 6, 2026")).toBe("November 5, 2026")
    expect(() => arbitrationOptOutDeadline("not a date")).toThrow()
  })

  it("states the effective date the documents print, and the deadline derived from it", () => {
    const { html, text } = buildTermsUpdateNotice("https://allfantasy.ai/")
    const deadline = arbitrationOptOutDeadline(LEGAL_LAST_UPDATED_BY_PAGE.terms)
    for (const body of [html, text]) {
      expect(body).toContain(LEGAL_LAST_UPDATED_BY_PAGE.terms)
      expect(body).toContain(deadline)
      expect(body).toContain("Arbitration Opt-Out")
    }
  })

  it("links every document at its live address, with no doubled slash", () => {
    const { html } = buildTermsUpdateNotice("https://allfantasy.ai/")
    for (const path of ["/terms", "/privacy", "/sms-terms", "/copyright", "/disclaimer", "/privacy/choices", "/terms#section-18"]) {
      expect(html).toContain(`href="https://allfantasy.ai${path}"`)
    }
    expect(html).not.toContain("ai//")
  })
})
