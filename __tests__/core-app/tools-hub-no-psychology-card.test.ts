// @vitest-environment node
/**
 * The /core Tools hub advertised a "Manager Psychology" card — "How you actually play —
 * tendencies read from your own transaction history". Milestone 32 shows manager
 * characterisation labels to nobody, and the unified psychological tool was retired in #1659.
 * The card's link, `/af-legacy?tab=compare`, is not that tool at all: it is the same
 * record-and-titles comparison (`/api/legacy/compare`) that the "Manager Compare" card already
 * opens via `/manager-compare`. So the card was selling a label tool that no longer exists, on
 * top of a duplicate link.
 *
 * Asserted on the whole hub, not one id, so a renamed card carrying the same promise fails too.
 * "Manager Compare" is the positive control.
 */
import { describe, expect, it } from 'vitest'

import { buildToolsHub } from '@/lib/core-app/toolsHub'

const hub = buildToolsHub({
  issues: [],
  stats: { leaguesPlayed: 3, tradesOnFile: 12, connectedLeagues: 2 },
  selectedLeagueId: null,
})
const cards = hub.groups.flatMap((g) => g.tools)

describe('Tools hub — no manager-psychology card', () => {
  it('has no card that offers psychology, tendencies or an archetype', () => {
    const offending = cards.filter((c) =>
      /psycholog|tendenc|archetype|how you (actually )?play/i.test(
        [c.id, c.title, c.desc, c.live?.text ?? ''].join(' '),
      ),
    )
    expect(offending.map((c) => c.id)).toEqual([])
  })

  it('still offers Manager Compare, the factual comparison that link duplicated (positive control)', () => {
    const compare = cards.find((c) => c.id === 'compare')
    expect(compare?.href).toBe('/manager-compare')
    expect(compare?.live?.text).toMatch(/3 leagues to compare across/)
  })
})
