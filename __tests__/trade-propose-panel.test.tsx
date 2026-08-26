/**
 * Phase 4 — the first write in the Trade Center.
 *
 * The plan called this "propose it for real" and assumed the write would go to
 * the platform. Building Phase 3 established that it cannot: Sleeper's public
 * API has read endpoints and no write endpoint at all. So this writes an
 * AllFantasy-native proposal, which reaches exactly the people who hold that
 * roster in AllFantasy — and on an imported league that is nobody.
 *
 * Every test here is about not writing a row somebody will never see, and not
 * sending a trade the manager did not build.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  normalizeName,
  reconcileProposal,
} from '@/components/core-app/screens/TradeProposePanel'
import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const PANEL = read('components/core-app/screens/TradeProposePanel.tsx')
const CENTER = read('components/core-app/screens/TradeCenter.tsx')
const ROSTERS = read('app/api/leagues/[leagueId]/trades/rosters/route.ts')
const DISPATCH = read('app/api/leagues/[leagueId]/[section]/route.ts')

const MINE = [
  { id: 'p-allen', name: 'Josh Allen', position: 'QB' },
  { id: 'p-nacua', name: 'Puka Nacua', position: 'WR' },
]
const THEIRS = [{ id: 'p-bijan', name: 'Bijan Robinson', position: 'RB' }]

const player = (name: string): PickedAsset => ({
  kind: 'player',
  playerId: null,
  name,
  position: null,
  team: null,
  value: null,
})

function run(give: PickedAsset[], get: PickedAsset[], theirs = THEIRS) {
  return reconcileProposal({
    give,
    get,
    myRosterId: 'r-mine',
    theirRosterId: 'r-theirs',
    myPlayers: MINE,
    theirPlayers: theirs,
  })
}

describe('normalizeName survives punctuation without colliding players', () => {
  it('ignores periods, apostrophes and hyphens', () => {
    expect(normalizeName('C.J. Stroud')).toBe('cj stroud')
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarr chase')
    expect(normalizeName('Amon-Ra St. Brown')).toBe('amon ra st brown')
  })

  it('drops a generational suffix', () => {
    expect(normalizeName('Marvin Harrison Jr.')).toBe('marvin harrison')
    expect(normalizeName('Odell Beckham III')).toBe('odell beckham')
  })

  it('still separates two different players', () => {
    expect(normalizeName('Michael Thomas')).not.toBe(normalizeName('Mike Thomas'))
  })
})

describe('⚠ the board and the proposable deal are different sets', () => {
  it('maps a clean two-sided deal to roster-scoped assets', () => {
    const { assets, blocked } = run([player('Josh Allen')], [player('Bijan Robinson')])
    expect(blocked).toEqual([])
    expect(assets).toEqual([
      { itemType: 'player', itemReference: 'p-allen', fromRosterId: 'r-mine', toRosterId: 'r-theirs' },
      { itemType: 'player', itemReference: 'p-bijan', fromRosterId: 'r-theirs', toRosterId: 'r-mine' },
    ])
  })

  it('blocks a player who is not on the sending roster', () => {
    // The builder searches a market feed, which knows every player alive. The
    // engine validates against the roster, which does not.
    const { assets, blocked } = run([player('Saquon Barkley')], [])
    expect(assets).toEqual([])
    expect(blocked[0]).toContain('not on your roster')
  })

  it('blocks a player the OTHER side does not actually hold', () => {
    const { blocked } = run([], [player('Josh Allen')])
    expect(blocked[0]).toContain('not on their roster')
  })

  it('⚠ refuses an ambiguous name rather than guessing which one', () => {
    /*
     * Sending away the wrong player is not recoverable by undo. Two rows with
     * the same name means we do not know which was meant.
     */
    const twins = [
      { id: 'a', name: 'Mike Williams', position: 'WR' },
      { id: 'b', name: 'Mike Williams', position: 'WR' },
    ]
    const { assets, blocked } = reconcileProposal({
      give: [],
      get: [player('Mike Williams')],
      myRosterId: 'r-mine',
      theirRosterId: 'r-theirs',
      myPlayers: MINE,
      theirPlayers: twins,
    })
    expect(assets).toEqual([])
    expect(blocked[0]).toContain('more than one player by that name')
  })

  it('carries FAAB straight through, with direction', () => {
    const { assets, blocked } = run([{ kind: 'faab', amount: 25 }], [])
    expect(blocked).toEqual([])
    expect(assets).toEqual([
      { itemType: 'faab', fromRosterId: 'r-mine', toRosterId: 'r-theirs', faabAmount: 25 },
    ])
  })

  it('⚠ blocks picks, because the builder has no pick id to prove ownership', () => {
    // The engine validates a pick by its id against the sending roster's own
    // pick list. A year and a round is not that, and inventing a reference
    // would be a claim we cannot back.
    const { assets, blocked } = run(
      [{ kind: 'pick', year: 2027, round: 1, label: '2027 round 1' }],
      [],
    )
    expect(assets).toEqual([])
    expect(blocked[0]).toContain('picks can be analysed here but not proposed yet')
  })

  it('⚠ a blocked asset poisons the whole proposal, not just itself', () => {
    /*
     * Sending the subset that happened to map would propose a trade nobody
     * built — one side lighter than what the manager agreed to.
     */
    const { assets, blocked } = run(
      [player('Josh Allen'), { kind: 'pick', year: 2027, round: 1, label: '2027 round 1' }],
      [player('Bijan Robinson')],
    )
    expect(blocked).toHaveLength(1)
    // The mappable assets are still computed — the UI is what refuses to send
    // them, and it refuses on `blocked.length > 0`.
    expect(assets.length).toBeGreaterThan(0)
    expect(PANEL).toContain('reconciled.blocked.length > 0')
  })
})

describe('⚠ never write a row the counterparty cannot open', () => {
  it('resolves the viewer roster with the engine’s own predicate', () => {
    /*
     * `createAfLeagueTrade` throws unless proposer.platformUserId equals the
     * proposing user id. Resolving it any looser lights up a button the write
     * then refuses.
     */
    expect(ROSTERS).toContain('rosters.find((r) => r.platformUserId === userId)?.id ?? null')
  })

  it('marks a roster reachable only when it belongs to an AllFantasy account', () => {
    expect(ROSTERS).toContain('canReceiveProposal: Boolean(account)')
  })

  it('keeps the three refusals apart', () => {
    // "You hold no roster here", "nobody here has an account", and "this deal
    // has an asset we cannot send" are different problems.
    expect(PANEL).toContain('none here is registered')
    expect(PANEL).toContain('Nobody else in this league has an AllFantasy account yet')
    expect(PANEL).toContain('This deal can')
  })

  it('names the managers it can see but cannot reach instead of hiding them', () => {
    expect(PANEL).toContain('not on\n              AllFantasy yet')
  })

  it('says plainly that this cannot go to Sleeper', () => {
    expect(PANEL).toContain('Sleeper')
    expect(PANEL).toContain('no write endpoint')
  })
})

describe('⚠ no optimistic success', () => {
  it('reports the server’s own refusal text rather than a generic failure', () => {
    expect(PANEL).toContain("setOutcome({ ok: false, message: j.error ??")
  })

  it('only claims success when the server said ok', () => {
    expect(PANEL).toContain('if (!r.ok || !j.ok)')
  })

  it('disables the button once a proposal has actually been sent', () => {
    // Otherwise a second click sends the same deal twice.
    expect(PANEL).toContain('outcome?.ok === true')
  })
})

describe('⚠ no new API route, and the panel earns its request', () => {
  it('posts to the existing trades handler behind the [section] dispatcher', () => {
    expect(PANEL).toContain('/trades`')
    expect(DISPATCH).toContain("'trades': () => import('../trades/handler')")
  })

  it('does not fetch until there is something to propose', () => {
    // Enriching every roster in the league is an expensive read, and there is
    // nothing to send until the board has an asset on it.
    expect(PANEL).toContain('if (!leagueId || !hasDeal || data != null')
  })

  it('sits after the verdict, not beside the builder', () => {
    const propose = CENTER.indexOf('<TradeProposePanel')
    const verdict = CENTER.indexOf('af-tc-verdict')
    expect(propose).toBeGreaterThan(verdict)
  })
})
