import { describe, it, expect } from "vitest"
import {
  slugifyName,
  isReservedUsername,
  generateUniqueUsername,
  RESERVED_USERNAMES,
} from "@/lib/signup/AutoUsernameGenerator"
import { validateUsername } from "@/lib/auth/username-validation"
import { containsProfanity } from "@/lib/profanity"

/** A deterministic, monotonically increasing digit source for predictable suffixes. */
function seqDigits() {
  let n = 0
  return (len: number) => String(++n).padStart(len, "0")
}

/** isTaken backed by a case-insensitive set. */
function takenSet(...names: string[]) {
  const set = new Set(names.map((s) => s.toLowerCase()))
  return (candidate: string) => set.has(candidate.toLowerCase())
}

/** Asserts a generated username satisfies every storage/display invariant. */
function expectValidUsername(username: string) {
  const validation = validateUsername(username)
  expect(validation.ok, `validateUsername failed for "${username}"`).toBe(true)
  expect(/^[A-Za-z0-9_]{3,30}$/.test(username)).toBe(true)
  expect(isReservedUsername(username)).toBe(false)
  expect(containsProfanity(username)).toBe(false)
}

describe("slugifyName — sanitization", () => {
  it("lowercases and underscores punctuation/whitespace", () => {
    expect(slugifyName("Jordan Rivera")).toBe("jordan_rivera")
    expect(slugifyName("Jordan Rivera!!")).toBe("jordan_rivera")
    expect(slugifyName("  Multiple   Spaces  ")).toBe("multiple_spaces")
    expect(slugifyName("O'Brien-Smith")).toBe("o_brien_smith")
  })

  it("folds Unicode diacritics to ASCII (NFKD)", () => {
    expect(slugifyName("José Ávila")).toBe("jose_avila")
    expect(slugifyName("Müller")).toBe("muller")
    expect(slugifyName("Renée")).toBe("renee")
  })

  it("yields an empty stem for scripts with no ASCII fold", () => {
    expect(slugifyName("李伟")).toBe("")
    expect(slugifyName("Владимир")).toBe("")
    expect(slugifyName("")).toBe("")
    expect(slugifyName(null)).toBe("")
    expect(slugifyName(undefined)).toBe("")
    expect(slugifyName("   ")).toBe("")
  })

  it("caps the stem length (leaving room for a suffix)", () => {
    const long = "a".repeat(80)
    expect(slugifyName(long).length).toBeLessThanOrEqual(23)
  })
})

describe("generateUniqueUsername — happy path", () => {
  it("returns the bare name slug when available", async () => {
    const username = await generateUniqueUsername({
      name: "Jordan Rivera",
      isTaken: () => false,
    })
    expect(username).toBe("jordan_rivera")
    expectValidUsername(username)
  })

  it("preserves a short (1–2 char) stem by suffixing instead of falling back", async () => {
    const username = await generateUniqueUsername({
      name: "Jo",
      isTaken: () => false,
      randomDigits: seqDigits(),
    })
    expect(username.startsWith("jo_")).toBe(true)
    expectValidUsername(username)
  })
})

describe("generateUniqueUsername — duplicate collisions", () => {
  it("adds a collision-safe suffix when the bare slug is taken", async () => {
    const username = await generateUniqueUsername({
      name: "Jordan Rivera",
      isTaken: takenSet("jordan_rivera"),
      randomDigits: seqDigits(),
    })
    expect(username).not.toBe("jordan_rivera")
    expect(username.startsWith("jordan_rivera_")).toBe(true)
    expectValidUsername(username)
  })

  it("keeps widening past several taken suffixes", async () => {
    const username = await generateUniqueUsername({
      name: "Jordan Rivera",
      isTaken: takenSet(
        "jordan_rivera",
        "jordan_rivera_001",
        "jordan_rivera_002",
        "jordan_rivera_003"
      ),
      randomDigits: seqDigits(),
    })
    expect(username).toBe("jordan_rivera_004")
    expectValidUsername(username)
  })

  it("throws when no unique candidate is available within the attempt budget", async () => {
    await expect(
      generateUniqueUsername({
        name: "Jordan Rivera",
        isTaken: () => true, // everything is taken
        randomDigits: seqDigits(),
        maxAttempts: 5,
      })
    ).rejects.toThrow(/unique username/i)
  })
})

describe("generateUniqueUsername — missing names", () => {
  it.each(["", "   ", null, undefined])("falls back to the themed base for %p", async (name) => {
    const username = await generateUniqueUsername({
      name: name as string | null | undefined,
      isTaken: () => false,
      randomDigits: seqDigits(),
    })
    expect(username.startsWith("manager_")).toBe(true)
    expectValidUsername(username)
  })
})

describe("generateUniqueUsername — Unicode names", () => {
  it("uses the folded slug for accented Latin names", async () => {
    const username = await generateUniqueUsername({
      name: "José Ávila",
      isTaken: () => false,
    })
    expect(username).toBe("jose_avila")
    expectValidUsername(username)
  })

  it("falls back to the themed base for non-Latin scripts", async () => {
    const username = await generateUniqueUsername({
      name: "李伟",
      isTaken: () => false,
      randomDigits: seqDigits(),
    })
    expect(username.startsWith("manager_")).toBe(true)
    expectValidUsername(username)
  })
})

describe("generateUniqueUsername — reserved and profane stems", () => {
  it("never hands out a reserved handle, even suffixed", async () => {
    const username = await generateUniqueUsername({
      name: "Admin",
      isTaken: () => false,
      randomDigits: seqDigits(),
    })
    expect(username).not.toBe("admin")
    expect(username.startsWith("admin")).toBe(false)
    expect(username.startsWith("manager_")).toBe(true)
    expectValidUsername(username)
  })

  it("does not build on a profane stem", async () => {
    const username = await generateUniqueUsername({
      name: "Shithead",
      isTaken: () => false,
      randomDigits: seqDigits(),
    })
    expect(containsProfanity(username)).toBe(false)
    expect(username.startsWith("manager_")).toBe(true)
    expectValidUsername(username)
  })

  it("covers a representative set of reserved words", () => {
    for (const reserved of ["admin", "support", "allfantasy", "commissioner", "api"]) {
      expect(RESERVED_USERNAMES.has(reserved)).toBe(true)
      expect(isReservedUsername(reserved.toUpperCase())).toBe(true)
    }
  })

  it("never emits a phone-number-like stem", async () => {
    const username = await generateUniqueUsername({
      name: "1234567",
      isTaken: () => false,
      randomDigits: seqDigits(),
    })
    expect(/\d{7,}/.test(username)).toBe(false)
    expect(username.startsWith("manager_")).toBe(true)
    expectValidUsername(username)
  })
})

describe("generateUniqueUsername — concurrent registration attempts", () => {
  it("resolves to a fresh handle when early candidates are grabbed mid-flight", async () => {
    // Model a race: the first 5 candidates the generator probes come back as
    // "taken" (claimed by concurrent signups), the rest are free.
    let probes = 0
    const isTaken = () => ++probes <= 5
    const username = await generateUniqueUsername({
      name: "Jordan Rivera",
      isTaken,
      randomDigits: seqDigits(),
    })
    expect(probes).toBeGreaterThan(5)
    expectValidUsername(username)
  })

  it("produces distinct handles for many simultaneous same-name signups", async () => {
    // Atomic check-and-reserve models the DB's unique index: the first probe of a
    // free candidate claims it synchronously, so two concurrently-generating
    // signups can never be handed the same handle.
    const claimed = new Set<string>()
    const isTaken = (candidate: string) => {
      const key = candidate.toLowerCase()
      if (claimed.has(key)) return true
      claimed.add(key)
      return false
    }

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        generateUniqueUsername({ name: "Jordan Rivera", isTaken, randomDigits: seqDigits() })
      )
    )

    const unique = new Set(results.map((u) => u.toLowerCase()))
    expect(unique.size).toBe(results.length)
    for (const username of results) expectValidUsername(username)
  })
})
