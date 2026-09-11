/**
 * The Discord bridge direction vocabulary: every reachable flag combination has
 * a name, and every name round-trips.
 *
 * 🛑 WHAT THIS EXISTS TO STOP, MEASURED. `directionFromFlags` used to collapse
 * inbound-only — `{ syncEnabled: true, syncOutbound: false, syncInbound: true }`
 * — onto 'off'. `/core/discord` rendered "Off · Nothing relays" while
 * `/api/discord/poll-messages` (`where: { syncEnabled: true, syncInbound: true }`,
 * which never reads `syncOutbound`) kept pulling Discord messages into league
 * chat. The state was reachable the whole time: the legacy sync panel at
 * `/league/[leagueId]` PATCHes each of the three booleans independently.
 *
 * ⚠ A ROUND-TRIP TEST ALONE WOULD HAVE PASSED ON THE BUGGY CODE. 'off' mapped to
 * all-false and all-false mapped back to 'off', so the cycle was clean; the
 * defect was that a FOURTH input also landed on 'off'. That is why the table
 * below enumerates all eight flag combinations rather than only the ones this
 * module can produce — the writer's state space is larger than the picker's, and
 * the gap is where the lie lived.
 */
import { describe, expect, it } from 'vitest'

import {
  directionFromFlags,
  flagsFromDirection,
  type BridgeDirection,
} from '@/lib/core-app/discordBridgeContract'
import { DIRECTIONS } from '@/components/core-app/screens/DiscordBridge'

const ALL: BridgeDirection[] = ['both', 'post-only', 'pull-only', 'off']

/** Every combination of the three booleans the schema stores. */
const EVERY_FLAG_COMBINATION = [false, true].flatMap((syncEnabled) =>
  [false, true].flatMap((syncOutbound) =>
    [false, true].map((syncInbound) => ({ syncEnabled, syncOutbound, syncInbound }))
  )
)

describe('directionFromFlags names every reachable state', () => {
  it('reports inbound-only as pull-only, not off', () => {
    /*
     * 🛑 THE REGRESSION TEST. This is the exact row that shipped wrong, and the
     * exact row the poll-messages route acts on.
     */
    expect(
      directionFromFlags({ syncEnabled: true, syncOutbound: false, syncInbound: true })
    ).toBe('pull-only')
  })

  it('never reports a relaying bridge as off', () => {
    /*
     * The invariant behind the bug, stated directly rather than as a list of
     * cases: if the inbound relay would run, the screen must not say "off".
     * `poll-messages` gates on syncEnabled && syncInbound and ignores outbound.
     */
    const relayingInbound = EVERY_FLAG_COMBINATION.filter((f) => f.syncEnabled && f.syncInbound)
    expect(relayingInbound.length).toBeGreaterThan(0)
    for (const flags of relayingInbound) {
      expect(directionFromFlags(flags), `${JSON.stringify(flags)} reported as off`).not.toBe('off')
    }
  })

  it.each(EVERY_FLAG_COMBINATION)(
    'maps %j to a direction the picker can render',
    (flags) => {
      const direction = directionFromFlags(flags)
      expect(ALL).toContain(direction)
      expect(DIRECTIONS.map((d) => d.id)).toContain(direction)
    }
  )

  it('still calls a fully disabled bridge off', () => {
    expect(directionFromFlags({ syncEnabled: false, syncOutbound: true, syncInbound: true })).toBe('off')
    expect(directionFromFlags({ syncEnabled: true, syncOutbound: false, syncInbound: false })).toBe('off')
  })
})

describe('flagsFromDirection', () => {
  it.each(ALL)('round-trips %s', (direction) => {
    expect(directionFromFlags(flagsFromDirection(direction))).toBe(direction)
  })

  it('writes the inbound leg and only the inbound leg for pull-only', () => {
    expect(flagsFromDirection('pull-only')).toEqual({
      syncEnabled: true,
      syncOutbound: false,
      syncInbound: true,
    })
  })

  it('fails CLOSED on a direction it does not recognise', () => {
    /*
     * ⚠ THE PREVIOUS FORM FAILED OPEN. It was a chain of `if`s ending in a bare
     * `return { …all true }`, so any unrecognised value became the most
     * permissive setting the bridge has — both legs relaying. Types are not the
     * backstop: `next.config.js` sets `typescript.ignoreBuildErrors`, and no test
     * file in this repo is typechecked at all, so a bad value can reach this at
     * runtime.
     */
    const bogus = 'inbound-and-outbound-and-whatever' as unknown as BridgeDirection
    expect(flagsFromDirection(bogus)).toEqual({
      syncEnabled: false,
      syncOutbound: false,
      syncInbound: false,
    })
  })
})

describe('the picker vocabulary matches the type', () => {
  it('offers exactly one button per direction', () => {
    /*
     * 🛑 NOTHING TYPECHECKS THIS, WHICH IS WHY IT IS ASSERTED. `DIRECTIONS` is a
     * plain array; omitting a member of the union is not a compile error, it is
     * a state the server can report and the UI cannot show — the shape of the
     * original defect. It is also the shape the NEXT direction would take.
     */
    expect([...DIRECTIONS.map((d) => d.id)].sort()).toEqual([...ALL].sort())
    expect(new Set(DIRECTIONS.map((d) => d.id)).size).toBe(DIRECTIONS.length)
  })

  it('gives every button a distinct label and hint', () => {
    expect(new Set(DIRECTIONS.map((d) => d.label)).size).toBe(DIRECTIONS.length)
    expect(new Set(DIRECTIONS.map((d) => d.hint)).size).toBe(DIRECTIONS.length)
    for (const d of DIRECTIONS) {
      expect(d.label.trim(), `${d.id} has an empty label`).not.toBe('')
      expect(d.hint.trim(), `${d.id} has an empty hint`).not.toBe('')
    }
  })
})
