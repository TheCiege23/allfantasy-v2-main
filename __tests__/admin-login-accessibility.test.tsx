import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ReactNode } from "react"

import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * P0-1 /admin-login accessibility + behavior (jsdom).
 *
 * The page is the dark, premium admin theme (matching /admin). The defect was low-opacity
 * grey text on dark navy failing WCAG AA. These tests pin the accessible structure across
 * every state (initial / error / confirmation), the enumeration-safe copy, mobile wrapping,
 * and — via source assertions — the theme tokens, so a regression that re-introduces a
 * low-contrast class fails here. Measured ratios live in the contrast audit; the source
 * guards below prevent silent drift back to the failing values.
 */

// useSearchParams must be controllable; next/link needs no app-router context in jsdom.
const searchParamsGet = vi.fn<(key: string) => string | null>(() => null)
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGet }),
}))
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}))

import AdminLoginContent from "@/app/admin-login/AdminLoginContent"

const fetchMock = vi.fn()

beforeEach(() => {
  searchParamsGet.mockReset()
  searchParamsGet.mockReturnValue(null)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("/admin-login — initial state", () => {
  it("renders the heading, instructions, labelled email field, submit, and footer link", () => {
    render(<AdminLoginContent />)

    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument()
    expect(screen.getByText(/if you.re on the allowlist/i)).toBeInTheDocument()

    // The email input is reachable by its visible label text ("Admin email").
    const email = screen.getByLabelText(/admin email/i)
    expect(email).toHaveAttribute("type", "email")
    expect(email).toHaveAttribute("placeholder", "you@allfantasy.ai")

    expect(screen.getByRole("button", { name: /email me a magic link/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /regular sign in/i })).toHaveAttribute("href", "/login")
  })

  it("autofocuses the email field so a keyboard user starts there", () => {
    render(<AdminLoginContent />)
    expect(screen.getByLabelText(/admin email/i)).toHaveFocus()
  })
})

describe("/admin-login — validation & server errors", () => {
  it("has a defensive guard that rejects a no-@ value without calling the network", async () => {
    // Native type="email" + required blocks a real click-submit for an invalid value (jsdom
    // enforces this). The handler's own includes('@') check is a backstop behind that; we
    // dispatch submit directly to prove the backstop shows an alert and never hits the API.
    render(<AdminLoginContent />)
    const form = screen.getByRole("button", { name: /email me a magic link/i }).closest("form")!
    fireEvent.change(screen.getByLabelText(/admin email/i), { target: { value: "not-an-email" } })
    fireEvent.submit(form)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/enter a valid email/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows a server-error alert when the request fails", async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response)
    render(<AdminLoginContent />)
    fireEvent.change(screen.getByLabelText(/admin email/i), { target: { value: "admin@allfantasy.ai" } })
    fireEvent.click(screen.getByRole("button", { name: /email me a magic link/i }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/request failed/i)
  })
})

describe("/admin-login — confirmation state is enumeration-safe", () => {
  it("confirms send with conditional 'if … is on the allowlist' copy and a reset control", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response)
    render(<AdminLoginContent />)
    fireEvent.change(screen.getByLabelText(/admin email/i), { target: { value: "someone@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: /email me a magic link/i }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(/check your email/i)
    // Never asserts the address IS an admin — copy is strictly conditional.
    expect(status).toHaveTextContent(/if\s+someone@example\.com\s+is on the admin allowlist/i)
    expect(screen.getByRole("button", { name: /send to a different email/i })).toBeInTheDocument()
    // The success view replaces the form (single visible primary action).
    expect(screen.queryByRole("button", { name: /email me a magic link/i })).not.toBeInTheDocument()
  })

  it("does not reveal whether the entered email was actually eligible", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response)
    render(<AdminLoginContent />)
    fireEvent.change(screen.getByLabelText(/admin email/i), { target: { value: "stranger@nowhere.test" } })
    fireEvent.click(screen.getByRole("button", { name: /email me a magic link/i }))

    const status = await screen.findByRole("status")
    // No definitive "sent" / "you are an admin" / "not found" wording.
    expect(status.textContent || "").not.toMatch(/\b(you are|not (an )?admin|no account|not found|sent to)\b/i)
  })

  it("expired-link banner is announced when ?err=magic is present", () => {
    searchParamsGet.mockImplementation((k: string) => (k === "err" ? "magic" : null))
    render(<AdminLoginContent />)
    expect(screen.getByRole("alert")).toHaveTextContent(/no longer valid/i)
  })
})

// ── Source-assertion theme guards ─────────────────────────────────────────────────────
// The page must render on the app's LIGHT tokens. The global `html[data-mode="light"]
// .mode-readable` layer force-clamps every `text-white*` class to the dark --text token with
// !important, so ANY `text-white` here renders dark-on-(fixed light bg) OR dark-on-dark — both
// broken. These guards keep the page on token/hex classes the clamp cannot touch.
describe("/admin-login — renders on light-mode tokens the global clamp cannot break", () => {
  const src = readFileSync(resolve(process.cwd(), "app/admin-login/AdminLoginContent.tsx"), "utf-8")

  it("uses NO `text-white*` class (they are force-clamped to dark --text in light mode)", () => {
    // Match a real class token (space/quote-delimited), so the doc-comment that *mentions*
    // `text-white*` while explaining the clamp does not trip this guard.
    expect(src).not.toMatch(/[\s"']text-white(?:\/\d+)?[\s"']/)
  })

  it("does not hardcode a dark page/card/input background (the original dark-on-dark defect)", () => {
    for (const banned of ["bg-[#0a0f1a]", "bg-[#0d1220]", "bg-[#121725]", "bg-white/[0.0"]) {
      expect(src, `dark surface still present: ${banned}`).not.toContain(banned)
    }
    expect(src).toContain("bg-gradient-to-b from-white") // light page
    expect(src).toContain("bg-[#ffffff]") // white card + input (avoids the input `bg-white` override)
  })

  it("colors text with the app design tokens (not scattered arbitrary colors)", () => {
    expect(src).toContain("text-[color:var(--text)]") // primary text
    expect(src).toContain("text-[color:var(--muted)]") // secondary text
    expect(src).toContain("text-[color:var(--accent)]") // links / icon accent
  })

  it("gives the input a self-identifying >=3:1 boundary and an AA placeholder override", () => {
    expect(src).toContain("border-[#64748b]") // input border 4.76:1 on white (>=3:1)
    // scoped, higher-specificity placeholder rule beats the app's --muted2 (3.3:1) clamp
    expect(src).toMatch(/input\.af-admin-email::placeholder\{color:rgba\(2,6,23,0\.62\)!important\}/)
  })

  it("defines a visible keyboard-focus outline (the Tailwind ring/forms plugin leaves none here)", () => {
    expect(src).toMatch(/\.af-admin-focus:focus\{outline:2px solid var\(--accent,#2563EB\)!important/)
    // …and applies it to every interactive control
    const focusHits = (src.match(/af-admin-focus/g) || []).length
    expect(focusHits).toBeGreaterThanOrEqual(5) // rule + input + submit + reset link + footer link
  })

  it("keeps interactive targets ~44px and wraps long emails to avoid horizontal overflow", () => {
    expect(src).toContain("min-h-[44px]") // touch targets
    expect(src).toContain("max-w-md") // capped, centered column (no full-bleed overflow)
    expect(src).toContain("break-all") // long email address wraps
  })
})
