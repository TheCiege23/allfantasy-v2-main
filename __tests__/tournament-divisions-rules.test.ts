import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, tx } = vi.hoisted(() => {
  const db = { shell: null as Record<string, unknown> | null, created: [] as Array<Record<string, unknown>>, updated: [] as Array<Record<string, unknown>> }
  const tx = {
    tournamentShell: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.created.push(data); return { id: 'new-t', ...data } }),
      findUnique: vi.fn(async () => (db.shell ? { ...db.shell } : null)),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.updated.push(data); return { count: 1 } }),
    },
    tournamentShellGrant: { findUnique: vi.fn(async () => null) },
    tournamentDivision: { upsert: vi.fn(async () => ({})) },
    tournamentConference: { deleteMany: vi.fn(async () => ({})), findMany: vi.fn(async () => []), update: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})) },
    tournamentAuditLog: { create: vi.fn(async () => ({})) },
  }
  return { db, tx }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { ...tx, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }))

import { buildDivisionsBlueprint, DivisionsBlueprintError } from '@/lib/tournament/divisions/blueprint'
import { saveDivisionsBlueprint, updateDivisionsBlueprint } from '@/lib/tournament/divisions/divisionsStore'
import { defaultFormatSettings } from '@/lib/tournament/divisions/engine'
import { buildHubView } from '@/lib/tournament/divisions/hubView'
import { presetIdentity } from '@/lib/tournament/divisions/identity'
import { divisionsRulesLabels, parseDivisionsRules } from '@/lib/tournament/divisions/rules'

const plan = (extra: Record<string, unknown> = {}, sport: 'NFL' | 'NBA' = 'NFL') => ({
  name: 'Rookies vs Vets', settings: defaultFormatSettings(sport), identity: presetIdentity('rookie-vet', 10), ...extra,
})

beforeEach(() => { db.shell = null; db.created = []; db.updated = [] })

describe('divisions rules (scoring + roster labels)', () => {
  it('accepts a backed choice for the sport and keeps it on the plan', () => {
    const { config } = buildDivisionsBlueprint(plan({ rules: { scoringId: 'ppr', rosterId: 'nfl-sf' } }))
    expect(config.rules).toEqual({ scoringId: 'ppr', rosterId: 'nfl-sf' })
  })

  it('defaults to the sport defaults when the client sends no rules (older clients)', () => {
    expect(buildDivisionsBlueprint(plan()).config.rules).toEqual({ scoringId: 'half', rosterId: 'nfl-std' })
    expect(buildDivisionsBlueprint(plan({}, 'NBA')).config.rules).toEqual({ scoringId: 'pts', rosterId: 'nba-std' })
  })

  it('rejects unknown ids, the other sport\'s ids and labels with no live preset', () => {
    for (const rules of [{ scoringId: 'nope' }, { scoringId: 'cat9' }, { rosterId: 'nba-std' }, { scoringId: 'six' }, { scoringId: 'custom' }, { rosterId: 'nfl-2qb' }, 'half']) {
      expect(() => buildDivisionsBlueprint(plan({ rules }))).toThrow(DivisionsBlueprintError)
    }
    expect(parseDivisionsRules('NBA', { scoringId: 'cat9', rosterId: 'nba-std' })).toEqual({ ok: true, rules: { scoringId: 'cat9', rosterId: 'nba-std' } })
  })

  it('reads an old tournament (no saved rules) as the sport default, and a saved one as saved', () => {
    expect(divisionsRulesLabels('NFL', { sport: 'NFL', conferencesPerDivision: 10 })).toEqual({ scoringId: 'half', rosterId: 'nfl-std' })
    expect(divisionsRulesLabels('NFL', null)).toEqual({ scoringId: 'half', rosterId: 'nfl-std' })
    expect(divisionsRulesLabels('NFL', { rules: { scoringId: 'te', rosterId: 'nfl-idp' } })).toEqual({ scoringId: 'te', rosterId: 'nfl-idp' })
    // A corrupt saved value never throws; it reads as the default.
    expect(divisionsRulesLabels('NBA', { rules: { scoringId: 'ppr' } })).toEqual({ scoringId: 'pts', rosterId: 'nba-std' })
    const base = { tournament: { id: 't', name: 'T', sport: 'NFL' as const, status: 'live', season: null }, settings: defaultFormatSettings('NFL'), identity: presetIdentity('black-gold', 10), teams: [] }
    expect(buildHubView(base).rules).toEqual({ scoringId: 'half', rosterId: 'nfl-std' })
    expect(buildHubView({ ...base, rules: { scoringId: 'std', rosterId: 'nfl-sf' } }).rules).toEqual({ scoringId: 'std', rosterId: 'nfl-sf' })
  })

  it('persists the choice inside formatSettings when the tournament is created', async () => {
    await saveDivisionsBlueprint('owner', plan({ rules: { scoringId: 'ppr', rosterId: 'nfl-sf' } }))
    expect((db.created[0]!.formatSettings as { rules: unknown }).rules).toEqual({ scoringId: 'ppr', rosterId: 'nfl-sf' })
  })

  it('can change while a plan, and is locked once registration opens', async () => {
    db.shell = { id: 't1', format: 'divisions', status: 'blueprint', commissionerId: 'owner', updatedAt: new Date(1) }
    await updateDivisionsBlueprint('owner', 't1', plan({ rules: { scoringId: 'std', rosterId: 'nfl-idp' } }))
    expect((db.updated[0]!.formatSettings as { rules: unknown }).rules).toEqual({ scoringId: 'std', rosterId: 'nfl-idp' })
    db.shell = { ...db.shell, status: 'registering' }
    await expect(updateDivisionsBlueprint('owner', 't1', plan({ rules: { scoringId: 'ppr', rosterId: 'nfl-std' } }))).rejects.toMatchObject({ status: 409 })
    expect(db.updated).toHaveLength(1)
  })
})
