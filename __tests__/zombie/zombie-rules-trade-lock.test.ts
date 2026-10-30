import { describe, expect, it, vi } from 'vitest'
import type { ZombieRulesDocument } from '@prisma/client'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { getRulesDocAsHtml, getRulesDocAsText } from '@/lib/zombie/rulesDocGenerator'

const base = {
  isPaid: false,
  sectionOverview: 'Overview',
  sectionInfection: 'Infection',
  sectionWhisperer: 'The Whisperer leads the Horde.',
  sectionSurvivor: 'Humans survive.',
  sectionZombie: 'Zombies infect.',
  sectionScoring: 'Weekly scoring.',
  sectionRoster: 'Roster.',
  sectionAmbush: 'Ambushes.',
  sectionBashing: 'Bashing.',
  sectionMauling: 'Mauling.',
  sectionSerums: 'Serums.',
  sectionWeapons: 'Weapons.',
  sectionWinnings: 'Winnings.',
  sectionUniverseMovement: 'Universe.',
  sectionWeeklyTiming: 'Weekly.',
  sectionChimmy: 'Chimmy.',
  sectionPaidVsFree: 'Free.',
} as unknown as ZombieRulesDocument

describe('Zombie rules rendering', () => {
  it('shows the permanent Whisperer trade rule in an older stored document', () => {
    const html = getRulesDocAsHtml(base)
    expect(html).toContain('Whisperers cannot trade players at any time.')
    expect(html).toContain('<span aria-hidden="true">🎭</span> The Whisperer')
    expect(getRulesDocAsText(base)).toContain('Whisperers cannot trade players at any time.')
  })

  it('does not duplicate the rule in a newly generated document', () => {
    const doc = {
      ...base,
      sectionWhisperer: 'The Whisperer leads the Horde.\nWhisperers cannot trade players at any time.',
    } as ZombieRulesDocument
    const rendered = getRulesDocAsText(doc)
    expect(rendered.match(/Whisperers cannot trade players at any time\./g)).toHaveLength(1)
  })
})
