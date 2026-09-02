import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  followGlobal,
  muteLeague,
  toggleCategory,
} from '@/lib/notification-settings/leagueOverrideEdits'
import { mergeNotificationPreferences } from '@/lib/notification-settings/mergeNotificationPreferences'
import {
  customisedLeagueIds,
  isCategoryAllowedForLeague,
} from '@/lib/notifications/leagueOverrides'
import type { NotificationPreferences } from '@/lib/notification-settings/types'

/**
 * Per-league notification overrides (spec item 15).
 *
 * 🛑 THE ROUND TRIP IS THE POINT OF THIS FILE. Phase 5 shipped a resolver that rebuilt its
 * return object and silently dropped every key the dispatcher needed; the pure functions
 * were all correct, the write path was correct, and only putting a preference in one end
 * and reading the other showed it. The same shape bit this feature too, in a different
 * place — see the delete/`{}` test below — so every assertion here goes through the REAL
 * server merge rather than asserting on the edit's return value alone.
 */

const LEAGUE = 'league-abc'
const OTHER = 'league-xyz'

/** What the server would store, given what is on disk and what the client sends. */
function roundTrip(
  stored: NotificationPreferences,
  sent: NotificationPreferences,
): NotificationPreferences {
  return mergeNotificationPreferences(
    stored as unknown as Record<string, unknown>,
    sent as unknown as Record<string, unknown>,
  ) as unknown as NotificationPreferences
}

describe('muting one league', () => {
  it('silences that league and leaves the others alone', () => {
    const stored: NotificationPreferences = { globalEnabled: true }
    const saved = roundTrip(stored, muteLeague(stored, LEAGUE))

    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', LEAGUE)).toBe(false)
    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', OTHER)).toBe(true)
  })

  it('mutes a single category without silencing the league', () => {
    const stored: NotificationPreferences = { globalEnabled: true }
    const saved = roundTrip(stored, toggleCategory(stored, LEAGUE, 'chat_mentions', true))

    expect(isCategoryAllowedForLeague(saved, 'chat_mentions', LEAGUE)).toBe(false)
    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', LEAGUE)).toBe(true)
  })
})

describe('going back to "Follow my settings"', () => {
  /*
   * 🛑 THE BUG THIS FEATURE WOULD HAVE SHIPPED. The obvious implementation of "stop
   * overriding" is to delete the league's key. It is wrong here, and invisibly so: the save
   * merges one level deep, so the server restores the deleted key from what it already had.
   * The row flips in the UI, the request succeeds, and the mute is back on the next load.
   */
  it('actually clears a stored mute', () => {
    const stored: NotificationPreferences = {
      globalEnabled: true,
      leagues: { [LEAGUE]: { enabled: false } },
    }
    const saved = roundTrip(stored, followGlobal(stored, LEAGUE))

    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', LEAGUE)).toBe(true)
    expect(customisedLeagueIds(saved)).not.toContain(LEAGUE)
  })

  it('CONTROL: deleting the key instead would silently fail to clear it', () => {
    /*
     * A positive control for the test above. It proves that test passes because `{}` is
     * doing real work against a real merge — not because the merge is permissive and any
     * implementation would have worked. If this ever goes green, the server's merge
     * semantics changed and the `{}` rule should be revisited rather than trusted.
     */
    const stored: NotificationPreferences = {
      globalEnabled: true,
      leagues: { [LEAGUE]: { enabled: false } },
    }
    const naive = { ...stored, leagues: { ...(stored.leagues ?? {}) } }
    delete naive.leagues[LEAGUE]

    const saved = roundTrip(stored, naive)
    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', LEAGUE)).toBe(false)
  })

  it('clears the last muted category without stranding an entry', () => {
    const stored: NotificationPreferences = {
      globalEnabled: true,
      leagues: { [LEAGUE]: { mutedCategories: ['chat_mentions'] } },
    }
    const saved = roundTrip(stored, toggleCategory(stored, LEAGUE, 'chat_mentions', false))

    expect(isCategoryAllowedForLeague(saved, 'chat_mentions', LEAGUE)).toBe(true)
    expect(customisedLeagueIds(saved)).not.toContain(LEAGUE)
  })
})

describe('the invariants the resolver depends on', () => {
  it('absence inherits — an untouched league is not silenced', () => {
    // Every stored row in production predates this feature and has no `leagues` key.
    const saved = roundTrip({ globalEnabled: true }, muteLeague({ globalEnabled: true }, LEAGUE))
    expect(isCategoryAllowedForLeague(saved, 'waiver_processing', 'never-configured')).toBe(true)
  })

  it('a per-league opt-in cannot resurrect a globally-off account', () => {
    const stored: NotificationPreferences = { globalEnabled: false }
    const saved = roundTrip(stored, followGlobal(stored, LEAGUE))
    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', LEAGUE)).toBe(false)
  })

  it('does not disturb co-located settings owned by other features', () => {
    // The column holds aiSettings, chimmyAlertPreferences, dashboardToggles, world-cup
    // prefs. This tab sends only its own slice; a wholesale replace would erase them.
    const stored = {
      globalEnabled: true,
      aiSettings: { tone: 'blunt' },
      dashboardToggles: { showTrades: true },
    } as unknown as NotificationPreferences
    const saved = roundTrip(stored, muteLeague(stored, LEAGUE)) as unknown as Record<string, unknown>

    expect(saved.aiSettings).toEqual({ tone: 'blunt' })
    expect(saved.dashboardToggles).toEqual({ showTrades: true })
  })

  it('preserves another league\'s override while editing this one', () => {
    const stored: NotificationPreferences = {
      globalEnabled: true,
      leagues: { [OTHER]: { enabled: false } },
    }
    const saved = roundTrip(stored, muteLeague(stored, LEAGUE))

    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', OTHER)).toBe(false)
    expect(isCategoryAllowedForLeague(saved, 'trade_proposals', LEAGUE)).toBe(false)
  })
})

describe('where the surface lives', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('is mounted in personal settings, which every member can reach', () => {
    /*
     * The ask said "like in the league settings?", and that is where this must NOT go:
     * LeagueShell pushes the Settings tab `if (isCommissioner)` on the NFL redraft path,
     * so a personal preference parked there is unreachable for most of a league — the same
     * defect as the push opt-in that was already fixed once.
     */
    const section = read('app/settings/components/sections/NotificationsSettingsSection.tsx')
    expect(section).toContain('LeagueNotificationOverridesCard')
  })

  it('CONTROL: the commissioner gate that ruled league settings out still exists', () => {
    // If this ever fails, the gate moved and the placement decision deserves rereading —
    // without it, the test above is asserting a choice whose reason has quietly expired.
    const shell = read('app/league/[leagueId]/LeagueShell.tsx')
    expect(shell).toMatch(/if \(isCommissioner\) core\.push\(\{ id: 'settings'/)
  })

  it('passes the section\'s visible categories in rather than recomputing them', () => {
    // A toggle must govern an event something actually fires; `lineup_reminders` is hidden
    // because no sender exists. Deriving that rule twice is how the two copies drift.
    const section = read('app/settings/components/sections/NotificationsSettingsSection.tsx')
    expect(section).toMatch(/categoryIds=\{VISIBLE_CATEGORY_IDS\}/)
  })

  it('there is exactly one definition of the server merge', () => {
    // It was moved out of the route so this suite could exercise the real one. If a copy
    // reappears in the route, the round-trip tests above stop testing production.
    const route = read('app/api/user/profile/route.ts')
    expect(route).toContain('from "@/lib/notification-settings/mergeNotificationPreferences"')
    expect(route).not.toMatch(/function mergeNotificationPreferences\s*\(/)
  })
})
