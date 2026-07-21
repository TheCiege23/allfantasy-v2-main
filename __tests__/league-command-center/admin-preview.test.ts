/**
 * Covers the admin role-preview authorization rule.
 *
 * The rule that matters: a preview may only NARROW the effective role, never
 * widen it. Without that, `?viewAs=commissioner` would let a site admin read
 * commissioner-only operations data (attention queues, retention-risk managers,
 * league-wide activity) for a league where they are merely a member — privilege
 * escalation wearing a debug-tool costume.
 *
 * The design prototype gated this on `/[?&]admin=/` in the URL, i.e. on anyone
 * who types `?admin=1`. These tests exist to make sure that never comes back.
 */
import { describe, expect, it } from 'vitest'
import {
  applyRolePreview,
  availablePreviewRoles,
  isCommandCenterRole,
} from '@/lib/league-command-center/adminPreview'

describe('applyRolePreview — non-admin', () => {
  it('ignores the parameter entirely for a non-admin', () => {
    for (const requested of ['manager', 'co_commissioner', 'commissioner']) {
      const result = applyRolePreview({
        isAdmin: false,
        realRole: 'commissioner',
        requestedRole: requested,
      })
      expect(result.effectiveRole, `requested ${requested}`).toBe('commissioner')
      expect(result.previewActive).toBe(false)
      expect(result.isAdmin).toBe(false)
    }
  })

  it('never lets a non-admin manager reach commissioner', () => {
    const result = applyRolePreview({
      isAdmin: false,
      realRole: 'manager',
      requestedRole: 'commissioner',
    })
    expect(result.effectiveRole).toBe('manager')
    expect(result.previewActive).toBe(false)
  })
})

describe('applyRolePreview — admin, downgrade only', () => {
  it('lets a commissioner-admin preview narrower roles', () => {
    const asManager = applyRolePreview({
      isAdmin: true,
      realRole: 'commissioner',
      requestedRole: 'manager',
    })
    expect(asManager.effectiveRole).toBe('manager')
    expect(asManager.previewActive).toBe(true)
    expect(asManager.deniedElevation).toBeNull()

    const asCoCommish = applyRolePreview({
      isAdmin: true,
      realRole: 'commissioner',
      requestedRole: 'co_commissioner',
    })
    expect(asCoCommish.effectiveRole).toBe('co_commissioner')
    expect(asCoCommish.previewActive).toBe(true)
  })

  it('REFUSES elevation even for an admin', () => {
    const cases: [string, string][] = [
      ['manager', 'commissioner'],
      ['manager', 'co_commissioner'],
      ['co_commissioner', 'commissioner'],
    ]
    for (const [realRole, requested] of cases) {
      const result = applyRolePreview({
        isAdmin: true,
        realRole: realRole as 'manager' | 'co_commissioner',
        requestedRole: requested,
      })
      expect(result.effectiveRole, `${realRole} -> ${requested}`).toBe(realRole)
      expect(result.previewActive).toBe(false)
      expect(result.deniedElevation).toBe(requested)
    }
  })

  it('treats an unknown or malformed role as no preview', () => {
    for (const bad of ['admin', 'owner', 'COMMISSIONER; DROP', '', '   ', null]) {
      const result = applyRolePreview({
        isAdmin: true,
        realRole: 'commissioner',
        requestedRole: bad,
      })
      expect(result.effectiveRole, `bad input ${JSON.stringify(bad)}`).toBe('commissioner')
      expect(result.previewActive).toBe(false)
      expect(result.deniedElevation).toBeNull()
    }
  })

  it('is a no-op when the requested role equals the real role', () => {
    const result = applyRolePreview({
      isAdmin: true,
      realRole: 'manager',
      requestedRole: 'manager',
    })
    expect(result.previewActive).toBe(false)
    expect(result.effectiveRole).toBe('manager')
  })
})

describe('availablePreviewRoles', () => {
  it('never offers a role above the viewer’s real role', () => {
    expect(availablePreviewRoles('manager')).toEqual(['manager'])
    expect(availablePreviewRoles('co_commissioner')).toEqual(['manager', 'co_commissioner'])
    expect(availablePreviewRoles('commissioner')).toEqual([
      'manager',
      'co_commissioner',
      'commissioner',
    ])
  })
})

describe('isCommandCenterRole', () => {
  it('accepts only the three real roles', () => {
    expect(isCommandCenterRole('manager')).toBe(true)
    expect(isCommandCenterRole('co_commissioner')).toBe(true)
    expect(isCommandCenterRole('commissioner')).toBe(true)
    expect(isCommandCenterRole('admin')).toBe(false)
    expect(isCommandCenterRole('viewer')).toBe(false)
  })
})
