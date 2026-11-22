import { describe, expect, it } from 'vitest'
import { argumentProblems, describePlan, parsePlanArgs, planPartnerProvision, type PlanFacts } from '@/lib/partner-portal/provisionPlan'

/** scripts/provision-partner-workspace.ts — owner-run, dry run by default (owner's decision 2026-11-17). */

const owner = { id: 'u-owner', email: 'owner@example.com', displayName: 'Pat' }
const leagues = [
  { id: 'L1', name: 'Harbor City', platform: 'Sleeper', platformLeagueId: '987654321', season: 2026 },
  { id: 'L2', name: null, platform: 'espn', platformLeagueId: '', season: null },
]
const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({ owner, existingTenant: null, leagues, alreadyLinkedLeagueIds: [], ...over })

describe('parsePlanArgs', () => {
  it('reads the flags, de-duplicates leagues, and is a dry run unless --apply is given', () => {
    const a = parsePlanArgs(['--slug=acme-fantasy', '--name=Acme Fantasy', '--owner-email=owner@example.com', '--league=L1', '--league=L2,L1'])
    expect(a).toEqual({ mode: 'create', slug: 'acme-fantasy', name: 'Acme Fantasy', ownerEmail: 'owner@example.com', leagueIds: ['L1', 'L2'], apply: false })
    expect(parsePlanArgs(['--apply', '--link-only', '--slug=x']).apply).toBe(true)
    expect(parsePlanArgs(['--link-only']).mode).toBe('link')
  })
})

describe('planPartnerProvision — create', () => {
  const args = { mode: 'create' as const, slug: 'acme-fantasy', name: 'Acme Fantasy', ownerEmail: 'owner@example.com', leagueIds: ['L1', 'L2'] }

  it('plans the workspace, its owner and one LINK per league (the league keeps its own tenant)', () => {
    const plan = planPartnerProvision(args, facts())
    expect(plan).toEqual({
      ok: true,
      mode: 'create',
      slug: 'acme-fantasy',
      name: 'Acme Fantasy',
      tenantId: null,
      owner: { userId: 'u-owner', email: 'owner@example.com', displayName: 'Pat' },
      bindings: [
        { leagueId: 'L1', leagueName: 'Harbor City', provider: 'sleeper', externalLeagueId: '987654321', externalSeason: '2026' },
        // No provider id (a native league) falls back to the league's own id; a nameless league shows its id.
        { leagueId: 'L2', leagueName: 'L2', provider: 'espn', externalLeagueId: 'L2', externalSeason: null },
      ],
      skipped: [],
    })
    expect(describePlan(plan).join('\n')).toContain('they stay AllFantasy leagues')
  })

  it.each([
    ['a reserved slug', { slug: 'admin' }, {}, 'reserved'],
    ['a malformed slug', { slug: 'Not A Slug!' }, {}, '--slug'],
    ['no name', { name: null }, {}, '--name is required'],
    ['no owner email', { ownerEmail: null }, {}, '--owner-email is required'],
    ['an owner with no account', {}, { owner: null }, 'has to sign up first'],
    ['a slug already in use (slugs are permanent)', {}, { existingTenant: { id: 't1', name: 'Acme' } }, 'already uses the slug'],
    ['a league that does not exist', { leagueIds: ['L1', 'NOPE'] }, {}, 'League NOPE does not exist'],
  ])('refuses %s, and writes nothing', (_label, argOver, factOver, message) => {
    const plan = planPartnerProvision({ ...args, ...argOver }, facts(factOver))
    expect(plan.ok).toBe(false)
    expect(!plan.ok && plan.problems.join(' ')).toContain(message)
    expect(describePlan(plan)[0]).toBe('Nothing will be written. Fix these first:')
  })
})

describe('planPartnerProvision — link into an existing workspace', () => {
  const args = { mode: 'link' as const, slug: 'acme-fantasy', name: null, ownerEmail: null, leagueIds: ['L1', 'L2'] }

  it('links only what is not already linked, into the workspace the slug names', () => {
    const plan = planPartnerProvision(args, facts({ existingTenant: { id: 't-acme', name: 'Acme Fantasy' }, alreadyLinkedLeagueIds: ['L1'] }))
    expect(plan.ok && { tenantId: plan.tenantId, owner: plan.owner, linked: plan.bindings.map((b) => b.leagueId), skipped: plan.skipped }).toEqual({
      tenantId: 't-acme',
      owner: null,
      linked: ['L2'],
      skipped: ['Harbor City is already linked'],
    })
  })

  it('refuses an unknown workspace, or no leagues', () => {
    expect(planPartnerProvision(args, facts()).ok).toBe(false)
    expect(planPartnerProvision({ ...args, leagueIds: [] }, facts({ existingTenant: { id: 't', name: 'A' } })).ok).toBe(false)
  })
})

describe('argumentProblems — checked before any database read', () => {
  it('catches slug, name, email and empty link lists from the arguments alone', () => {
    expect(argumentProblems({ mode: 'create', slug: 'admin', name: null, ownerEmail: 'nope', leagueIds: [] })).toEqual([
      '--slug: "admin" is reserved.',
      '--name is required to create a workspace.',
      '--owner-email is required to create a workspace.',
    ])
    expect(argumentProblems({ mode: 'link', slug: 'acme-fantasy', name: null, ownerEmail: null, leagueIds: [] })).toEqual(['--link-only needs at least one --league=<id>.'])
    expect(argumentProblems({ mode: 'create', slug: 'acme-fantasy', name: 'Acme', ownerEmail: 'a@b.co', leagueIds: [] })).toEqual([])
  })
})
