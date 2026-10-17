/**
 * Teams with no name, named once and counted (2026-10-06).
 *
 * On production every team an importer wrote as "Unknown" is an open slot whose owner name is also
 * "Unknown" — 379 rows in 49 leagues — so the Commissioner Hub's balance chart printed "Unknown"
 * three times for one league, and its abandoned-teams flag read "Sin dueño: Equipo sin nombre,
 * Equipo sin nombre, Equipo sin nombre." Each slot is now named by its roster slot, and a list
 * that still holds several placeholders counts them.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { teamDisplayName, unnamedTeamLabel, unownedTeamNames } from '@/lib/core-app/commissioner/activity'
import { abandonedTeamsFlag, unpaidDuesFlag } from '@/lib/core-app/commissioner/health'

const act = { label: 'Open', href: '/x', external: false }
const openSlot = (externalId: string | null) => ({
  teamName: 'Unknown',
  ownerName: 'Unknown',
  isOrphan: true,
  claimedByUserId: null,
  platformUserId: null,
  externalId,
})

function detailOf(flag: ReturnType<typeof abandonedTeamsFlag>): string {
  if (!flag.measured) throw new Error(`expected a measured flag, got: ${flag.reason}`)
  return flag.detail
}

describe('teamDisplayName', () => {
  it('names an "Unknown" open slot by its roster slot, in the reader’s language', () => {
    expect(teamDisplayName(openSlot('3'))).toBe('Team 3')
    expect(teamDisplayName(openSlot('3'), 'es')).toBe('Equipo 3')
  })

  it('prefers a real team name, then a real owner name, over the slot', () => {
    expect(teamDisplayName({ teamName: 'Gridiron Goats', ownerName: 'Unknown', externalId: '3' })).toBe('Gridiron Goats')
    expect(teamDisplayName({ teamName: 'unknown', ownerName: 'QuietQuinn', externalId: '3' })).toBe('QuietQuinn')
  })

  it('falls back to the label when there is no slot, or the id is not a short slot number', () => {
    expect(teamDisplayName(openSlot(null))).toBe('Unnamed team')
    expect(teamDisplayName(openSlot('  '), 'es')).toBe('Equipo sin nombre')
    expect(teamDisplayName(openSlot('414.l.123.t.4'))).toBe('Unnamed team')
    expect(teamDisplayName(openSlot('8812345'))).toBe('Unnamed team')
  })

  it('lists four open slots as four different names', () => {
    const names = unownedTeamNames(['3', '9', '13', '17'].map(openSlot))
    expect(names).toEqual(['Team 3', 'Team 9', 'Team 13', 'Team 17'])
    expect(new Set(names).size).toBe(4)
  })
})

describe('placeholder names in a flag sentence', () => {
  const blanks = (n: number, language = 'en') => Array.from({ length: n }, () => unnamedTeamLabel(language))

  it('counts three unnamed teams instead of repeating the label', () => {
    const en = detailOf(abandonedTeamsFlag({ managers: [], orphanTeams: blanks(3), totalTeams: 10, action: act }))
    expect(en).toContain('No owner: 3 unnamed teams.')
    expect(en).not.toContain('Unnamed team,')

    const es = detailOf(abandonedTeamsFlag({ managers: [], orphanTeams: blanks(3, 'es'), totalTeams: 10, action: act, language: 'es' }))
    expect(es).toContain('Sin dueño: 3 equipos sin nombre.')
    expect(es).not.toContain('Equipo sin nombre,')
  })

  it('keeps named teams first and a single placeholder as it is', () => {
    const mixed = detailOf(abandonedTeamsFlag({ managers: [], orphanTeams: ['Alpha', ...blanks(2)], totalTeams: 10, action: act }))
    expect(mixed).toContain('No owner: Alpha, 2 unnamed teams.')
    const one = detailOf(abandonedTeamsFlag({ managers: [], orphanTeams: ['Alpha', ...blanks(1)], totalTeams: 10, action: act }))
    expect(one).toContain('No owner: Alpha, Unnamed team.')
  })

  it('counts teams, not list items, in the overflow', () => {
    // Five named + three unnamed = six items, four shown: A–D, so E and the three unnamed are left.
    const detail = detailOf(
      abandonedTeamsFlag({ managers: [], orphanTeams: ['A', 'B', 'C', 'D', 'E', ...blanks(3)], totalTeams: 12, action: act }),
    )
    expect(detail).toContain('No owner: A, B, C, D and 4 more.')
  })

  it('applies to the dues list too, which names teams the same way', () => {
    const flag = unpaidDuesFlag({
      tracker: { enabled: true, amount: null, currency: 'USD', paymentLink: null, paymentProvider: null, entries: [] },
      teams: [{ id: 't1', name: unnamedTeamLabel('es') }, { id: 't2', name: unnamedTeamLabel('es') }],
      action: act,
      language: 'es',
    })
    if (!flag.measured) throw new Error(`expected a measured dues flag, got: ${flag.reason}`)
    expect(flag.detail).toContain('2 equipos sin nombre')
    expect(flag.count).toBe(2)
  })
})

describe('the hub names teams by the one shared rule', () => {
  it('holds no second copy of the placeholder', () => {
    const src = readFileSync(resolve(__dirname, '../../lib/core-app/commissionerHub.ts'), 'utf8')
    // A second naming rule is how "Unknown" reached the balance chart while the flag hid it.
    expect(src).not.toMatch(/'Unnamed team'|'Equipo sin nombre'/)
    expect(src).toMatch(/function teamLabel\([\s\S]*?\{\s*return teamDisplayName\(t, language\)\s*\}/)
  })
})
