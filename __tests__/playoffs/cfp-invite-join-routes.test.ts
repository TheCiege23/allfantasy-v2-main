import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ find: vi.fn(), auth: vi.fn(), legacyPreview: vi.fn(), legacyValidate: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { playoffBracketChallenge: { findUnique: mocks.find } } }))
vi.mock("@/lib/auth-guard", () => ({ requireVerifiedUser: mocks.auth }))
vi.mock("@/lib/league-invite", () => ({ getLeaguePreviewByCode: mocks.legacyPreview, validateInviteCode: mocks.legacyValidate, normalizeJoinCode: (s: string) => s }))

import { cfpInviteCode } from "@/lib/playoffs/cfpInvite"
import { GET } from "@/app/api/league-invite/preview/route"
import { POST } from "@/app/api/bracket/leagues/join/route"

const id = "cmw79xpf10008wmae48wlfp85"
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXTAUTH_SECRET", "test-only-secret-that-is-at-least-32-characters")
  mocks.auth.mockResolvedValue({ ok: true, userId: "member" })
  mocks.find.mockResolvedValue({ id, name: "Private CFP", sport: "ncaaf", seasonYear: 2026, config: { visibility: "private", maxParticipants: 50 }, entries: [{ userId: "owner" }] })
})

describe("CFP code-only invite routes", () => {
  it("previews and opens a signed invite without creating membership", async () => {
    const code = cfpInviteCode(id)
    const preview = await GET(new NextRequest(`https://example.test/api/league-invite/preview?code=${code}`))
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ ok: true, preview: { leagueId: id, memberCount: 1 } })
    const joined = await POST(new Request("https://example.test/api/bracket/leagues/join", { method: "POST", body: JSON.stringify({ joinCode: code }) }))
    expect(joined.status).toBe(200)
    expect(await joined.json()).toMatchObject({ ok: true, cfpInvite: true, leagueId: id })
    expect(mocks.legacyValidate).not.toHaveBeenCalled()
  })
  it("rejects a tampered invite before looking up or exposing the pool", async () => {
    const code = cfpInviteCode(id).slice(0, -1) + "Z"
    const preview = await GET(new NextRequest(`https://example.test/api/league-invite/preview?code=${code}`))
    expect(preview.status).toBe(404)
    const joined = await POST(new Request("https://example.test/api/bracket/leagues/join", { method: "POST", body: JSON.stringify({ joinCode: code }) }))
    expect(joined.status).toBe(404)
    expect(mocks.find).not.toHaveBeenCalled()
  })
})
