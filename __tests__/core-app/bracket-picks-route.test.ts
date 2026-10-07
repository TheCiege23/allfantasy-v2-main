// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/core/bracket-picks — the /core Bracket Challenge's saved champion + series length.
 *
 * Runs the REAL route, store (lib/core-app/bracketPicksStore) and pool reader
 * (lib/core-app/bracketChallenge `getBracketPool`) over a mocked Prisma, so the
 * P2021 → "unavailable" mapping and the "is this club in the bracket" check are
 * the shipped code, not a stand-in.
 */

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  findUnique: vi.fn(),
  upsert: vi.fn(),
  teams: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () =>
    h.userId ? { ok: true, userId: h.userId } : { ok: false, response: new Response('{}', { status: 401 }) },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    coreBracketPick: { findUnique: h.findUnique, upsert: h.upsert },
    sportsTeam: { findMany: h.teams },
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true, retryAfterSec: 0 }),
  buildRateLimit429: () => ({}),
}))

import { GET, PUT } from '@/app/api/core/bracket-picks/route'

const URL_BASE = 'http://localhost/api/core/bracket-picks'

const get = (sport: string | null = 'mlb') =>
  GET(new NextRequest(sport === null ? URL_BASE : `${URL_BASE}?sport=${encodeURIComponent(sport)}`))

const put = (body: unknown) =>
  PUT(
    new NextRequest(URL_BASE, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

function prismaError(code: string): Error {
  return Object.assign(new Error(`prisma ${code}`), { code })
}

const MLB_ROWS = [
  { id: 'nyy', name: 'New York Yankees', shortName: 'NYY', logo: null, conference: 'American League - East' },
  { id: 'lad', name: 'Los Angeles Dodgers', shortName: 'LAD', logo: null, conference: 'National League - West' },
  // A pseudo-team the picker never offers — so it must not be savable either.
  { id: 'al-stars', name: 'AL All-Stars', shortName: 'AL', logo: null, conference: 'American League' },
]

const UPDATED = new Date('2026-10-06T12:00:00.000Z')

beforeEach(() => {
  h.userId = 'u1'
  h.findUnique.mockReset().mockResolvedValue(null)
  h.upsert.mockReset().mockImplementation(async (args: { create: { championTeamId: string | null; finalLength: number | null } }) => ({
    championTeamId: args.create.championTeamId,
    finalLength: args.create.finalLength,
    updatedAt: UPDATED,
  }))
  h.teams.mockReset().mockResolvedValue(MLB_ROWS)
})

describe('auth', () => {
  it('GET and PUT need a session, and touch nothing without one', async () => {
    h.userId = null
    expect((await get()).status).toBe(401)
    expect((await put({ sport: 'mlb', championTeamId: 'nyy', finalLength: 6 })).status).toBe(401)
    expect(h.findUnique).not.toHaveBeenCalled()
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('returns null when nothing is saved, keyed on the session user and the server season', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', sport: 'mlb', seasonYear: 2026, pick: null })
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_sport_seasonYear: { userId: 'u1', sport: 'mlb', seasonYear: 2026 } } }),
    )
  })

  it('returns the saved pick', async () => {
    h.findUnique.mockResolvedValue({ championTeamId: 'nyy', finalLength: 6, updatedAt: UPDATED })
    expect(await (await get()).json()).toEqual({
      status: 'ok',
      sport: 'mlb',
      seasonYear: 2026,
      pick: { championTeamId: 'nyy', finalLength: 6, updatedAt: UPDATED.toISOString() },
    })
  })

  it('refuses a sport with no built bracket, an unknown sport and a missing one', async () => {
    for (const sport of ['nba', 'quidditch', '', null]) {
      expect((await get(sport)).status).toBe(400)
    }
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it.each(['P2021', 'P2022'])('reports saving unavailable (200) when the migration is not applied — %s', async (code) => {
    h.findUnique.mockRejectedValue(prismaError(code))
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'unavailable' })
  })

  it('any other read failure is a 503 error, NOT "unavailable"', async () => {
    h.findUnique.mockRejectedValue(prismaError('P1001'))
    const res = await get()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBeUndefined()
    expect(body.error).toMatch(/could not be read/i)
  })
})

describe('PUT validation', () => {
  it.each([
    ['an unknown sport', { sport: 'quidditch', championTeamId: 'nyy', finalLength: 6 }],
    ['a sport whose bracket is not built', { sport: 'nba', championTeamId: 'nyy', finalLength: 6 }],
    ['a length outside the shell options', { sport: 'mlb', championTeamId: 'nyy', finalLength: 3 }],
    ['a length above the options', { sport: 'mlb', championTeamId: 'nyy', finalLength: 8 }],
    ['a fractional length', { sport: 'mlb', championTeamId: 'nyy', finalLength: 5.5 }],
    ['a length sent as a string', { sport: 'mlb', championTeamId: 'nyy', finalLength: '6' }],
    ['a numeric team id', { sport: 'mlb', championTeamId: 42, finalLength: 6 }],
    ['a blank team id', { sport: 'mlb', championTeamId: '   ', finalLength: 6 }],
    ['an array body', [{ sport: 'mlb' }]],
    ['a non-JSON body', 'not json'],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    expect((await put(body)).status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('refuses a team that is not in this bracket — including one the picker filters out', async () => {
    for (const championTeamId of ['not-a-team', 'al-stars']) {
      const res = await put({ sport: 'mlb', championTeamId, finalLength: 6 })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/not in this bracket/i)
    }
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a failed team-list read is a 503, not a validation error', async () => {
    h.teams.mockRejectedValue(prismaError('P1001'))
    const res = await put({ sport: 'mlb', championTeamId: 'nyy', finalLength: 6 })
    expect(res.status).toBe(503)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('PUT upsert', () => {
  it('upserts one row per user + sport + season and returns it', async () => {
    const res = await put({ sport: 'mlb', championTeamId: 'nyy', finalLength: 6 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok',
      sport: 'mlb',
      seasonYear: 2026,
      pick: { championTeamId: 'nyy', finalLength: 6, updatedAt: UPDATED.toISOString() },
    })
    expect(h.upsert).toHaveBeenCalledTimes(1)
    const args = h.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ userId_sport_seasonYear: { userId: 'u1', sport: 'mlb', seasonYear: 2026 } })
    expect(args.create).toEqual({ userId: 'u1', sport: 'mlb', seasonYear: 2026, championTeamId: 'nyy', finalLength: 6 })
    expect(args.update).toEqual({ championTeamId: 'nyy', finalLength: 6 })
  })

  it('the season and the user come from the server, never the body', async () => {
    await put({ sport: 'mlb', championTeamId: 'lad', finalLength: null, seasonYear: 1999, userId: 'someone-else' })
    const args = h.upsert.mock.calls[0][0]
    expect(args.where.userId_sport_seasonYear).toEqual({ userId: 'u1', sport: 'mlb', seasonYear: 2026 })
    expect(args.create.userId).toBe('u1')
    expect(args.create.seasonYear).toBe(2026)
  })

  it('a length alone (no champion) saves without reading the team list; clearing both saves nulls', async () => {
    expect((await put({ sport: 'mlb', championTeamId: null, finalLength: 4 })).status).toBe(200)
    expect((await put({ sport: 'mlb', championTeamId: null, finalLength: null })).status).toBe(200)
    expect(h.teams).not.toHaveBeenCalled()
    expect(h.upsert.mock.calls[1][0].update).toEqual({ championTeamId: null, finalLength: null })
  })

  it.each(['P2021', 'P2022'])('answers 503 "unavailable" when the migration is not applied — %s', async (code) => {
    h.upsert.mockRejectedValue(prismaError(code))
    const res = await put({ sport: 'mlb', championTeamId: 'nyy', finalLength: 6 })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'unavailable' })
  })

  it('any other write failure is a 503 error, NOT "unavailable"', async () => {
    h.upsert.mockRejectedValue(prismaError('P2034'))
    const res = await put({ sport: 'mlb', championTeamId: 'nyy', finalLength: 6 })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBeUndefined()
    expect(body.error).toMatch(/could not be saved/i)
  })
})
