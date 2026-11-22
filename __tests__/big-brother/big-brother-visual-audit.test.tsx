/**
 * Big Brother league home, 2026-11-09 visual audit (phone + desktop, dark + light, DB-free harness at
 * /e2e/big-brother/[id]/[view]).
 *
 * 1. 🛑 Vote totals leaked through the audit log. GET …/big-brother/audit returned every row's raw metadata to any
 *    member: `eviction` rows carry per-nominee `voteCount`, and a commissioner `rerun_vote_tally` logs
 *    `votesByTarget` while voting is open. A league shows exact totals only when `publicVoteTotalsVisibility` is
 *    'exact' (default 'evicted_only'). Non-commissioners now get totals only on a published result in such a league.
 * 2. History printed each row as its event code over a JSON dump with roster ids; it now reads as sentences.
 * 3. HOH printed the raw phase code ("Phase: VOTING_OPEN"); HOH and Veto fell back to raw roster ids.
 * 4. Light mode blanked every view but House; the home root opts out of the clamp.
 * 5. The commissioner's automation dropdown ran past its card on a phone.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatInTimezone: (d: string) => d, timezone: 'UTC' }) }))

import { redactBigBrotherAuditForViewer } from '@/lib/big-brother/auditVisibility'
import { bigBrotherPhaseLabel, describeBigBrotherAuditEvent } from '@/components/big-brother/bigBrotherCopy'
import { BigBrotherHome } from '@/components/big-brother/BigBrotherHome'
import { audit, summary } from '@/app/e2e/big-brother/fixtures'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const eviction = { eventType: 'eviction', metadata: { week: 4, evictedRosterId: 'a', voteCount: { a: 6, b: 2 }, tied: false } }
const liveTally = { eventType: 'phase_transition', metadata: { adminAction: 'rerun_vote_tally', cycleId: 'c5', votesByTarget: { c: 3, d: 1 } } }
const finale = { eventType: 'finale_vote', metadata: { winnerRosterId: 'a', voteCount: 5 } }

describe('audit log vote totals', () => {
  it('hides every total from a member when the league does not show exact totals', () => {
    const out = redactBigBrotherAuditForViewer([eviction, liveTally, finale], { isCommissioner: false, showExactTotals: false })
    for (const row of out) {
      expect(row.metadata).not.toHaveProperty('voteCount')
      expect(row.metadata).not.toHaveProperty('votesByTarget')
    }
    // What happened stays: who was evicted, and the commissioner's action.
    expect(out[0]!.metadata).toMatchObject({ week: 4, evictedRosterId: 'a' })
    expect(out[1]!.metadata).toMatchObject({ adminAction: 'rerun_vote_tally' })
  })

  it('shows a published result to a member in an exact-totals league, but never a mid-vote tally', () => {
    const out = redactBigBrotherAuditForViewer([eviction, liveTally, finale], { isCommissioner: false, showExactTotals: true })
    expect(out[0]!.metadata).toHaveProperty('voteCount')
    expect(out[2]!.metadata).toHaveProperty('voteCount')
    expect(out[1]!.metadata).not.toHaveProperty('votesByTarget')
  })

  it('leaves the commissioner everything, and never mutates the rows it was given', () => {
    const rows = [eviction, liveTally]
    expect(redactBigBrotherAuditForViewer(rows, { isCommissioner: true, showExactTotals: false })).toBe(rows)
    redactBigBrotherAuditForViewer(rows, { isCommissioner: false, showExactTotals: false })
    expect(eviction.metadata).toHaveProperty('voteCount')
  })

  it('is applied by the audit route, from the league owner and the league setting', () => {
    const route = readFileSync(path.join(process.cwd(), 'app/api/leagues/[leagueId]/big-brother/audit/route.ts'), 'utf8')
    expect(route).toMatch(/redactBigBrotherAuditForViewer\(rows, \{\s*isCommissioner: league\?\.userId === userId,\s*showExactTotals: config\?\.publicVoteTotalsVisibility === 'exact',/)
    expect(route).toMatch(/const log = visible\.map/)
  })
})

describe('Big Brother copy', () => {
  const names = { a: 'Casey', b: 'Quinn', c: 'Riley', d: 'Jordan' }

  it('reads each house-log row as a sentence with names, never an id or JSON', () => {
    const rows = [
      { eventType: 'eviction', metadata: { week: 4, evictedRosterId: 'a' } },
      { eventType: 'veto_winner', metadata: { week: 5, rosterId: 'b' } },
      { eventType: 'nomination', metadata: { week: 5, nominee1RosterId: 'c', nominee2RosterId: 'd' } },
      { eventType: 'jury_enrolled', metadata: { rosterId: 'a', evictedWeek: 4 } },
      { eventType: 'phase_transition', metadata: { adminAction: 'pause_week' } },
      { eventType: 'hoh_assigned', metadata: { week: 6, rosterId: 'ck-unknown-roster' } },
    ]
    const out = rows.map((r) => describeBigBrotherAuditEvent(r, names))
    expect(out.map((o) => o.detail)).toEqual([
      'Week 4: Casey was evicted.',
      'Week 5: Quinn won the Veto.',
      'Week 5: Riley and Jordan are on the block.',
      'Week 4: Casey joined the jury.',
      'Pause week',
      'Week 6: a houseguest is Head of Household.',
    ])
    expect(out.map((o) => o.title)).toEqual(['Eviction', 'Veto won', 'Nominations', 'Joined the jury', 'House update', 'Head of Household'])
    for (const o of out) expect(`${o.title} ${o.detail}`).not.toMatch(/[{}"]|ck-unknown|_/)
  })

  it('never says who cast a ballot', () => {
    const d = describeBigBrotherAuditEvent({ eventType: 'eviction_vote_submitted', metadata: { week: 5, voterRosterId: 'a', targetRosterId: 'b' } }, names)
    expect(`${d.title} ${d.detail}`).not.toMatch(/Casey|Quinn/)
  })

  it('names phases in words', () => {
    expect(bigBrotherPhaseLabel('VOTING_OPEN')).toBe('Eviction vote open')
    expect(bigBrotherPhaseLabel('SOME_NEW_PHASE')).toBe('Some new phase')
  })
})

describe('Big Brother home', () => {
  function stubApi() {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      const body = url.includes('/summary') ? summary : url.includes('/audit') ? audit : { config: { premiumEngineSpec: null } }
      return { ok: true, json: async () => body }
    }))
  }

  it('is dark in every mode and shows the phase in words', async () => {
    stubApi()
    const { container } = render(<BigBrotherHome leagueId="L1" isCommissioner initialView="hoh" />)
    await screen.findByText('Morgan')
    expect((container.firstElementChild as HTMLElement).className.split(/\s+/)).toContain('af-draft-dark')
    expect(container.textContent).toContain('Phase: Eviction vote open')
    expect(container.textContent).not.toContain('VOTING_OPEN')
  })

  it('lists the house log in sentences', async () => {
    stubApi()
    const { container } = render(<BigBrotherHome leagueId="L1" isCommissioner initialView="history" />)
    await screen.findByText('Week 4: Casey was evicted.')
    expect(container.textContent).not.toMatch(/ckbbroster|evictedRosterId|veto_winner/)
  })

  it('keeps the commissioner selects inside their card on a phone', () => {
    const src = readFileSync(path.join(process.cwd(), 'components/big-brother/BigBrotherCommissionerPanel.tsx'), 'utf8')
    const selects = [...src.matchAll(/<select\s+value=\{(?:action|adminAction)\}[\s\S]*?className="([^"]+)"/g)].map((m) => m[1]!.split(/\s+/))
    expect(selects).toHaveLength(2)
    for (const c of selects) expect(c).toEqual(expect.arrayContaining(['w-full', 'max-w-full']))
  })
})
