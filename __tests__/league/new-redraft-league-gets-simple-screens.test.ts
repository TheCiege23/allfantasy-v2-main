/**
 * 🛑 THE GUARD THAT MAKES THE SIMPLE SCREENS STICK (owner, 2026-11-28: "seems like everytime I create a new
 * redraft league, the previous changes are not fully enacted. this needs to take effect for existing leagues and
 * redraft leagues that will be created in the future").
 *
 * The league below is built from the fields `createCanonicalLeagueInTransaction` writes for a new redraft league
 * (platform 'manual', leagueType 'redraft', lifecycleState 'setup'), in every sport. Every gate that decides
 * which screen a league gets is asserted against it, so a later change that drops a fresh league back onto an old
 * screen fails here. The source check at the end keeps this fixture honest: if creation starts writing different
 * values, this test is the first to say so.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'
import { isRedraftFormatUserLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { noScheduleYet } from '@/lib/league/scheduleState'
import { buildNativeLeagueNavigation, nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'

const SPORTS = ['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER']
const freshRedraft = (sport: string) =>
  ({ id: 'new', name: 'New league', sport, platform: 'manual', leagueType: 'redraft', lifecycleState: 'setup', format: 'redraft', teamCount: 12, settings: {} }) as unknown as UserLeague

describe('a brand-new redraft league, every sport, gets every simplified screen', () => {
  for (const sport of SPORTS) {
    it(`${sport}: hosted, redraft, pre-draft, no schedule, no Matchup or chat in the nav`, () => {
      const league = freshRedraft(sport)
      expect(isNativePlatform(league.platform)).toBe(true) // workspace + hosted-only screens
      expect(isRedraftFormatUserLeague(league)).toBe(true) // simple redraft League home (not "What's next?")
      expect(['Setup', 'Draft']).toContain(nativeLeaguePhase(league)) // pre-draft Draft home, Team and Players views
      expect(noScheduleYet(league)).toBe(true) // no Matchups / Activity on League
      const draftDone = !['Setup', 'Draft'].includes(nativeLeaguePhase(league))
      const nav = buildNativeLeagueNavigation(
        ['native_home', 'draft', 'matchups', 'roster', 'waivers', 'standings', 'league_chat', 'settings'].map((id) => ({ id, label: id })),
        true,
        false,
        undefined,
        { draftDone, scheduleMade: draftDone || !isNativePlatform(league.platform) },
      )
      const labels = nav[0].items.map((item) => item.label)
      expect(labels).not.toContain('Matchup')
      expect(nav.flatMap((g) => g.items.flatMap((i) => i.children.map((c) => c.id)))).not.toContain('league_chat')
    })
  }

  it('the fixture matches what league creation actually writes', () => {
    const src = readFileSync(resolve(__dirname, '../../lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts'), 'utf8')
    expect(src).toContain("platform: 'manual',")
    expect(src).toContain('leagueType: formatId,')
    expect(src).toContain("lifecycleState: 'setup',")
  })

  it('the screens read those gates (not an NFL-only one)', () => {
    const shell = readFileSync(resolve(__dirname, '../../app/league/[leagueId]/LeagueShell.tsx'), 'utf8')
    // Draft tab before the draft: one shared screen for every league.
    expect(shell).toMatch(/if \(isPredraftLifecycle\) return (?:\w+\()?renderPredraftDraftSetup\(\)/)
    expect(shell).toContain('<PredraftDraftHome')
    // League home: the simple home for every league; plain redraft keeps its own next-up card.
    expect(shell).toContain('const plainRedraft = isRedraftFormatUserLeague(selectedLeague)')
    // Draft room: a new redraft league's snake / linear room is the simple room (it keys on leagueType 'redraft').
    const room = readFileSync(resolve(__dirname, '../../components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
    expect(room).toContain("String(leagueType ?? '').trim().toLowerCase() === 'redraft'")
    // No post-create share popup.
    expect(shell).not.toContain('PostCreateWelcomeSheet')
  })
})
