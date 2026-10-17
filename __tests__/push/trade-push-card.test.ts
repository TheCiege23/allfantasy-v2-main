import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
// next/og loads its font through import.meta.url, which vitest cannot resolve — the same reason
// __tests__/share/proposal-card.test.ts stubs it. The stub records what would have been drawn.
const rendered: { element: unknown; options: { width?: number; height?: number; headers?: Record<string, string> } }[] = []
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown, options: { headers?: Record<string, string> }) {
      super("png", { status: 200, headers: { "content-type": "image/png", ...(options.headers ?? {}) } })
      rendered.push({ element, options })
    }
  },
}))

import { normalizeTradeCard, tradeCardPath, verifyTradeCard, type TradeCard } from "@/lib/push-notifications/tradeCard"
import { completedTradeCard, offerTradeCard } from "@/lib/trade-intel/tradePushCard"
import type { TradeGradeView } from "@/lib/decision-os/trade/tradeGrade"
import type { GradedTrade } from "@/lib/trade-intel/sleeperTradeGradeService"

const ENV = { NEXTAUTH_SECRET: "test-secret-for-push-card" }

const card: TradeCard = {
  v: 1,
  kind: "offer",
  league: "AFC Dreaming!",
  sides: [
    { name: "You", you: true, letter: "B", gets: [{ n: "Breece Hall", d: "RB · NYJ", id: "8155" }] },
    { name: "JeffersonTD", letter: "D", gets: [{ n: "2028 2nd pick", d: "Draft pick" }] },
  ],
}

function parts(path: string) {
  const u = new URL(path, "https://allfantasy.ai")
  return { d: u.searchParams.get("d"), s: u.searchParams.get("s") }
}

describe("trade card signing", () => {
  it("round-trips a signed card", () => {
    const path = tradeCardPath(card, ENV)!
    expect(path.startsWith("/api/push-card/trade?d=")).toBe(true)
    const { d, s } = parts(path)
    const v = verifyTradeCard(d, s, ENV)
    expect(v.ok && v.card.sides[0].gets[0].n).toBe("Breece Hall")
  })

  it("refuses a card whose data was changed after signing", () => {
    const { d, s } = parts(tradeCardPath(card, ENV)!)
    const forged = Buffer.from(
      JSON.stringify({ ...card, league: "Click here to claim your prize" }),
      "utf8",
    ).toString("base64url")
    expect(verifyTradeCard(forged, s, ENV)).toEqual({ ok: false, reason: "bad_signature" })
    expect(verifyTradeCard(d, s, { NEXTAUTH_SECRET: "a-different-secret" })).toEqual({ ok: false, reason: "bad_signature" })
  })

  it("issues no link without a key, so the push goes out as text", () => {
    expect(tradeCardPath(card, {})).toBeNull()
    expect(verifyTradeCard("x", "y", {})).toEqual({ ok: false, reason: "no_key" })
  })

  it("bounds every field and keeps the overflow count through sign → verify", () => {
    const many = normalizeTradeCard({
      ...card,
      league: "L\u0000".repeat(80),
      sides: [
        { ...card.sides[0], gets: Array.from({ length: 6 }, (_, i) => ({ n: `P${i}`, id: i === 0 ? "12a" : "1" })) },
        card.sides[1],
      ],
    })
    expect(many.league.length).toBeLessThanOrEqual(48)
    expect(many.league).not.toContain("\u0000")
    expect(many.sides[0].gets).toHaveLength(4)
    expect(many.sides[0].more).toBe(2)
    expect(many.sides[0].gets[0].id).toBeUndefined()
    const { d, s } = parts(tradeCardPath(many, ENV)!)
    const v = verifyTradeCard(d, s, ENV)
    expect(v.ok && v.card.sides[0].more).toBe(2)
  })
})

const grade = { graded: true, letter: "B", partnerLetter: "D" } as unknown as TradeGradeView

describe("offerTradeCard", () => {
  it("puts the recipient first with their own letter, and the proposer with the mirror", () => {
    const c = offerTradeCard({
      leagueName: "AFC Dreaming!",
      proposerName: "JeffersonTD",
      youGet: [{ playerId: "8155", playerName: "Breece Hall", position: "RB", team: "NYJ" }],
      youGive: [
        { playerId: null, playerName: "2028 2nd round pick", position: "PICK", team: "—", isPick: true, pickRound: "2028 2nd" },
        { playerId: null, playerName: "FAAB", position: "—", team: "—", faabAmount: 20 },
      ],
      grade,
      isNfl: true,
    })
    expect(c.sides[0]).toMatchObject({ you: true, letter: "B", gets: [{ n: "Breece Hall", d: "RB · NYJ", id: "8155" }] })
    expect(c.sides[1]).toMatchObject({ name: "JeffersonTD", letter: "D" })
    expect(c.sides[1].gets.map((a) => a.n)).toEqual(["2028 2nd pick", "$20 FAAB"])
  })

  it("draws no headshot outside the NFL and no letter without a grade", () => {
    const c = offerTradeCard({
      leagueName: "L",
      proposerName: null,
      youGet: [{ playerId: "4046", playerName: "N. Jokic", position: "C", team: "DEN" }],
      youGive: [],
      grade: null,
      isNfl: false,
    })
    expect(c.sides[0].gets[0].id).toBeUndefined()
    expect(c.sides[0].letter).toBeNull()
    expect(c.sides[1].name).toBe("Their side")
  })
})

describe("completedTradeCard", () => {
  const side = (ownerId: string, name: string, playerId: string) => ({
    rosterId: 1,
    ownerId,
    managerName: name,
    teamName: null,
    avatar: null,
    playersIn: [{ playerId, name: `Player ${playerId}`, position: "WR" }],
    playersOut: [],
    picksIn: [],
    picksOut: [],
    faabIn: 0,
  })
  const trade = { sides: [side("u1", "Alpha", "100"), side("u2", "Bravo", "200")] } as unknown as GradedTrade

  it("reads letters through the email's own rule and marks the viewer", () => {
    const c = completedTradeCard({ leagueName: "L", trade, grade, viewerOwnerId: "u2", isNfl: true })!
    expect(c.sides[0]).toMatchObject({ name: "Alpha", letter: "B" })
    expect(c.sides[1]).toMatchObject({ name: "Bravo", letter: "D", you: true })
    expect(c.sides[1].gets[0]).toMatchObject({ n: "Player 200", id: "200" })
  })

  it("makes no card for a three-team trade", () => {
    const three = { sides: [...(trade.sides as unknown[]), side("u3", "C", "300")] } as unknown as GradedTrade
    expect(completedTradeCard({ leagueName: "L", trade: three, grade, viewerOwnerId: null, isNfl: true })).toBeNull()
  })
})

describe("imageTypeOf — the headshot is identified by its bytes", () => {
  it("reads PNG and JPEG signatures and refuses everything else", async () => {
    const { imageTypeOf } = await import("@/app/api/push-card/trade/route")
    // Sleeper's CDN serves PNG bytes from a .jpg URL with Content-Type image/jpeg (measured).
    expect(imageTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png")
    expect(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(imageTypeOf(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBeNull()
    expect(imageTypeOf(new TextEncoder().encode("<!doctype html>"))).toBeNull()
  })
})

describe("/api/push-card/trade", () => {
  const prevSecret = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = ENV.NEXTAUTH_SECRET
    // Headshot fetch fails: the card must still render, with initials.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })))
  })
  afterAll(() => {
    process.env.NEXTAUTH_SECRET = prevSecret
    vi.unstubAllGlobals()
  })

  it("refuses a forged link with 403", async () => {
    const { GET } = await import("@/app/api/push-card/trade/route")
    const res = await GET(new Request("https://allfantasy.ai/api/push-card/trade?d=abc&s=def") as never)
    expect(res.status).toBe(403)
  })

  it("draws a signed card even when every headshot is missing, and lets it be cached", async () => {
    const { GET } = await import("@/app/api/push-card/trade/route")
    const path = tradeCardPath(card, ENV)!
    const res = await GET(new Request(`https://allfantasy.ai${path}`) as never)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("immutable")
    const last = rendered.at(-1)!
    expect(last.options).toMatchObject({ width: 1200, height: 600 })
    const text = JSON.stringify(last.element)
    for (const expected of ["Trade offer", "AFC Dreaming!", "Breece Hall", "JeffersonTD", "2028 2nd pick"]) {
      expect(text).toContain(expected)
    }
  })
})
