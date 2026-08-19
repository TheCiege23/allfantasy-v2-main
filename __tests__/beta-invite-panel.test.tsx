import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BetaInvitePanel } from "@/components/admin/BetaInvitePanel"

/**
 * P0-1 admin invitation panel — render + behavior (jsdom).
 *
 * Proves the authenticated-admin invitation UX: issue a non-admin email, see the one-time
 * claim URL exactly once, dismiss it (non-recoverable), filter/list without leaking the raw
 * token or digest, double-submit is guarded, and unauthorized/list-failure states are shown.
 */

const fetchMock = vi.fn()

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function listOnly(invites: unknown[]) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (!init || init.method === undefined || init.method === "GET") return jsonResponse({ invites })
    return jsonResponse({ invites })
  })
}

describe("BetaInvitePanel", () => {
  it("renders the issue form for an authenticated admin (empty state)", async () => {
    listOnly([])
    render(<BetaInvitePanel />)

    expect(await screen.findByText(/Issue an invitation/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/manager@example.com/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Issue invite/i })).toBeInTheDocument()
    expect(await screen.findByText(/No invitations/i)).toBeInTheDocument()
  })

  it("accepts a non-admin email, shows the one-time claim URL, then hides it on dismiss", async () => {
    let issued = false
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        issued = true
        return jsonResponse({
          id: "inv-1",
          invitedEmail: "prospect@example.com", // NOT an admin — allowed
          claimUrl: "https://preview.example/api/auth/beta/claim?token=ONE-TIME-RAW-XYZ",
          expiresAt: null,
        })
      }
      // list reflects the issued invite but NEVER the raw token/digest
      return jsonResponse({
        invites: issued
          ? [{ id: "inv-1", invitedEmail: "prospect@example.com", status: "pending", note: null, createdByAdmin: "a", createdAt: "2026-07-24T00:00:00Z", expiresAt: null, revokedAt: null, redeemedAt: null, redeemedByUserId: null }]
          : [],
      })
    })

    render(<BetaInvitePanel />)
    fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
      target: { value: "prospect@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Issue invite/i }))

    // Claim URL shown exactly once, with the unrecoverable warning.
    expect(await screen.findByText(/cannot be recovered/i)).toBeInTheDocument()
    expect(screen.getByText(/ONE-TIME-RAW-XYZ/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Copy$/i })).toBeInTheDocument()

    // Dismiss → the raw URL is gone and cannot be recovered from the list/DOM.
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }))
    await waitFor(() => expect(screen.queryByText(/ONE-TIME-RAW-XYZ/)).not.toBeInTheDocument())
    expect(screen.queryByText(/cannot be recovered/i)).not.toBeInTheDocument()
  })

  it("never renders rawToken or tokenDigest even if the list payload contains them", async () => {
    // Defense-in-depth: the list endpoint should never return these, but if it did, the
    // panel must not surface them.
    listOnly([
      {
        id: "inv-1",
        invitedEmail: "prospect@example.com",
        status: "pending",
        note: null,
        createdByAdmin: "a",
        createdAt: "2026-07-24T00:00:00Z",
        expiresAt: null,
        revokedAt: null,
        redeemedAt: null,
        redeemedByUserId: null,
        // hostile extras that must NOT be rendered
        tokenDigest: "DIGEST-SHOULD-NOT-RENDER",
        rawToken: "RAW-SHOULD-NOT-RENDER",
      },
    ])
    render(<BetaInvitePanel />)

    expect(await screen.findByText("prospect@example.com")).toBeInTheDocument()
    expect(screen.queryByText(/DIGEST-SHOULD-NOT-RENDER/)).not.toBeInTheDocument()
    expect(screen.queryByText(/RAW-SHOULD-NOT-RENDER/)).not.toBeInTheDocument()
  })

  it("guards against double submit (button disabled while issuing)", async () => {
    let resolvePost: (v: unknown) => void = () => {}
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise((r) => (resolvePost = r))
      return jsonResponse({ invites: [] })
    })

    render(<BetaInvitePanel />)
    fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
      target: { value: "prospect@example.com" },
    })
    const btn = screen.getByRole("button", { name: /Issue invite/i })
    fireEvent.click(btn)

    // While the POST is in flight the button shows "Issuing…" and is disabled.
    expect(await screen.findByRole("button", { name: /Issuing/i })).toBeDisabled()

    resolvePost(jsonResponse({ id: "x", invitedEmail: "prospect@example.com", claimUrl: "u", expiresAt: null }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Issue invite/i })).toBeInTheDocument())
  })

  it("shows an accessible 'Not authorized' state on a 401 list", async () => {
    fetchMock.mockImplementation(() => jsonResponse({ error: "Unauthorized" }, false, 401))
    render(<BetaInvitePanel />)

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText(/Not authorized/i)).toBeInTheDocument()
  })

  it("revokes an active invite via DELETE with its id", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return jsonResponse({ ok: true })
      return jsonResponse({
        invites: [{ id: "inv-9", invitedEmail: "p@example.com", status: "pending", note: null, createdByAdmin: "a", createdAt: "2026-07-24T00:00:00Z", expiresAt: null, revokedAt: null, redeemedAt: null, redeemedByUserId: null }],
      })
    })

    render(<BetaInvitePanel />)
    // Ensure the row has rendered, then click the row's action button. Exact-anchor the
    // name so it does not match the "revoked" FILTER button.
    expect(await screen.findByText("p@example.com")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/ }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")
      expect(del).toBeTruthy()
      expect(String(del?.[0])).toContain("id=inv-9")
    })
  })

  it("exposes filter controls for every invitation state", async () => {
    listOnly([])
    render(<BetaInvitePanel />)
    const group = await screen.findByRole("group", { name: /Filter invites/i })
    for (const state of ["all", "active", "expired", "redeemed", "revoked"]) {
      expect(within(group).getByRole("button", { name: new RegExp(`^${state}$`, "i") })).toBeInTheDocument()
    }
  })

  it("shows a build marker and an honest notice (issuing disabled) when storage is not provisioned", async () => {
    // The API reports provisioned:false when this deployment's DB has no beta_invites table
    // (e.g. a Preview running against a DB without the additive migration). The panel must still
    // RENDER — with a clear notice and a build marker — instead of vanishing on a 500.
    fetchMock.mockImplementation(() =>
      jsonResponse({ invites: [], provisioned: false, reason: "storage_absent", build: { env: "preview", commit: "abc1234" } }),
    )
    render(<BetaInvitePanel />)

    // Build marker is visible so the deployed build is identifiable.
    expect(await screen.findByText(/build abc1234 · preview/i)).toBeInTheDocument()
    // Honest provisioning notice (not a silent failure).
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/storage not provisioned/i)
    // The issue form still renders, but issuing is disabled.
    const emailInput = screen.getByPlaceholderText(/manager@example.com/i)
    fireEvent.change(emailInput, { target: { value: "prospect@example.com" } })
    expect(screen.getByRole("button", { name: /Issue invite/i })).toBeDisabled()
  })

  it("treats a normal list response as provisioned (no notice, issuing enabled)", async () => {
    fetchMock.mockImplementation(() => jsonResponse({ invites: [], provisioned: true, build: { env: "production", commit: "deadbee" } }))
    render(<BetaInvitePanel />)
    expect(await screen.findByText(/No invitations/i)).toBeInTheDocument()
    expect(screen.queryByText(/storage not provisioned/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/manager@example.com/i), { target: { value: "prospect@example.com" } })
    expect(screen.getByRole("button", { name: /Issue invite/i })).toBeEnabled()
  })

  // ── Client-side field validation (P0-1) ─────────────────────────────────────────────────
  // Standards-compliant email (plus-addressing accepted), optional expiry (blank OK, future
  // required), and per-field error text — the button disables ONLY when a message is visible.
  describe("client-side field validation", () => {
    it("enables Issue invite for a normal Gmail address (no error shown)", async () => {
      listOnly([])
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "manager@gmail.com" },
      })
      expect(screen.getByRole("button", { name: /Issue invite/i })).toBeEnabled()
      expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument()
    })

    it("accepts a Gmail plus-address (+beta1) and enables the button — the reported case", async () => {
      listOnly([])
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "allfantasysportsapp+beta1@gmail.com" },
      })
      expect(screen.getByRole("button", { name: /Issue invite/i })).toBeEnabled()
      expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument()
    })

    it("POSTs the full plus-address verbatim — the client never strips +beta1", async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const b = JSON.parse(String(init.body)) as { email: string }
          return jsonResponse({ id: "x", invitedEmail: b.email, claimUrl: "u", expiresAt: null })
        }
        return jsonResponse({ invites: [] })
      })
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "allfantasysportsapp+beta1@gmail.com" },
      })
      fireEvent.click(screen.getByRole("button", { name: /Issue invite/i }))

      // Read the captured POST from the mock's recorded calls (the pattern used by the revoke
      // test above) — proving the client sends the full plus-address, `+beta1` intact.
      await waitFor(() =>
        expect(fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBeTruthy(),
      )
      const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")
      const body = JSON.parse(String((post?.[1] as RequestInit).body)) as { email: string }
      expect(body.email).toBe("allfantasysportsapp+beta1@gmail.com")
    })

    it("accepts a blank optional expiry (button stays enabled, no expiry error)", async () => {
      listOnly([])
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "manager+wave1@gmail.com" },
      })
      expect((screen.getByLabelText(/expires/i) as HTMLInputElement).value).toBe("")
      expect(screen.getByRole("button", { name: /Issue invite/i })).toBeEnabled()
      expect(screen.queryByText(/must be in the future/i)).not.toBeInTheDocument()
    })

    it("accepts a valid future expiry", async () => {
      listOnly([])
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "manager@example.com" },
      })
      fireEvent.change(screen.getByLabelText(/expires/i), { target: { value: "2999-01-01T12:00" } })
      expect(screen.getByRole("button", { name: /Issue invite/i })).toBeEnabled()
      expect(screen.queryByText(/must be in the future/i)).not.toBeInTheDocument()
    })

    it("rejects a past expiry with a visible error beneath the field and disables the button", async () => {
      listOnly([])
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "manager@example.com" },
      })
      fireEvent.change(screen.getByLabelText(/expires/i), { target: { value: "2020-01-01T12:00" } })
      expect(await screen.findByText(/must be in the future/i)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Issue invite/i })).toBeDisabled()
    })

    it("shows a visible error (not a silent disable) and disables for an invalid email", async () => {
      listOnly([])
      render(<BetaInvitePanel />)
      fireEvent.change(await screen.findByPlaceholderText(/manager@example.com/i), {
        target: { value: "not-an-email" },
      })
      expect(await screen.findByText(/valid email address/i)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Issue invite/i })).toBeDisabled()
    })
  })
})
