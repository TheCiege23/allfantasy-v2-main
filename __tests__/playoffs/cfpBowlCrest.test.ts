import { describe, expect, it } from "vitest"
import { cfpBowlCrestKey } from "@/lib/playoffs/cfpBowlCrest"

describe("cfpBowlCrestKey", () => {
  it("maps each CFP bowl label to its crest", () => {
    expect(cfpBowlCrestKey("Rose Bowl")).toBe("rose")
    expect(cfpBowlCrestKey("Cotton Bowl Classic")).toBe("cotton")
    expect(cfpBowlCrestKey("Fiesta Bowl")).toBe("fiesta")
    expect(cfpBowlCrestKey("Peach Bowl")).toBe("peach")
    expect(cfpBowlCrestKey("Orange Bowl")).toBe("orange")
    expect(cfpBowlCrestKey("Sugar Bowl")).toBe("sugar")
  })

  it("gives the title game the championship crest", () => {
    expect(cfpBowlCrestKey("CFP National Championship")).toBe("title")
    expect(cfpBowlCrestKey("National Championship")).toBe("title")
  })

  it("returns null when no bowl is named", () => {
    expect(cfpBowlCrestKey(undefined)).toBeNull()
    expect(cfpBowlCrestKey("")).toBeNull()
    expect(cfpBowlCrestKey("CFP Quarterfinal")).toBeNull()
    expect(cfpBowlCrestKey("CFP First Round")).toBeNull()
    expect(cfpBowlCrestKey("Bowl TBA")).toBeNull()
  })
})
