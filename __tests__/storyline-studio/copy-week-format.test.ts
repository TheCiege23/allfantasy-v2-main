import { describe, expect, it } from 'vitest'

import { formatRivalryWeekForPlatform, formatWeekForPlatform } from '@/lib/storyline-studio/copyFormat'

describe('copying a week to paste on another platform', () => {
  it('lists each matchup with its storylines as plain text, and leaves out a matchup with none', () => {
    const text = formatWeekForPlatform(
      {
        heading: 'Week 8 storylines',
        sections: [
          { title: 'Aces vs Bears', lines: ['**Aces** have won 4 straight over Bears.', 'Revenge game.'] },
          { title: 'Colts vs Ducks', lines: [] },
          { title: 'League-wide', lines: ['Aces lead the league in points.'] },
        ],
      },
      'fantrax',
    )
    expect(text).toBe(
      'Week 8 storylines\n\nAces vs Bears\n- Aces have won 4 straight over Bears.\n- Revenge game.\n\nLeague-wide\n- Aces lead the league in points.',
    )
  })

  it('is empty when there is nothing to say', () => {
    expect(formatWeekForPlatform({ heading: 'Week 1', sections: [{ title: 'A vs B', lines: [] }] }, null)).toBe('')
  })

  it('lists rivalry week pairings with the reasons, and the bye', () => {
    const text = formatRivalryWeekForPlatform(
      {
        heading: 'Rivalry week - Week 8',
        byeLabel: 'bye',
        pairs: [
          { homeName: 'Aces', awayName: 'Bears', reasons: ['3 MEETINGS', 'DIVISION RIVALS'], context: null },
          { homeName: 'Colts', awayName: 'Ducks', reasons: [] },
          { homeName: 'Eels', awayName: null },
        ],
      },
      null,
    )
    expect(text).toBe('Rivalry week - Week 8\nAces vs Bears (3 MEETINGS, DIVISION RIVALS)\nColts vs Ducks\nEels - bye')
  })
})
