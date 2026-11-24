import { describe, expect, it } from "vitest"

import { LEGAL_LAST_UPDATED_BY_PAGE } from "@/lib/legal/legalVersions"
import { arbitrationOptOutDeadline } from "@/lib/legal/termsUpdateNotice"
import { buildWashingtonTermsNotice } from "@/lib/legal/washingtonTermsNotice"

describe("the 2026-11 Washington terms-update notice", () => {
  const notice = buildWashingtonTermsNotice("https://allfantasy.ai/")

  it("states the Terms' effective date and the opt-out deadline derived from it", () => {
    const deadline = arbitrationOptOutDeadline(LEGAL_LAST_UPDATED_BY_PAGE.terms)
    expect(LEGAL_LAST_UPDATED_BY_PAGE.terms).toBe("November 21, 2026")
    expect(deadline).toBe("December 21, 2026")
    for (const body of [notice.html, notice.text]) {
      expect(body).toContain("November 21, 2026")
      expect(body).toContain(deadline)
      expect(body).toContain("Arbitration Opt-Out")
      expect(body).toContain("Washington")
      expect(body).toContain("Brown Pig LLC")
    }
  })

  it("names only the documents that changed — not Privacy, SMS or Copyright", () => {
    for (const body of [notice.html, notice.text]) {
      expect(body).not.toMatch(/Privacy Policy|SMS Terms|Copyright Policy/)
    }
  })

  it("links the live documents, with no doubled slash", () => {
    for (const path of ["/terms", "/disclaimer", "/terms#section-18"]) {
      expect(notice.html).toContain(`href="https://allfantasy.ai${path}"`)
    }
    expect(notice.html).not.toContain("ai//")
  })

  it("has its own subject, distinct from the October notice", () => {
    expect(notice.subject).toBe("An update to our Terms of Service")
  })
})
