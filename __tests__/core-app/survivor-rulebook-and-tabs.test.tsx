import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SurvivorRulebook } from '@/components/core-app/survivor/SurvivorRulebook'
import { survivorRulebookMessages } from '@/lib/core-app/messages/survivorRulebook'
import { missingMessages } from '@/lib/i18n/messages'
import { localDeadline, rulebook } from '@/lib/core-app/survivorRulebook'
import { SURVIVOR_BANNER_TABS, SURVIVOR_NAV_LABELS } from '@/lib/core-app/survivorTheme'

/** Step 4: the season rulebook. Step 5: the island banner over every other league tab. */

afterEach(cleanup)

const config = {
  tribeCount: 2, tribeSize: 6, tribeFormation: 'random', mergeTrigger: 'week', mergeWeek: 10, mergePlayerCount: null,
  juryStartAfterMerge: 0, exileReturnEnabled: true, exileReturnTokens: 3, idolCount: 2, tribeShuffleEnabled: false,
  voteDeadlineDayOfWeek: 2, voteDeadlineTimeUtc: '15:00', selfVoteDisallowed: true, minigameFrequency: 'none', seasonThemeLabel: 'Heroes vs Villains',
}

describe('rulebook', () => {
  it('states every rule the config has, in order', () => {
    expect(rulebook(config)).toEqual([
      { id: 'tribes', count: 2, size: 6, formation: 'random' },
      { id: 'merge', byWeek: 10, byPlayers: null },
      { id: 'jury', afterMerge: 0 },
      { id: 'exile', on: true, tokens: 3 },
      { id: 'idols', count: 2 },
      { id: 'swap', on: false },
      { id: 'vote', day: 2, timeUtc: '15:00', selfVote: false },
    ])
  })

  it('reads a player-count merge, adds extra challenges, and guesses nothing that is missing', () => {
    const r = rulebook({ mergeTrigger: 'player_count', mergeWeek: 10, mergePlayerCount: 8, minigameFrequency: 'weekly' })
    expect(r).toEqual([{ id: 'merge', byWeek: null, byPlayers: 8 }, { id: 'challenges', frequency: 'weekly' }])
    expect(rulebook(null)).toEqual([])
    expect(rulebook({ voteDeadlineDayOfWeek: 9, voteDeadlineTimeUtc: 'soon' })).toEqual([{ id: 'vote', day: null, timeUtc: null, selfVote: false }])
  })

  it('words the deadline on the right weekday (Sunday is 0)', () => {
    process.env.TZ = 'UTC'
    expect(localDeadline(2, '15:00', 'en-US')).toMatch(/^Tuesday/)
    expect(localDeadline(0, '09:30', 'en-US')).toMatch(/^Sunday/)
    expect(localDeadline(null, '15:00')).toBeNull()
  })

  it('has every line in Spanish', () => {
    expect(missingMessages(survivorRulebookMessages, 'es')).toEqual([])
  })

  it('renders the board with an edit link for the commissioner, and folds on Camp', () => {
    const { container } = render(<SurvivorRulebook config={config} editHref="/survivor/L1/settings" />)
    expect(screen.getByText('Season rulebook · Heroes vs Villains')).toBeTruthy()
    expect(screen.getByText('2 tribes of 6, drawn at random')).toBeTruthy()
    expect(screen.getByText('Week 10')).toBeTruthy()
    expect(screen.getByText('On: 3 tokens earn a way back')).toBeTruthy()
    expect(container.querySelectorAll('.sv-rule').length).toBe(7)
    expect(screen.getByText('Edit the rules →').getAttribute('href')).toBe('/survivor/L1/settings')
    cleanup()
    const folded = render(<SurvivorRulebook config={config} collapsible />)
    expect(folded.container.querySelector('details.sv-rulebook')).toBeTruthy()
    expect(folded.container.querySelector('.sv-link')).toBeNull()
    cleanup()
    expect(render(<SurvivorRulebook config={{}} />).container.innerHTML).toBe('')
  })
})

describe('the island banner on every league tab', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')

  it('covers every renamed tab, through the screens that place it themselves or the shared slot', () => {
    // home → Camp (full), standings / matchup / commissioner → compact in place; everything else → the shared slot.
    const placedThemselves = new Set(['home', 'standings', 'matchup', 'commissioner'])
    for (const key of Object.keys(SURVIVOR_NAV_LABELS)) {
      expect(placedThemselves.has(key) || SURVIVOR_BANNER_TABS.has(key), key).toBe(true)
    }
    for (const key of placedThemselves) expect(SURVIVOR_BANNER_TABS.has(key), key).toBe(false)
  })

  it('renders the shared slot once, before the screens, and never on the bracket, hubs or Discord views', () => {
    const slot = "{SURVIVOR_BANNER_TABS.has(activeKey) && segment !== 'bracket' && segment !== 'hubs' && segment !== 'discord' ? survivorBanner('compact') : null}"
    expect(page.split(slot).length).toBe(2)
    expect(page.indexOf(slot)).toBeLessThan(page.indexOf("{segment === 'bracket' ? ("))
  })
})
