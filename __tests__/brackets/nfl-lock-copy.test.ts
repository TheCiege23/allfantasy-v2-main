import { describe, expect, it } from "vitest"
import { bracketExperienceCopy } from "@/lib/brackets/bracketExperienceCopy"
import { assertBracketOpen, firstGameDeadline } from "@/lib/playoffs/playoffCompetition"

/**
 * The hub's lock tile said NFL picks lock at "each game's kickoff". They do not: the whole bracket
 * locks at the first Wild Card kickoff, because later rounds have no times until the round before
 * ends. These pin the rule and the words to each other.
 */

const wildCard = (startsAt: string) => ({ round: "nfl_wild_card", startsAt })
const later = (round: string) => ({ round, startsAt: null })

describe("NFL bracket lock", () => {
  const series = [
    wildCard("2027-01-09T21:30:00Z"),
    wildCard("2027-01-10T01:00:00Z"),
    later("nfl_divisional"),
    later("nfl_conference"),
    later("nfl_super_bowl"),
  ]

  it("locks every pick at the earliest Wild Card kickoff, even with later rounds unscheduled", () => {
    expect(firstGameDeadline(series)).toBe(Date.parse("2027-01-09T21:30:00Z"))
    expect(() => assertBracketOpen(series, Date.parse("2027-01-09T21:30:00Z"))).toThrow(/locked/)
  })

  it("says so in both languages, and never promises a per-game lock", () => {
    for (const lang of ["en", "es"]) {
      const copy = bracketExperienceCopy(lang)
      expect(copy.nflLock).toMatch(/Wild Card|comodines/)
      expect(`${copy.nflLock} ${copy.nflLockNote}`).not.toMatch(/each game|cada partido/i)
    }
  })
})
