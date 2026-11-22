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
  it('shows the approved 2025 trade policy in an older stored document', () => {
    const html = getRulesDocAsHtml(base)
    expect(html).toContain('Survivors and Whisperers may trade; Zombies cannot.')
    expect(html).toContain('<span aria-hidden="true">🎭</span> The Whisperer')
    expect(getRulesDocAsText(base)).toContain('Survivors and Whisperers may trade; Zombies cannot.')
  })

  it('removes the retired Whisperer prohibition from an old document', () => {
    expect(getRulesDocAsText({ ...base, sectionWhisperer: 'Whisperers cannot trade players at any time.' })).not.toContain('Whisperers cannot trade')
  })

  it('does not duplicate the rule in a newly generated document', () => {
    const doc = {
      ...base,
      sectionWhisperer: 'The Whisperer leads the Horde.\nSurvivors and Whisperers may trade; Zombies cannot.',
    } as ZombieRulesDocument
    const rendered = getRulesDocAsText(doc)
    expect(rendered.match(/Survivors and Whisperers may trade; Zombies cannot\./g)).toHaveLength(1)
  })
})
