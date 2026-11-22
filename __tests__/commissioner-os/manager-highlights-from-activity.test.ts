/**
 * Mission Control's manager highlights from the member-activity judgement (`managerHighlightReads.ts`).
 *
 * The card used to read the retired `/api/v1/intelligence/league/managers` route (410). It now shows the same
 * facts as the Commissioner page — who has not moved, who has — in fixed callouts the Spanish screen translates.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  ACTIVE_CALLOUT,
  AT_RISK_CALLOUT,
  INACTIVE_CALLOUT,
  managerHighlightsFromActivity,
} from '@/lib/commissioner-mission-control/managerHighlightReads'
import type { MemberActivityRow } from '@/lib/core-app/commissioner/activity'
import { calloutText } from '@/lib/commissioner-os/i18n/shellCopy'

const row = (name: string, status: MemberActivityRow['status'], lastActionAt: string | null = null): MemberActivityRow => ({
  name,
  status,
  detail: 'measured detail',
  lastActionAt,
})

describe('managerHighlightsFromActivity', () => {
  it('quiet managers first with a risk tone, then the most recently active; unjudged managers are left out', () => {
    const out = managerHighlightsFromActivity([
      row('Pine Bears', 'active', '2026-11-10T00:00:00.000Z'),
      row('Dune Foxes', 'inactive'),
      row('Mesa Comets', 'unknown'),
      row('Lake Herons', 'at_risk'),
      row('Harbor Owls', 'active', '2026-11-18T00:00:00.000Z'),
    ])
    expect(out.map((h) => [h.managerName, h.tone, h.callout])).toEqual([
      ['Dune Foxes', 'risk', INACTIVE_CALLOUT],
      ['Lake Herons', 'risk', AT_RISK_CALLOUT],
      ['Harbor Owls', 'positive', ACTIVE_CALLOUT],
      ['Pine Bears', 'positive', ACTIVE_CALLOUT],
    ])
  })

  it('is a highlight list, not the roster: at most 5 quiet and 3 active', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => row(`Quiet ${i}`, 'inactive')),
      ...Array.from({ length: 8 }, (_, i) => row(`Busy ${i}`, 'active', `2026-11-1${i}T00:00:00.000Z`)),
    ]
    const out = managerHighlightsFromActivity(rows)
    expect(out.filter((h) => h.tone === 'risk')).toHaveLength(5)
    expect(out.filter((h) => h.tone === 'positive')).toHaveLength(3)
  })

  it('an empty league is an empty list', () => {
    expect(managerHighlightsFromActivity([])).toEqual([])
  })

  it('every callout has a Spanish rendering on the Mission Control screen', () => {
    for (const callout of [INACTIVE_CALLOUT, AT_RISK_CALLOUT, ACTIVE_CALLOUT]) {
      const es = calloutText(callout, 'es')
      expect(es, callout).not.toBe(callout)
      expect(es.toLowerCase()).not.toContain('waiver')
    }
  })
})
