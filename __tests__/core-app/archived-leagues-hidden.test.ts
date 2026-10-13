// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { archivedLeagueIds, isArchivedLeague, withArchivedHidden } from '@/lib/core-app/archivedLeagues'
import { withoutHidden } from '@/lib/core-app/leaguePreferences'

const live = { id: 'live', name: 'Live League', lifecycleState: 'in_season' }
const setup = { id: 'setup', name: 'Setup League', lifecycleState: 'setup' }
const archived = { id: 'blah2', name: 'Blah2', lifecycleState: 'archived' }
const noState = { id: 'legacy', name: 'No State' }

describe('isArchivedLeague', () => {
  it('is true only for the archived lifecycle state', () => {
    expect(isArchivedLeague(archived)).toBe(true)
    expect(isArchivedLeague(live)).toBe(false)
    expect(isArchivedLeague(setup)).toBe(false)
    expect(isArchivedLeague({ lifecycleState: 'completed' })).toBe(false)
  })

  it('treats a missing or null state as not archived', () => {
    expect(isArchivedLeague(noState)).toBe(false)
    expect(isArchivedLeague({ lifecycleState: null })).toBe(false)
  })

  it('matches regardless of case and surrounding space', () => {
    expect(isArchivedLeague({ lifecycleState: 'ARCHIVED' })).toBe(true)
    expect(isArchivedLeague({ lifecycleState: ' Archived ' })).toBe(true)
  })

  it('reads lifecycleState, never status: archiving leaves status as setup', () => {
    expect(isArchivedLeague({ lifecycleState: 'archived', status: 'setup' } as never)).toBe(true)
    expect(isArchivedLeague({ lifecycleState: 'in_season', status: 'archived' } as never)).toBe(false)
  })
})

describe('withArchivedHidden', () => {
  it('adds archived league ids after the account hidden ids', () => {
    expect(withArchivedHidden(['live'], [live, setup, archived, noState])).toEqual(['live', 'blah2'])
  })

  it('does not duplicate an archived league the account already hid', () => {
    expect(withArchivedHidden(['blah2'], [archived])).toEqual(['blah2'])
  })

  it('returns the account hidden ids unchanged when nothing is archived', () => {
    expect(withArchivedHidden(['live'], [live, setup])).toEqual(['live'])
    expect(archivedLeagueIds([live, setup, noState])).toEqual([])
  })
})

describe('the /core rail, through the shell’s own withoutHidden', () => {
  const rows = [live, setup, archived]

  it('drops an archived league from the rail', () => {
    const rail = withoutHidden(rows, withArchivedHidden([], rows), null)
    expect(rail.map((l) => l.id)).toEqual(['live', 'setup'])
  })

  it('keeps the archived league when it is the selected one, so a direct link still opens', () => {
    const rail = withoutHidden(rows, withArchivedHidden([], rows), 'blah2')
    expect(rail.map((l) => l.id)).toEqual(['live', 'setup', 'blah2'])
  })
})

describe('the /core page wiring', () => {
  const page = readFileSync(join(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')

  it('hands the rail and the scope switcher the archived-aware hidden ids', () => {
    expect(page).toMatch(/^\s*hiddenLeagueIds=\{shellHiddenIds\}/m)
    expect(page).toMatch(/^\s*hiddenIds: shellHiddenIds,/m)
    expect(page).not.toMatch(/^\s*hiddenLeagueIds=\{leaguePrefs\.hidden\}/m)
    expect(page).not.toMatch(/^\s*hiddenIds: leaguePrefs\.hidden,/m)
  })

  it('leaves playedLeagues (the ?league= authorization boundary) unfiltered', () => {
    expect(page).toMatch(/^\s*const playedLeagues = toPlayedLeagues\(leagues\)$/m)
    expect(page).toMatch(/^\s*const shellHiddenIds = withArchivedHidden\(leaguePrefs\.hidden, playedLeagues\)$/m)
  })
})
