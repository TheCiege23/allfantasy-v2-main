// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 🛑 THE POINT OF THIS SUITE IS THAT SILENCE IS THE BUG.
 *
 * `initSentryServer` used to return silently on every failure path, so a
 * production app ran for at least two weeks with NO server-side error
 * reporting and nothing anywhere said so. A 500 on /admin on 2026-09-02 had no
 * Sentry issue, and the newest server error in the project was 14 days old.
 * Nothing was broken loudly; the reporter simply never started.
 *
 * ⚠ SO THESE TESTS ASSERT ON THE LOG, NOT ON THE RETURN VALUE. The function
 * returns void and must keep doing so — an observability failure must never
 * throw and take the server down with it. "Did it announce that it is not
 * working" is therefore the only observable worth testing, and a regression to
 * a bare `return` turns these red.
 *
 * ⚠ `// @vitest-environment node` IS LOad-BEARING. Under the default jsdom
 * environment `window` is defined, `initSentryServer` returns at its first line
 * before reaching any branch under test, and every assertion below would pass
 * or fail for reasons that have nothing to do with the code. Removing that
 * pragma makes this file measure nothing.
 */

const ORIGINAL_DSN = process.env.SENTRY_DSN
const ORIGINAL_PUBLIC_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

beforeEach(() => {
  vi.resetModules() // module-level `serverInitDone` must not leak between cases
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN
  else process.env.SENTRY_DSN = ORIGINAL_DSN
  if (ORIGINAL_PUBLIC_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN
  else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_PUBLIC_DSN
})

describe("initSentryServer — announces when it is not working", () => {
  it("says so when no DSN is configured (the state production was actually in)", async () => {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { initSentryServer } = await import("@/lib/error-tracking/sentry")
    initSentryServer()

    expect(spy).toHaveBeenCalled()
    const msg = spy.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(msg).toContain("[Sentry]")
    expect(msg).toContain("NOT active")
    // Names the variable an operator has to set — a message that does not say
    // what to do is only marginally better than silence.
    expect(msg).toContain("SENTRY_DSN")
  })

  it("does not throw — observability must never take the server down", async () => {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    vi.spyOn(console, "error").mockImplementation(() => {})

    const { initSentryServer } = await import("@/lib/error-tracking/sentry")
    expect(() => initSentryServer()).not.toThrow()
  })

  it("never puts the DSN itself in the log", async () => {
    // A DSN is a credential-bearing URL. The repo has a standing rule about
    // secrets escaping through helpful error output, so the message may report
    // PRESENCE but never the value.
    const secret = "https://abc123deadbeef@o000000.ingest.sentry.io/1234567"
    process.env.SENTRY_DSN = secret
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})

    const { initSentryServer } = await import("@/lib/error-tracking/sentry")
    initSentryServer()
    await new Promise((r) => setTimeout(r, 50)) // let the detached async IIFE settle

    const everything = [...errSpy.mock.calls, ...infoSpy.mock.calls]
      .map((c) => c.map(String).join(" "))
      .join("\n")
    expect(everything).not.toContain(secret)
    expect(everything).not.toContain("abc123deadbeef")
  })

  it("stays silent on the happy path only — a second call does not re-announce", async () => {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { initSentryServer } = await import("@/lib/error-tracking/sentry")
    initSentryServer()
    const afterFirst = spy.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    /*
     * ⚠ The no-DSN branch returns BEFORE setting `serverInitDone`, so it is
     * reachable again on a later call. That is deliberate: a DSN added by a
     * later deploy should still be picked up. It does mean the warning repeats
     * per call rather than once per process — noisy, but the failure mode of
     * the alternative (announce once, then never again) is exactly the silence
     * this suite exists to prevent.
     */
    initSentryServer()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(afterFirst)
  })
})
