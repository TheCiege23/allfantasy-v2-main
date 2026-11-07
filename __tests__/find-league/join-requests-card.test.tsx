// @vitest-environment jsdom
/**
 * The Commissioner Hub card where a private league's "Ask to join" requests are approved or
 * declined, and where the league can be taken off Find a League.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { JoinRequestsCard } from "@/components/core-app/commissioner/JoinRequestsCard"

const state = vi.hoisted(() => ({ get: {} as Record<string, unknown> }))
let calls: Array<{ url: string; method: string; body?: string }> = []

beforeEach(() => {
  calls = []
  state.get = {
    listed: true,
    hidden: false,
    requests: [{ id: "R1", status: "pending", message: "hi", createdAt: "2026-11-01T00:00:00Z", name: "Pat", username: "pat" }],
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined })
      if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify(state.get))
      return new Response(JSON.stringify({ ok: true }))
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("JoinRequestsCard", () => {
  it("lists a pending request and approves it", async () => {
    render(<JoinRequestsCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId("join-request-approve-R1"))
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true))
    const patch = calls.find((c) => c.method === "PATCH")!
    expect(patch.url).toBe("/api/find-league/leagues/L1/request")
    expect(JSON.parse(patch.body!)).toEqual({ requestId: "R1", action: "approve" })
  })

  it("can hide the league from Find a League", async () => {
    render(<JoinRequestsCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId("join-requests-toggle-listing"))
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true))
    expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body!)).toEqual({ listing: "hide" })
  })

  it("renders nothing for a league that is not listed and has no requests", async () => {
    state.get = { listed: false, hidden: false, requests: [] }
    const { container } = render(<JoinRequestsCard leagueId="L1" />)
    await waitFor(() => expect(calls.length).toBe(1))
    expect(container.innerHTML).toBe("")
  })
})
