/**
 * Resolving `followed` for served draft recommendations.
 *
 * 🛑 THE COLUMN THIS FILLS HAS NEVER BEEN FILLED. `resolveRecommendationOutcome` sat in the tree
 * with zero callers, so every follow-rate and every follow-vs-ignore comparison in getAIMetrics
 * read a column nothing wrote. The tests that matter here are the ones asserting a row is LEFT
 * ALONE — resolving a row wrongly is worse than the blank it replaces, because a wrong resolution
 * is indistinguishable from a right one once it is averaged.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  outcomeFindMany: vi.fn(),
  logFindMany: vi.fn(),
  pickFindFirst: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiRecommendationOutcome: { findMany: h.outcomeFindMany, updateMany: h.updateMany },
    aiRecommendationLog: { findMany: h.logFindMany },
    draftPick: { findFirst: h.pickFindFirst },
  },
}))

import { resolveDraftRecommendationOutcomes } from '@/lib/ai/outcomes/resolveDraftRecommendationOutcomes'

const SERVED_AT = new Date('2026-09-16T00:00:00.000Z')

function pending(id = 'rec-1') {
  return [{ recommendationId: id }]
}

function log(over: Record<string, unknown> = {}) {
  return [
    {
      id: 'rec-1',
      userId: 'user-1',
      draftSessionId: 'session-1',
      outputJson: { pickNow: 'Bijan Robinson' },
      createdAt: SERVED_AT,
      ...over,
    },
  ]
}

function pick(over: Record<string, unknown> = {}) {
  return {
    playerName: 'Bijan Robinson',
    source: 'user',
    pickedAt: new Date('2026-09-16T00:05:00.000Z'),
    createdAt: new Date('2026-09-16T00:05:00.000Z'),
    overall: 4,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.outcomeFindMany.mockResolvedValue([])
  h.logFindMany.mockResolvedValue([])
  h.pickFindFirst.mockResolvedValue(null)
  h.updateMany.mockResolvedValue({ count: 1 })
})

describe('a recommendation the manager acted on', () => {
  it('resolves followed when the next pick is the recommended player', async () => {
    h.outcomeFindMany.mockResolvedValue(pending())
    h.logFindMany.mockResolvedValue(log())
    h.pickFindFirst.mockResolvedValue(pick())

    const r = await resolveDraftRecommendationOutcomes()

    expect(r).toMatchObject({ examined: 1, resolved: 1, followed: 1, ignored: 0 })
    expect(h.updateMany).toHaveBeenCalledTimes(1)
    expect(h.updateMany.mock.calls[0][0].data).toMatchObject({ followed: true })
  })

  it('resolves ignored when they took somebody else', async () => {
    h.outcomeFindMany.mockResolvedValue(pending())
    h.logFindMany.mockResolvedValue(log())
    h.pickFindFirst.mockResolvedValue(pick({ playerName: 'Jahmyr Gibbs' }))

    const r = await resolveDraftRecommendationOutcomes()

    expect(r).toMatchObject({ resolved: 1, followed: 0, ignored: 1 })
    expect(h.updateMany.mock.calls[0][0].data).toMatchObject({ followed: false })
  })

  /*
   * The canonical normalizer, not a local one. Two implementations of one rule is the bug;
   * a resolver that disagrees with the draft pool about who "Ja'Marr Chase" is would score
   * a followed recommendation as ignored on nothing but an apostrophe.
   */
  it('matches through punctuation the way the draft pool does', async () => {
    h.outcomeFindMany.mockResolvedValue(pending())
    h.logFindMany.mockResolvedValue(log({ outputJson: { pickNow: "Ja'Marr Chase" } }))
    h.pickFindFirst.mockResolvedValue(pick({ playerName: 'JaMarr Chase' }))

    const r = await resolveDraftRecommendationOutcomes()
    expect(r).toMatchObject({ resolved: 1, followed: 1 })
  })
})

describe('rows that must be LEFT ALONE', () => {
  /*
   * 🛑 THE ONE THAT MATTERS MOST. A manager who times out gets a pick chosen for them. Counting
   * that as "ignored the advice" pushes the follow-rate down hardest in exactly the sessions
   * where nobody was reading the recommendation — it would measure who fell asleep and report it
   * as who disagreed.
   */
  it.each(['auto', 'random', 'draft_completion', 'draft_reset'])(
    'does not resolve when the next pick was not a decision (%s)',
    async (source) => {
      h.outcomeFindMany.mockResolvedValue(pending())
      h.logFindMany.mockResolvedValue(log())
      h.pickFindFirst.mockResolvedValue(pick({ source }))

      const r = await resolveDraftRecommendationOutcomes()

      expect(r).toMatchObject({ examined: 1, resolved: 0, skippedNonDecision: 1 })
      expect(h.updateMany).not.toHaveBeenCalled()
    },
  )

  /* "Not their turn yet" is not "they said no". Ask again next run. */
  it('leaves a recommendation pending when no pick has happened since', async () => {
    h.outcomeFindMany.mockResolvedValue(pending())
    h.logFindMany.mockResolvedValue(log())
    h.pickFindFirst.mockResolvedValue(null)

    const r = await resolveDraftRecommendationOutcomes()

    expect(r).toMatchObject({ resolved: 0, pendingNoPickYet: 1 })
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['no log row at all', []],
    ['no draft session', log({ draftSessionId: null })],
    ['no user', log({ userId: null })],
    ['no recommended player', log({ outputJson: {} })],
    ['a non-object payload', log({ outputJson: 'pickNow: somebody' })],
  ])('does not resolve a recommendation it cannot judge: %s', async (_label, logs) => {
    h.outcomeFindMany.mockResolvedValue(pending())
    h.logFindMany.mockResolvedValue(logs)
    h.pickFindFirst.mockResolvedValue(pick())

    const r = await resolveDraftRecommendationOutcomes()

    expect(r).toMatchObject({ resolved: 0, skippedUnusable: 1 })
    expect(h.updateMany).not.toHaveBeenCalled()
  })
})

describe('what it refuses to invent', () => {
  /*
   * ⚠ Whether a pick was GOOD is a different question from whether the advice was TAKEN, and it
   * needs production data this database cannot key to a drafted player. A placeholder score would
   * give getAIMetrics a number to average that means nothing — and an averaged meaningless number
   * is indistinguishable from a real one on a chart.
   */
  it('never writes an outcomeScore', async () => {
    h.outcomeFindMany.mockResolvedValue(pending())
    h.logFindMany.mockResolvedValue(log())
    h.pickFindFirst.mockResolvedValue(pick())

    await resolveDraftRecommendationOutcomes()

    const data = h.updateMany.mock.calls[0][0].data
    expect(data.outcomeScore).toBeUndefined()
  })

  /* Only the one type with both a live writer and a groundable outcome. */
  it('only ever looks at war_room_pick, and only unresolved rows', async () => {
    await resolveDraftRecommendationOutcomes()
    expect(h.outcomeFindMany.mock.calls[0][0].where).toEqual({
      type: 'war_room_pick',
      followed: null,
    })
  })

  it('takes a bounded batch, since it shares a ten-minute cron', async () => {
    await resolveDraftRecommendationOutcomes({ limit: 9000 })
    expect(h.outcomeFindMany.mock.calls[0][0].take).toBe(500)
    await resolveDraftRecommendationOutcomes()
    expect(h.outcomeFindMany.mock.calls[1][0].take).toBe(100)
  })

  it('does nothing at all when there is nothing pending', async () => {
    const r = await resolveDraftRecommendationOutcomes()
    expect(r.examined).toBe(0)
    expect(h.logFindMany).not.toHaveBeenCalled()
    expect(h.pickFindFirst).not.toHaveBeenCalled()
  })
})

/*
 * The clock behind it. Asserted against the cron's source because the property that matters is
 * structural — WHERE the call sits relative to the feature gate — and that is exactly what a
 * later tidy-up would change without noticing.
 */
describe('the scheduled caller', () => {
  const CRON = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'cron', 'decision-os-intelligence-maintenance', 'route.ts'),
    'utf8',
  )

  it('is actually called from a cron, not merely exported', () => {
    expect(CRON).toContain('resolveDraftRecommendationOutcomes({ limit: 100 })')
  })

  /*
   * 🛑 ABOVE `maintenanceEnabled()`, AND THIS IS THE ASSERTION THAT PROTECTS IT. That gate belongs
   * to Decision OS maintenance, which has nothing to do with outcome resolution. Moving this call
   * below it would mean a switch somebody turns off for an unrelated subsystem silently stops the
   * only thing that ever resolves an outcome — a writer that exists, looks wired, and never runs.
   */
  it('runs BEFORE the maintenance feature gate', () => {
    const call = CRON.indexOf('resolveDraftRecommendationOutcomes({')
    const gate = CRON.indexOf('if (!maintenanceEnabled())')
    expect(call).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(call).toBeLessThan(gate)
  })

  /* Outcome telemetry must never be the reason a scheduled job goes red. */
  it('cannot fail the cron', () => {
    const at = CRON.indexOf('resolveDraftRecommendationOutcomes({')
    expect(CRON.slice(at, at + 400)).toContain('.catch(')
  })

  /*
   * Reported in the response, so a run that resolves nothing is visible as a number rather than
   * as silence. The disabled-maintenance branch returns early, so it needs it too.
   */
  it('reports what it did on every response branch', () => {
    /*
     * ⚠ SLICED PER CALL, NOT PER LINE. The error branch puts `NextResponse.json(` on its own line
     * with the object below it, so a line-wise check fails against correct code — the second time
     * that shape has bitten in this session. A per-line guard is blind to a wrapped statement in
     * both directions: it can miss a violation just as easily as it invents one.
     */
    const calls: string[] = []
    let at = CRON.indexOf('NextResponse.json')
    while (at !== -1) {
      calls.push(CRON.slice(at, at + 260))
      at = CRON.indexOf('NextResponse.json', at + 1)
    }
    expect(calls.length).toBeGreaterThanOrEqual(3)
    for (const c of calls) {
      if (c.includes('unauthorized')) continue
      expect(c).toContain('draftOutcomes')
    }
  })
})
