/**
 * League Settings in the redraft identity (wave-2 A5): the markup hooks appear only when a redraft view
 * is passed, existing testids survive, and with no view the page renders exactly as before — the markup
 * half of "dynasty and every other league type are byte-identical" (the CSS half is
 * __tests__/league-media/redraftSettingsCss.test.ts; the pixel half is scripts/redraft-settings-capture.mjs).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildLeagueSettingsHome, type BuildSettingsHomeInput } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { LeagueSettingsHome } from '@/components/league-settings/home/LeagueSettingsHome'
import { CommissionerCenter } from '@/components/league-settings/home/CommissionerCenter'
import { buildRedraftSettingsView } from '@/lib/league-media/redraftSettings'

const teams = Array.from({ length: 12 }, (_, i) => ({ claimedByUserId: i < 11 ? `u${i}` : null, isCoCommissioner: false, ownerName: `Owner ${i}` }))

function input(canEdit: boolean): BuildSettingsHomeInput {
  return {
    league: { id: 'lg1', name: 'Sunday Night Redraft', sport: 'NBA', leagueSize: 12, leagueVariant: null, tradeDeadlineWeek: 16, playoffStartWeek: 19, settings: {} },
    teams,
    canEdit,
    formatLabel: 'Redraft',
    scoringLabel: null,
    rosterSlots: { PG: 1, SG: 1, C: 1, BN: 3 },
    draft: { dateIso: '2026-09-02T00:00:00.000Z', type: 'snake', rounds: 13, timerSeconds: 60, autostart: true },
    guillotine: null,
    inviteUrl: 'https://allfantasy.ai/join?code=ABC',
    viewerTimeZone: 'America/New_York',
  }
}

const view = buildRedraftSettingsView(
  { platform: 'allfantasy', sport: 'NBA', leagueType: 'redraft', playoffStartWeek: 19, tradeDeadlineWeek: 16, settings: {} },
  'Regular season',
)!
const renderSubPage = vi.fn((id: string) => ({ title: `Edit ${id}`, content: <p>editor for {id}</p> }))

const home = (redraft?: Parameters<typeof LeagueSettingsHome>[0]['redraft']) =>
  renderToStaticMarkup(
    <LeagueSettingsHome leagueName="Sunday Night Redraft" sections={buildLeagueSettingsHome(input(false))} canEdit={false} renderSubPage={renderSubPage as never} onExit={() => {}} redraft={redraft} />,
  )
const center = (redraft?: Parameters<typeof CommissionerCenter>[0]['redraft']) =>
  renderToStaticMarkup(
    <CommissionerCenter
      leagueName="Sunday Night Redraft"
      sections={buildLeagueSettingsHome(input(true))}
      renderSubPage={renderSubPage as never}
      inSeason
      initialSubPage="trades"
      managers={{ joined: 11, total: 12, inviteUrl: 'https://allfantasy.ai/join?code=ABC' }}
      redraft={redraft}
    />,
  )

describe('League Settings — redraft hooks', () => {
  it('renders no redraft markup without a view (null and absent are the same page)', () => {
    for (const html of [home(), home(null), center(), center(null)]) {
      expect(html).not.toMatch(/data-rd-|lsh-rd-|cc-rd-/)
    }
    expect(home(null)).toBe(home())
    expect(center(null)).toBe(center())
  })

  it('marks the root and stamps each season section with its eyebrow and stage', () => {
    const html = home(view)
    expect(html).toContain('data-rd-settings="true"')
    expect(html).toContain('data-rd-sport="nba"')
    expect(html).toMatch(/data-testid="lsh-section-waivers-trades" data-rd-stage="now"/)
    expect(html).toMatch(/data-testid="lsh-section-draft" data-rd-stage="done"/)
    expect(html).toMatch(/data-testid="lsh-section-playoffs" data-rd-stage="next"/)
    expect(html).toContain('Weeks 1–18 · trade deadline Wk 16')
    expect(html).toContain('From Week 19')
    // Members carry an eyebrow but no stage: they are not a point in the season.
    expect(html).toMatch(/data-testid="lsh-section-members">/)
  })

  it('keeps every existing testid and row', () => {
    const plain = home()
    const themed = home(view)
    const ids = (html: string) => [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]).filter((id) => !id.startsWith('lsh-rd-'))
    expect(ids(themed)).toEqual(ids(plain))
  })

  it('removing the eyebrows only leaves the default page plus the stage attributes (mutation control)', () => {
    const stripped = home(view)
      .replace(/<p class="lsh-rd-when"[^>]*>[^<]*<\/p>/g, '')
      .replace(/ data-rd-(?:settings|sport|stage)="[^"]*"/g, '')
    expect(stripped).toBe(home())
    // And the control can fail: leaving one eyebrow in place is caught.
    const leaky = home(view).replace(/ data-rd-(?:settings|sport|stage)="[^"]*"/g, '')
    expect(leaky).not.toBe(home())
  })

  it('Commissioner center: stage dots on the season nav items and the pane eyebrow', () => {
    const html = center(view)
    expect(html).toContain('data-rd-settings="true"')
    expect(html).toMatch(/data-testid="cc-nav-trades" data-rd-stage="now"/)
    expect(html).toMatch(/data-testid="cc-nav-draft" data-rd-stage="done"/)
    expect(html).not.toMatch(/data-testid="cc-nav-members" data-rd-stage/)
    expect(html).toContain('data-testid="cc-rd-when"')
    expect(html).toContain('Weeks 1–18 · trade deadline Wk 16')
  })
})
