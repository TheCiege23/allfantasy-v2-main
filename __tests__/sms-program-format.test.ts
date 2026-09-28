import { describe, expect, it } from "vitest"
import { formatProgramSms, SMS_OPT_OUT_LINE } from "@/lib/legal/smsProgram"

/**
 * Every raw SMS must name its sender and say how to stop (carrier rule, and the A2P
 * campaign's sample messages must match real traffic). formatProgramSms is applied in
 * sendSms, the single exit; these pin what reaches Twilio for each real caller's shape.
 */
describe("formatProgramSms", () => {
  it("names the brand and adds the opt-out line to an unbranded notification", () => {
    expect(formatProgramSms("You were mentioned in World Cup Pool: Office Pool.")).toBe(
      `AllFantasy: You were mentioned in World Cup Pool: Office Pool.\n${SMS_OPT_OUT_LINE}`,
    )
  })

  it("keeps a multi-line title + body intact", () => {
    expect(formatProgramSms("Draft starts in 1 hour\nYour Sunday league drafts at 8 PM ET.")).toBe(
      `AllFantasy: Draft starts in 1 hour\nYour Sunday league drafts at 8 PM ET.\n${SMS_OPT_OUT_LINE}`,
    )
  })

  it("does not repeat the brand when the body already names it", () => {
    expect(formatProgramSms("AllFantasy test notification: trades SMS is configured.")).toBe(
      `AllFantasy test notification: trades SMS is configured.\n${SMS_OPT_OUT_LINE}`,
    )
  })

  it("is idempotent — formatting twice changes nothing", () => {
    const once = formatProgramSms("Your league settings were updated.")
    expect(formatProgramSms(once)).toBe(once)
  })

  it("does not add a second opt-out line", () => {
    const body = "AllFantasy alert: waivers ran. Reply STOP to opt out."
    expect(formatProgramSms(body)).toBe(body)
  })
})
