// @vitest-environment node
/**
 * Guards who can act on a tournament.
 *
 * 🛑 A TOURNAMENT HAS ONE EMPOWERED PERSON TODAY. There is no way to let a
 * co-commissioner look at the standings without handing them the whole thing.
 * The rule being implemented: a grant gives access and changes nothing until
 * each capability is given explicitly, and it can go to someone who commissions
 * no leagues at all.
 */
import { describe, it, expect } from 'vitest'
import {
  can,
  capabilitiesOf,
  grantColumnsForRole,
  GRANT_ROLES,
  type ViewerContext,
} from '@/lib/tournament/tournamentPermissions'

const COMMISH = 'commish'
const base = (over: Partial<ViewerContext> = {}): ViewerContext => ({
  userId: 'guest',
  commissionerId: COMMISH,
  grant: null,
  ...over,
})

const grant = (over: Partial<{ canBroadcast: boolean; canAdvance: boolean; canEditSettings: boolean }> = {}) => ({
  userId: 'guest',
  canBroadcast: false,
  canAdvance: false,
  canEditSettings: false,
  ...over,
})

describe('the commissioner', () => {
  it('can do everything', () => {
    const caps = capabilitiesOf(base({ userId: COMMISH }))
    expect(caps).toEqual({
      view: true,
      broadcast: true,
      advance: true,
      editSettings: true,
      grantAccess: true,
    })
  })
})

describe('someone with no grant', () => {
  it('can do nothing, including look', () => {
    expect(capabilitiesOf(base())).toEqual({
      view: false,
      broadcast: false,
      advance: false,
      editSettings: false,
      grantAccess: false,
    })
  })

  it('is refused when signed out', () => {
    expect(can(base({ userId: null }), 'view')).toBe(false)
  })
})

describe('a granted user', () => {
  /**
   * ⚠ HAVING A ROW IS THE VIEW PERMISSION. There is no `canView` column — a
   * grant that lets you act on something you cannot see is not a thing anybody
   * wants.
   */
  it('can always look', () => {
    expect(can(base({ grant: grant() }), 'view')).toBe(true)
  })

  /** The user's rule: access first, capabilities only when given. */
  it('starts with no capabilities beyond looking', () => {
    const caps = capabilitiesOf(base({ grant: grant() }))
    expect(caps).toMatchObject({ view: true, broadcast: false, editSettings: false })
  })

  it('gains only the capability that was granted', () => {
    expect(can(base({ grant: grant({ canBroadcast: true }) }), 'broadcast')).toBe(true)
    expect(can(base({ grant: grant({ canBroadcast: true }) }), 'editSettings')).toBe(false)
  })

  /** ⚠ A grant belonging to somebody else is not this viewer's grant. */
  it('cannot use another user’s grant row', () => {
    const other = { ...grant({ canBroadcast: true }), userId: 'someone-else' }
    expect(can(base({ grant: other }), 'view')).toBe(false)
    expect(can(base({ grant: other }), 'broadcast')).toBe(false)
  })
})

/**
 * 🛑 THE TWO THAT ARE NEVER GRANTABLE. Advancement is the one irreversible act
 * in the feature — it ends hundreds of seasons and cannot be undone. Delegating
 * the power to delegate lets the circle widen past anything the commissioner
 * agreed to, one legitimate-looking step at a time.
 */
describe('what no grant can ever buy', () => {
  it('refuses advancement even to a row that claims it', () => {
    expect(can(base({ grant: grant({ canAdvance: true }) }), 'advance')).toBe(false)
  })

  it('refuses granting access even to a full co-commissioner', () => {
    const co = grant(grantColumnsForRole('co_commissioner'))
    expect(can(base({ grant: co }), 'grantAccess')).toBe(false)
    expect(can(base({ grant: co }), 'editSettings')).toBe(true)
  })

  /** ⚠ A hand-edited row must not buy it either — the check refuses regardless. */
  it('refuses both even when every column is true', () => {
    const everything = grant({ canBroadcast: true, canAdvance: true, canEditSettings: true })
    expect(can(base({ grant: everything }), 'advance')).toBe(false)
    expect(can(base({ grant: everything }), 'grantAccess')).toBe(false)
  })
})

describe('roles are a label, not the enforcement', () => {
  it('maps each named role to the columns it stores', () => {
    expect(grantColumnsForRole('viewer')).toEqual({
      canBroadcast: false,
      canAdvance: false,
      canEditSettings: false,
    })
    expect(grantColumnsForRole('announcer')).toMatchObject({ canBroadcast: true, canEditSettings: false })
    expect(grantColumnsForRole('co_commissioner')).toMatchObject({
      canBroadcast: true,
      canEditSettings: true,
    })
  })

  /**
   * ⚠ AN UNKNOWN ROLE RESOLVES TO THE LEAST ACCESS. A typo must never create a
   * grant that can do more than intended.
   */
  it('gives an unrecognised role nothing', () => {
    expect(grantColumnsForRole('super-admin')).toEqual({
      canBroadcast: false,
      canAdvance: false,
      canEditSettings: false,
    })
  })

  /** ⚠ No named role may carry advancement — it is not delegable at all. */
  it('has no role that grants advancement', () => {
    for (const role of Object.values(GRANT_ROLES)) {
      expect(role.canAdvance).toBe(false)
    }
  })
})
