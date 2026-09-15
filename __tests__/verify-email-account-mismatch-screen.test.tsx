import type { ReactNode } from "react"

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /verify reports on the account SIGNED IN to the browser; the emailed link can
 * belong to another one. It used to say "This address is already verified" without
 * saying whose address — reported 2026-09-15 by an owner whose account had never
 * been verified, from a session signed in as a verified account, while the import
 * gate (correctly) kept refusing the unverified one.
 *
 * Every negative assertion here is paired with a case the old screen renders
 * differently, so none of them can pass for a reason unrelated to the fix.
 */

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }))
const auth = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
}))
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("next-auth/react", () => ({ signOut: auth.signOut }))

import { VerifyEmailV4 } from "@/components/core-app/screens/VerifyEmailV4"

const SIGNED_IN_ELSEWHERE = "main@example.com"
const UNVERIFIED = "cj@example.com"

function at(query: string) {
  nav.params = new URLSearchParams(query)
}

const assign = vi.fn()

/** Where "switch account" sends the reader: the path, and the page they return to after signing in. */
function switchedTo(): { path: string; afterSignIn: string | null } | null {
  const target = assign.mock.calls.at(-1)?.[0] as string | undefined
  if (!target) return null
  const url = new URL(target, "https://allfantasy.test")
  return { path: url.pathname, afterSignIn: url.searchParams.get("callbackUrl") }
}

beforeEach(() => {
  nav.push.mockReset()
  auth.signOut.mockReset()
  auth.signOut.mockResolvedValue({ url: "https://allfantasy.test/core" })
  assign.mockReset()
  vi.stubGlobal("location", { ...window.location, assign })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a dead link opened while signed in to a VERIFIED account", () => {
  beforeEach(() => at("error=INVALID_LINK&returnTo=%2Fonboarding"))

  it("says which account is verified, by address", () => {
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      `signed in as ${SIGNED_IN_ELSEWHERE}, and that account is already verified`,
    )
  })

  /*
   * The old card offered "Send a new link" here, and for a verified account the
   * send route can only ever answer "already verified" — which is exactly the
   * reply that was read as being about the link's account.
   */
  it("does not offer a resend that can only answer for the signed-in account", () => {
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    expect(screen.queryByRole("button", { name: /send a new link/i })).toBeNull()
  })

  it("offers to continue, or to switch to the account the link was for", async () => {
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    expect(screen.getByRole("link", { name: /^continue$/i })).toHaveAttribute("href", "/onboarding")

    fireEvent.click(screen.getByRole("button", { name: /use a different account/i }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(switchedTo()).toEqual({ path: "/login", afterSignIn: "/verify?returnTo=%2Fonboarding" })
  })

  /*
   * ⚠ signOut's own callbackUrl goes through the `redirect` callback in lib/auth.ts,
   * which rewrites /login to /core. Handing it '/login?…' signed the reader out and
   * dropped them on /core. The screen must sign out WITHOUT next-auth's redirect and
   * navigate to sign-in itself.
   */
  it("signs out without next-auth's redirect, which would turn /login into /core", async () => {
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    fireEvent.click(screen.getByRole("button", { name: /use a different account/i }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))

    expect(auth.signOut).toHaveBeenCalledWith({ redirect: false })
    expect(auth.signOut.mock.calls.at(-1)?.[0]).not.toHaveProperty("callbackUrl")
  })

  it("still reaches sign-in if the sign-out request itself fails", async () => {
    auth.signOut.mockRejectedValue(new Error("network down"))
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    fireEvent.click(screen.getByRole("button", { name: /use a different account/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(switchedTo()?.path).toBe("/login")
  })
})

describe("a dead link opened while signed in to an UNVERIFIED account", () => {
  beforeEach(() => at("error=INVALID_LINK&returnTo=%2Fonboarding"))

  it("offers the resend and says which address it goes to", () => {
    render(<VerifyEmailV4 email={UNVERIFIED} alreadyVerified={false} signedIn />)

    expect(screen.getByRole("button", { name: /send a new link/i })).toBeInTheDocument()
    expect(screen.getByText(/the new link goes to/i)).toHaveTextContent(UNVERIFIED)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  /* Verified in another tab after this page rendered — the reply must still say whose. */
  it("names the address when the send route answers already-verified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, alreadyVerified: true }), { status: 200 })),
    )
    render(<VerifyEmailV4 email={UNVERIFIED} alreadyVerified={false} signedIn />)

    fireEvent.click(screen.getByRole("button", { name: /send a new link/i }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(`${UNVERIFIED} is already verified`)
    expect(alert).not.toHaveTextContent(/this address is already verified/i)
  })
})

describe("an expired link for a different account (account=other)", () => {
  beforeEach(() => at("error=EXPIRED_LINK&account=other&returnTo=%2Fonboarding"))

  it("says the link is for another account and names the one signed in here", () => {
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified={false} signedIn />)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("This link was sent to a different account than the one signed in here.")
    expect(alert).toHaveTextContent(SIGNED_IN_ELSEWHERE)
  })

  it("does not send a new link to the wrong account", () => {
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified={false} signedIn />)

    expect(screen.queryByRole("button", { name: /send a new link/i })).toBeNull()
    expect(screen.getByRole("button", { name: /use a different account/i })).toBeInTheDocument()
  })

  it("ignores the flag once signed out — there is no other account to be", () => {
    render(<VerifyEmailV4 email={null} alreadyVerified={false} signedIn={false} />)

    expect(screen.queryByText(/different account/i)).toBeNull()
    expect(screen.getByRole("link", { name: /sign in to resend/i })).toBeInTheDocument()
  })
})

describe("a working link that verified a DIFFERENT account", () => {
  it("does not auto-continue into the signed-in account", () => {
    vi.useFakeTimers()
    at("verified=email&account=other&returnTo=%2Fonboarding")
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    expect(screen.getByText(/that link verified the account it was sent to/i)).toHaveTextContent(
      SIGNED_IN_ELSEWHERE,
    )
    for (let i = 0; i < 6; i++) act(() => vi.advanceTimersByTime(1000))

    expect(nav.push).not.toHaveBeenCalled()
    expect(screen.queryByText(/redirecting in/i)).toBeNull()
  })

  /* Positive control for the test above: the same screen without the flag DOES leave. */
  it("control: without the flag the verified card still auto-continues", () => {
    vi.useFakeTimers()
    at("verified=email&returnTo=%2Fonboarding")
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    expect(screen.getByText(/redirecting in/i)).toBeInTheDocument()
    for (let i = 0; i < 6; i++) act(() => vi.advanceTimersByTime(1000))

    expect(nav.push).toHaveBeenCalledWith("/onboarding")
  })

  it("switching accounts returns to where the verified account was headed", async () => {
    at("verified=email&account=other&returnTo=%2Fonboarding")
    render(<VerifyEmailV4 email={SIGNED_IN_ELSEWHERE} alreadyVerified signedIn />)

    fireEvent.click(screen.getByRole("button", { name: /sign in to that account/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(switchedTo()).toEqual({ path: "/login", afterSignIn: "/onboarding" })
  })
})
