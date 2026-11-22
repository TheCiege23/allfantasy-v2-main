/** "Who is already here" on the league's invite panel (lib/league/managersHere.ts). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { managersHere, MANAGERS_HERE_LIMIT } from '@/lib/league/managersHere'

const names = new Map([['u1', 'Ana'], ['u2', ''], ['u3', 'Ben']])

describe('managersHere', () => {
  it('lists each manager with an account once, the viewer first, then by name', () => {
    expect(managersHere([
      { teamName: 'Zed FC', ownerName: 'zed-sleeper', claimedByUserId: 'u3' },
      { teamName: 'Open Team', ownerName: 'nobody', claimedByUserId: null },
      { teamName: 'Ana United', ownerName: 'ana-sleeper', claimedByUserId: 'u1' },
      { teamName: 'Second Team', ownerName: 'ana-sleeper', claimedByUserId: 'u1' },
      { teamName: ' ', ownerName: 'cy-sleeper', claimedByUserId: 'u2' },
    ], names, 'u2')).toEqual([
      { name: 'cy-sleeper', teamName: null, you: true },
      { name: 'Ana', teamName: 'Ana United', you: false },
      { name: 'Ben', teamName: 'Zed FC', you: false },
    ])
  })
  it('is empty when nobody has claimed a team, and is capped', () => {
    expect(managersHere([{ teamName: 'A', ownerName: 'a', claimedByUserId: null }], names, null)).toEqual([])
    const many = Array.from({ length: MANAGERS_HERE_LIMIT + 5 }, (_, i) => ({ teamName: `T${i}`, ownerName: `o${String(i).padStart(3, '0')}`, claimedByUserId: `x${i}` }))
    expect(managersHere(many, new Map(), null)).toHaveLength(MANAGERS_HERE_LIMIT)
  })
})

describe('where it is shown', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the invite route sends it only on the members-only read', () => {
    const route = read('app/api/leagues/join/route.ts')
    expect(route).toMatch(/^\s*claim: \{ teamCount, claimedCount, managersHere: managersHere\(claimedTeams, nameById, userId\) \},$/m)
    // The read that carries it is the one gated on owning the league or holding a team in it.
    expect(route.indexOf('OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }]')).toBeLessThan(route.indexOf('managersHere(claimedTeams'))
  })
  it('the invite panel lists the names, and a manager who just joined by import sees the panel', () => {
    expect(read('components/core-app/LeagueInvitePanel.tsx')).toContain('data-testid="league-managers-here"')
    const imp = read('components/core-app/screens/ImportV4.tsx')
    expect(imp).toMatch(/^\s*\{phase\.k === 'done' && phase\.leagueId && phase\.joinedExisting \? \($/m)
    expect(imp).toContain('<LeagueInvitePanel leagueId={phase.leagueId} leagueName={phase.leagueName} />')
  })
})
