import { describe, expect, it } from 'vitest'
import {
  candidatePrNumber,
  classify,
  isDeletable,
} from '../scripts/neon-prune-preview-branches.mjs'

/**
 * The reconciler deletes DATABASES, so every rule here is a rule about what it must REFUSE.
 *
 * 🛑 THE DANGEROUS DEFECT IS NOT "FAILS TO DELETE", IT IS "DELETES SOMETHING ELSE". A missed
 * branch costs storage and the next run gets it. A wrong delete is gone. So the cases below are
 * weighted towards the refusals, and each refusal is asserted on its own rather than through one
 * combined "safe" helper that could pass for the wrong reason.
 */

const branch = (over: Record<string, unknown> = {}) => ({
  id: 'br-test',
  name: 'preview/pr-123-feat-thing',
  primary: false,
  default: false,
  protected: false,
  ...over,
})

describe('candidatePrNumber: only a preview/pr- branch is ever a candidate', () => {
  it('reads the PR number out of the name', () => {
    expect(candidatePrNumber(branch())).toBe(123)
    expect(candidatePrNumber(branch({ name: 'preview/pr-9-x' }))).toBe(9)
  })

  it.each([
    ['production', 'production'],
    ['a named branch', 'import-test-sandbox'],
    ['a vercel preview', 'preview/claude/some-thing'],
    ['a preview without a PR number', 'preview/sandbox/quarantine'],
    ['pr- without digits', 'preview/pr-abc-thing'],
    ['pr number but no trailing dash', 'preview/pr-123'],
    ['the prefix in the middle', 'x-preview/pr-123-thing'],
  ])('refuses %s', (_label, name) => {
    expect(candidatePrNumber(branch({ name }))).toBeNull()
  })

  it.each(['primary', 'default', 'protected'])(
    'refuses a %s branch even when the name matches',
    (flag) => {
      expect(candidatePrNumber(branch({ [flag]: true }))).toBeNull()
    },
  )

  it('refuses junk without throwing', () => {
    expect(candidatePrNumber(null)).toBeNull()
    expect(candidatePrNumber({} as never)).toBeNull()
    expect(candidatePrNumber({ name: 42 } as never)).toBeNull()
  })
})

describe('isDeletable: unknown is not permission', () => {
  it('deletes only for a closed or merged PR', () => {
    expect(isDeletable('MERGED')).toBe(true)
    expect(isDeletable('CLOSED')).toBe(true)
  })

  it.each([['OPEN'], ['DRAFT'], [''], ['merged'], [null], [undefined], ['UNKNOWN']])(
    'keeps the branch for %s',
    (state) => {
      expect(isDeletable(state as string)).toBe(false)
    },
  )
})

describe('classify', () => {
  const branches = [
    branch({ id: 'br-open', name: 'preview/pr-1-open-one' }),
    branch({ id: 'br-merged', name: 'preview/pr-2-merged-one' }),
    branch({ id: 'br-closed', name: 'preview/pr-3-closed-one' }),
    branch({ id: 'br-missing', name: 'preview/pr-4-no-such-pr' }),
    branch({ id: 'br-prod', name: 'production', primary: true, default: true }),
    branch({ id: 'br-vercel', name: 'preview/claude/old-thing' }),
  ]
  const states = new Map<number, string | null>([
    [1, 'OPEN'],
    [2, 'MERGED'],
    [3, 'CLOSED'],
    [4, null],
  ])

  it('deletes exactly the closed and merged ones', () => {
    const { del } = classify(branches, states)
    expect(del.map((d) => d.branch.id).sort()).toEqual(['br-closed', 'br-merged'])
  })

  it('keeps the open one, the unknown one, production and the vercel branch', () => {
    const { keep } = classify(branches, states)
    expect(keep.map((k) => k.branch.id).sort()).toEqual([
      'br-missing',
      'br-open',
      'br-prod',
      'br-vercel',
    ])
  })

  it('says why it kept each one, so a silent keep cannot look like a considered one', () => {
    const { keep } = classify(branches, states)
    expect(keep.find((k) => k.branch.id === 'br-open')?.why).toBe('PR OPEN')
    expect(keep.find((k) => k.branch.id === 'br-missing')?.why).toBe('PR state unknown')
    expect(keep.find((k) => k.branch.id === 'br-prod')?.why).toMatch(/not a deletable/)
  })

  it('deletes nothing when no PR state could be read at all', () => {
    // The shape of a total GitHub outage: every lookup returns null. It must be a no-op,
    // not a purge.
    const { del } = classify(branches, new Map())
    expect(del).toEqual([])
  })
})
