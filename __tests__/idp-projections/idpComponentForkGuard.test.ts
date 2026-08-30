/**
 * IDP components existed TWICE, under the same names, in two live trees.
 *
 * `app/idp/components/` and `components/idp/` each held IDPMatchupView, IDPPlayerModal,
 * IDPWaiverSection and settings/IDPAIPanel. Both trees rendered: the league TABS imported the
 * `app/idp` copies, while `IDPHome` — reached from LeagueShell and OverviewTab — imported the
 * `components/idp` ones. So one manager in one league got two different IDP experiences
 * depending on where they clicked, and a fix applied to either name reached only half the app.
 *
 * 🛑 THE FORK WAS NOT "ONE TREE IS BETTER". That was the assumption going in and it was wrong
 * in both directions. The bigger `app/idp` copies won for the matchup view and the player modal,
 * but its IDPWaiverSection carried a fabricated `trending` board — "D. Defender +412% 14.2 pts",
 * "N. Edge +301%" — captioned "Most added (claim volume snapshot)", plus a position filter and a
 * sort dropdown wired to nothing (zero `.filter(` or `.sort(` calls in the file). The smaller
 * copy was the honest one. Resolution had to be per component, on evidence.
 *
 * This guard does not judge which copy is better. It asserts the fork is GONE, because the
 * duplication is what let the two drift 3-6x in size without anything failing.
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const has = (rel: string) => existsSync(resolve(ROOT, rel))

/** Every component name that has ever lived in both trees. */
const FORK_CANDIDATES = [
  'IDPMatchupView.tsx',
  'IDPPlayerModal.tsx',
  'IDPWaiverSection.tsx',
  'IDPPlayerCard.tsx',
  'IDPTeamDashboard.tsx',
  'IDPDraftFilters.tsx',
  'settings/IDPAIPanel.tsx',
  'settings/IDPCapPanel.tsx',
  'settings/IDPDisplayPanel.tsx',
  'settings/IDPRosterPanel.tsx',
  'settings/IDPScoringPanel.tsx',
]

/**
 * EMPTY, AND THAT IS THE POINT. IDPAIPanel was the last entry: its two copies took different
 * props and its `components/idp` caller, LeagueSettingsTab, had no `hasAfSub` in scope, so it
 * was exempted rather than forced. It is now resolved — `hasAfSub` became optional-meaning-
 * unknown so the tab can render the richer panel without asserting an entitlement it cannot
 * measure. The set stays here so the next fork has somewhere to be declared VISIBLY rather than
 * living as an undocumented second copy.
 */
const KNOWN_STILL_FORKED = new Set<string>([])

describe('IDP components are not forked across the two trees', () => {
  /** 🛑 THE ASSERTION. A name may exist in app/idp OR components/idp, never both. */
  it('has at most one copy of each component name', () => {
    const forked = FORK_CANDIDATES.filter(
      (n) => has(`app/idp/components/${n}`) && has(`components/idp/${n}`)
    ).filter((n) => !KNOWN_STILL_FORKED.has(n))
    expect(forked).toEqual([])
  })

  /**
   * The exemption list must stay HONEST. Any entry that is no longer forked fails here and has
   * to be removed — an exemption nobody revisits is how the original fork survived. This is what
   * forced IDPAIPanel out of the list the moment it was collapsed, rather than leaving a stale
   * allowlist entry implying work still outstanding.
   */
  it('does not carry a stale exemption', () => {
    for (const n of KNOWN_STILL_FORKED) {
      const stillBoth = has(`app/idp/components/${n}`) && has(`components/idp/${n}`)
      expect(stillBoth, `${n} is no longer forked — remove it from KNOWN_STILL_FORKED`).toBe(true)
    }
  })

  /** All four resolutions, pinned so a revert is loud rather than silent. */
  it('keeps the copy that won each resolution', () => {
    // Richer, no fabricated data.
    expect(has('app/idp/components/IDPMatchupView.tsx')).toBe(true)
    expect(has('components/idp/IDPMatchupView.tsx')).toBe(false)
    expect(has('app/idp/components/IDPPlayerModal.tsx')).toBe(true)
    expect(has('components/idp/IDPPlayerModal.tsx')).toBe(false)
    // The honest one: the app/idp copy invented a trending board and had inert controls.
    expect(has('components/idp/IDPWaiverSection.tsx')).toBe(true)
    expect(has('app/idp/components/IDPWaiverSection.tsx')).toBe(false)
    // Richer: preference toggles persisted per-device and per-league, plus a real gate badge.
    expect(has('app/idp/components/settings/IDPAIPanel.tsx')).toBe(true)
    expect(has('components/idp/settings/IDPAIPanel.tsx')).toBe(false)
  })
})
