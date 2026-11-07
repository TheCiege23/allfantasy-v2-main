/**
 * Small leftovers from the 2026-11-07 visual audits (phone + desktop, dark + light).
 *
 * 1. Zombie Rules rendered every rule in the browser's monospace. The generated rules put each section in a
 *    <pre>, and the container styled it with `prose-*` classes from @tailwindcss/typography — which is not
 *    installed, so none applied.
 * 2. A points-only league's Standings (a guillotine with no weekly games) said "record decides the seeding"
 *    and closed on "Projected records … playoff and title odds" — it has no records and, as an elimination
 *    league, no playoffs.
 * 3. The C2C league hub's header squeezed its title and description into ~110px on a phone, beside the
 *    "League dashboard" link.
 * 4. The C2C player modal and AI panel showed internal wording: a database table name
 *    ("wire to PlayerWeeklyScore") and the plan's code ("AfSub") instead of its name, AF Commissioner.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ZombieRulesClient } from '@/app/zombie/[leagueId]/rules/ZombieRulesClient'
import { Standings } from '@/components/core-app/screens/Standings'
import C2CLeagueHubPage from '@/app/c2c/[leagueId]/page'
import { harnessStandings } from '@/app/e2e/redraft-core/standings/fixtures'

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(cleanup)

describe('Zombie rules text', () => {
  it('styles the generated <pre> sections directly, with the app font', () => {
    const { container } = render(
      <ZombieRulesClient
        leagueId="L1" sport="NFL" isPaid leagueName="Outbreak League" currentWeek={10} season={2026}
        rulesHtml='<section><h2>Overview</h2><pre class="whitespace-pre-wrap">Lose to the Horde and you turn.</pre></section>'
        rules={{ sport: 'NFL', bashingThreshold: 60, maulingThreshold: 60, weaponShieldThreshold: 140, weaponAmbushThreshold: 150, weaponAxeMargin: 40, reviveThreshold: 2, serumMaxHold: 3, lineupLockDesc: null }}
        experienceMode={null} serumAwardHighScore serumAwardOnBashMaul infectionLossToWhisperer infectionLossToZombie
      />,
    )
    const pre = container.querySelector('pre')!
    const body = pre.closest('section')!.parentElement as HTMLElement
    const classes = body.className.split(/\s+/)
    expect(classes).toContain('[&_pre]:font-sans')
    // No class from a plugin that is not installed — it would silently do nothing again.
    expect(classes.filter((c) => /^prose/.test(c))).toEqual([])
  })
})

describe('Standings in a points-only elimination league', () => {
  const elimination = { eliminated: ['9', '10'], bubble: ['4', '7', '8'] }

  it('says points set the order and drops the records-and-playoffs footer', () => {
    const { container } = render(<Standings data={harnessStandings({ headToHead: false })} odds={null} elimination={elimination} />)
    expect(container.textContent).toContain('points decide the order')
    expect(container.textContent).not.toContain('record decides the seeding')
    expect(container.textContent).not.toContain('Projected records on this page')
    expect(container.textContent).not.toContain('playoff and title odds')
  })

  // Control: a head-to-head league keeps both.
  it('keeps the record wording and the footer when the league plays head-to-head', () => {
    const { container } = render(<Standings data={harnessStandings()} odds={null} elimination={null} />)
    expect(container.textContent).toContain('record decides the seeding')
    expect(container.textContent).toContain('Projected records on this page')
  })
})

describe('C2C league hub header', () => {
  it('wraps, giving the title block a basis so the link drops under it on a phone', async () => {
    const page = await C2CLeagueHubPage({ params: Promise.resolve({ leagueId: 'L1' }) })
    const { container } = render(page)
    const header = container.querySelector('header')!
    expect(header.className.split(/\s+/)).toContain('flex-wrap')
    const title = header.querySelector('h1')!.parentElement as HTMLElement
    expect(title.className).toMatch(/\bbasis-\[\d+px\]/)
    expect(title.className.split(/\s+/)).toContain('min-w-0')
  })
})

describe('C2C user-facing copy', () => {
  const files = ['app/c2c/components/C2CPlayerModal.tsx', 'app/c2c/components/settings/C2CAIPanel.tsx']
  it.each(files)('%s names the plan and no database table', (rel) => {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8')
    expect(src).not.toMatch(/\(AfSub\)/)
    expect(src).not.toMatch(/PlayerWeeklyScore/)
    expect(src).toContain('(AF Commissioner)')
  })
})
