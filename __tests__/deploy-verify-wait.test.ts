// @vitest-environment node
/**
 * The wait half of scripts/verify-deployed-redirects.mjs.
 *
 * Why this file exists. On 2026-09-24 every push-triggered deploy-verify run ended
 * NOT_DEPLOYED: the budget was 15 minutes and Railway builds took 16–21, so the probes never
 * ran against a single deploy. Two more ways it could not have worked were found reading it:
 *
 *   - it waited for the EXACT pushed sha, but Railway builds commits concurrently and
 *     production routinely jumps straight past one (96a60e43b and aa2a59729 were never served;
 *     e5f038706, which contains both, was) — so an exact wait can never end;
 *   - "does the served commit contain the pushed one?" has THREE answers, and "could not
 *     tell" must never be read as yes (probing a build without the change is the 2026-09-02
 *     lie) or as no (a false NOT_DEPLOYED).
 */

import { execFileSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_WAIT_MINUTES,
  classifyServed,
  parseWaitMinutes,
  sameCommit,
  servedContains,
  waitForSha,
} from "../scripts/deploy-verify-wait.mjs"

const PUSHED = "3c83857ea0fe8b58c709361fd619b5efe71c418b"
const OLDER = "5a9cdd17769c209cb28f45c301cf37e024058882"
const NEWER = "e5f0387068c07bcee4f2e89002eb509cb67eb85a"
const MIN = 60_000

/**
 * A fake clock and a script of what production serves at each minute mark. `sleep` advances
 * the clock, so a 40-minute wait runs instantly and the loop's own arithmetic is what is tested.
 */
function harness(timeline: Array<[number, string | null | Error]>, contains: (e: string, s: string) => Promise<boolean | null>) {
  let t = 0
  const readServedSha = vi.fn(async () => {
    let current: string | null | Error = null
    for (const [atMin, value] of timeline) if (t >= atMin * MIN) current = value
    if (current instanceof Error) throw current
    return current
  })
  const containsSpy = vi.fn(contains)
  return {
    readServedSha,
    containsSpy,
    opts: (budgetMinutes: number) => ({
      budgetMs: budgetMinutes * MIN,
      pollMs: 30_000,
      readServedSha,
      contains: containsSpy,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms
      },
      log: () => {},
    }),
  }
}

/** Contains-oracle for the three commits above: NEWER ⊇ PUSHED ⊇ OLDER. */
async function linearHistory(expected: string, served: string): Promise<boolean | null> {
  if (served === NEWER) return true
  if (served === OLDER) return false
  return null
}

describe("the budget", () => {
  it("defaults to 40 minutes", () => {
    expect(DEFAULT_WAIT_MINUTES).toBe(40)
    expect(parseWaitMinutes([], {})).toBe(40)
  })

  it("reads VERIFY_WAIT_MINUTES, and a flag overrides it", () => {
    expect(parseWaitMinutes([], { VERIFY_WAIT_MINUTES: "25" })).toBe(25)
    expect(parseWaitMinutes(["--wait-minutes=30"], { VERIFY_WAIT_MINUTES: "25" })).toBe(30)
  })

  it("ignores a value that would make the wait instant or absurd, rather than trusting a typo", () => {
    for (const bad of ["0", "-5", "abc", "500", " "]) {
      expect(parseWaitMinutes([], { VERIFY_WAIT_MINUTES: bad }), bad).toBe(40)
    }
  })

  it("verifies a build that lands at 21 minutes — the 2026-09-24 case the 15-minute budget failed", async () => {
    const h = harness([[0, OLDER], [21, PUSHED]], linearHistory)
    expect((await waitForSha(PUSHED, h.opts(15))).deployed).toBe(false)
    const h2 = harness([[0, OLDER], [21, PUSHED]], linearHistory)
    const r = await waitForSha(PUSHED, h2.opts(DEFAULT_WAIT_MINUTES))
    expect(r).toMatchObject({ deployed: true, via: "exact", sha: PUSHED })
    expect(r.waitedMs).toBe(21 * MIN)
  })
})

describe("what counts as deployed", () => {
  it("accepts the pushed commit itself", async () => {
    const h = harness([[0, PUSHED]], linearHistory)
    expect(await waitForSha(PUSHED, h.opts(40))).toMatchObject({ deployed: true, via: "exact" })
    expect(h.containsSpy).not.toHaveBeenCalled()
  })

  it("accepts a DESCENDANT — production skipped straight past the pushed commit", async () => {
    const h = harness([[0, OLDER], [18, NEWER]], linearHistory)
    const r = await waitForSha(PUSHED, h.opts(40))
    expect(r).toMatchObject({ deployed: true, via: "descendant", sha: NEWER })
  })

  it("does NOT accept an older build, however long it is served", async () => {
    const h = harness([[0, OLDER]], linearHistory)
    const r = await waitForSha(PUSHED, h.opts(40))
    expect(r).toMatchObject({ deployed: false, relation: "not-yet", sha: OLDER })
  })

  it("does NOT accept 'could not tell' as deployed — that would probe a build that may lack the change", async () => {
    const h = harness([[0, NEWER]], async () => null)
    const r = await waitForSha(PUSHED, h.opts(40))
    expect(r).toMatchObject({ deployed: false, relation: "undetermined" })
  })

  it("keeps waiting through a container that does not answer, then accepts the build", async () => {
    const h = harness([[0, new Error("ECONNRESET")], [3, null], [6, PUSHED]], linearHistory)
    expect(await waitForSha(PUSHED, h.opts(40))).toMatchObject({ deployed: true, via: "exact" })
  })

  it("matches an abbreviated sha either way round", () => {
    expect(sameCommit(PUSHED, "3c83857ea")).toBe(true)
    expect(sameCommit("3C83857EA", PUSHED)).toBe(true)
    expect(sameCommit(PUSHED, "3c83857")).toBe(true)
    expect(sameCommit(PUSHED, "3c8385")).toBe(false) // too short to mean anything
    expect(sameCommit(PUSHED, OLDER)).toBe(false)
  })

  it("classifies every reading", () => {
    expect(classifyServed(PUSHED, PUSHED, null)).toBe("deployed")
    expect(classifyServed(PUSHED, NEWER, true)).toBe("descendant")
    expect(classifyServed(PUSHED, OLDER, false)).toBe("not-yet")
    expect(classifyServed(PUSHED, NEWER, null)).toBe("undetermined")
    expect(classifyServed(PUSHED, null, null)).toBe("unreadable")
  })
})

describe("it asks GitHub sparingly", () => {
  it("asks once about a build it has a definite answer for, however many polls it is served", async () => {
    const h = harness([[0, OLDER]], linearHistory)
    await waitForSha(PUSHED, h.opts(40))
    expect(h.readServedSha.mock.calls.length).toBeGreaterThan(70)
    expect(h.containsSpy).toHaveBeenCalledTimes(1)
  })

  it("asks again after 'could not tell' — a transient API failure must not stick for the whole wait", async () => {
    let calls = 0
    const h = harness([[0, NEWER]], async () => (++calls < 4 ? null : true))
    const r = await waitForSha(PUSHED, h.opts(40))
    expect(r).toMatchObject({ deployed: true, via: "descendant" })
    expect(calls).toBe(4)
  })

  it("stops at the budget rather than waiting forever", async () => {
    const h = harness([[0, OLDER]], linearHistory)
    const r = await waitForSha(PUSHED, h.opts(40))
    expect(r.waitedMs).toBe(40 * MIN)
    expect(h.readServedSha).toHaveBeenCalledTimes(80) // one poll per 30s
  })
})

describe("servedContains", () => {
  function api(status: number, body: unknown) {
    return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
  }
  const noGit = vi.fn(() => null)

  it("asks base=pushed...head=served — the order is what makes 'ahead' mean 'contains'", async () => {
    const fetchImpl = api(200, { status: "ahead" })
    await servedContains(PUSHED, NEWER, { repo: "o/r", fetchImpl, gitAncestor: noGit })
    expect(fetchImpl.mock.calls[0][0]).toContain(`/repos/o/r/compare/${PUSHED}...${NEWER}`)
  })

  it.each([
    ["ahead", true],
    ["identical", true],
    ["behind", false],
    ["diverged", false],
  ])("reads compare status %s as %s", async (status, expected) => {
    expect(await servedContains(PUSHED, NEWER, { fetchImpl: api(200, { status }), gitAncestor: noGit })).toBe(expected)
  })

  it("falls back to local git when the API fails, and returns ITS answer", async () => {
    const git = vi.fn(() => true)
    expect(await servedContains(PUSHED, NEWER, { fetchImpl: api(404, { message: "Not Found" }), gitAncestor: git })).toBe(true)
    expect(git).toHaveBeenCalledWith(PUSHED, NEWER)
  })

  it("returns null — not false — when neither can tell", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("network down")
    })
    expect(await servedContains(PUSHED, NEWER, { fetchImpl: throwing, gitAncestor: noGit })).toBeNull()
  })

  it("sends the token when it has one, and no auth header when it does not", async () => {
    const withToken = api(200, { status: "ahead" })
    await servedContains(PUSHED, NEWER, { token: "t0ken", fetchImpl: withToken, gitAncestor: noGit })
    expect((withToken.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe("Bearer t0ken")
    const without = api(200, { status: "ahead" })
    await servedContains(PUSHED, NEWER, { token: undefined, fetchImpl: without, gitAncestor: noGit })
    expect((without.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBeUndefined()
  })

  /*
   * The real git fallback, against commits that exist in any checkout this suite runs in:
   * CI's unit tests check out two commits deep, so HEAD and HEAD~1 are both present.
   */
  const head = (() => {
    try {
      return {
        tip: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        parent: execFileSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" }).trim(),
      }
    } catch {
      return null
    }
  })()
  const apiDown = vi.fn(async () => new Response("", { status: 503 }))

  it.skipIf(!head)("reads real git's exit status three ways: yes, no, and not-a-verdict", async () => {
    expect(await servedContains(head!.parent, head!.tip, { fetchImpl: apiDown })).toBe(true)
    expect(await servedContains(head!.tip, head!.parent, { fetchImpl: apiDown })).toBe(false)
    // An unknown commit makes git exit 128. That is not "no".
    expect(await servedContains("0".repeat(40), head!.tip, { fetchImpl: apiDown })).toBeNull()
  })
})
