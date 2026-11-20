/**
 * College basketball school-code collisions in `SportsTeam`, as measured on production 2026-11-20.
 * The rows below are the real ones (names, sources and Rolling Insights team ids).
 */
import { describe, expect, it } from 'vitest'
import { buildNcaabSchoolIndex, schoolForAppearance, schoolForCode, schoolKey } from '@/lib/player-identity/ncaabSchoolCodes'
import { planNcaabFantraxIdentityLinks, type NcaabIdentity } from '@/lib/player-identity/ncaabFantraxIdentityPlan'

const rows = [
  { name: 'Mercer University', shortName: 'MER', source: 'rolling_insights', externalId: '285' },
  { name: 'Merrimack College', shortName: 'MER', source: 'rolling_insights', externalId: '354' },
  { name: 'University of New Hampshire', shortName: 'UNH', source: 'rolling_insights', externalId: '7' },
  { name: 'University of New Haven', shortName: 'UNH', source: 'rolling_insights', externalId: '369' },
  { name: 'Villanova', shortName: 'NOVA', source: 'thesportsdb', externalId: '138661' },
  { name: 'Villanova University', shortName: 'NOVA', source: 'rolling_insights', externalId: '76' },
  { name: 'University of Missouri-Kansas City', shortName: 'UMKC', source: 'rolling_insights', externalId: '357' },
  { name: 'University of Missouri–Kansas City', shortName: 'UMKC', source: 'rolling_insights', externalId: '347' },
  { name: 'West Georgia', shortName: 'UWG', source: 'thesportsdb', externalId: '151520' },
  { name: 'University of West Georgia', shortName: 'UWG', source: 'rolling_insights', externalId: '359' },
  { name: 'Rider University', shortName: 'Rider', source: 'rolling_insights', externalId: '100' },
]
const index = buildNcaabSchoolIndex(rows)

describe('NCAAB school codes that two rows share', () => {
  it('reads one school stored twice as one school (Rolling Insights naming wins, dash style ignored)', () => {
    expect(schoolForCode(index, 'NOVA')).toBe('VILLANOVA UNIVERSITY')
    expect(schoolForCode(index, 'UWG')).toBe('UNIVERSITY OF WEST GEORGIA')
    expect(schoolForCode(index, 'UMKC')).toBe('UNIVERSITY OF MISSOURI-KANSAS CITY')
    expect(schoolKey('University of Missouri–Kansas City')).toBe(schoolKey('University of Missouri-Kansas City'))
  })
  it('keeps a code two schools really share ambiguous on its own (MER, UNH)', () => {
    expect(schoolForCode(index, 'MER')).toBe('')
    expect(schoolForCode(index, 'UNH')).toBe('')
  })
  it('resolves a shared code per game from the Rolling Insights team ids in the game id', () => {
    // Real game ids: 20251103-285-272 (Mercer at home), 20251103-369-12 (New Haven).
    expect(schoolForAppearance(index, 'MER', '20251103-285-272')).toBe('MERCER UNIVERSITY')
    expect(schoolForAppearance(index, 'MER', '20251110-17-354')).toBe('MERRIMACK COLLEGE')
    expect(schoolForAppearance(index, 'UNH', '20251103-369-12')).toBe('UNIVERSITY OF NEW HAVEN')
    // Mercer playing Merrimack names both: refused rather than guessed. No game id: refused.
    expect(schoolForAppearance(index, 'MER', '20251201-285-354')).toBe('')
    expect(schoolForAppearance(index, 'MER', null)).toBe('')
    expect(schoolForAppearance(index, 'NOVA', null)).toBe('VILLANOVA UNIVERSITY')
  })
})

describe('the NCAAB identity matcher over shared codes', () => {
  const person = (id: string, name: string, school: string, fantraxId: string | null = null): NcaabIdentity =>
    ({ id, normalizedName: name.toLowerCase(), position: 'G', currentTeam: school, rollingInsightsId: `ri-${id}`, fantraxId })
  const sourceOf = (p: NcaabIdentity, name: string) => ({ externalId: p.rollingInsightsId!, name, position: 'G', team: p.currentTeam })
  const run = (refs: Array<{ fantraxId: string; name: string; team: string; position: string }>, people: Array<{ p: NcaabIdentity; n: string }>,
    currentAppearances?: Array<{ playerId: string; team: string; gameId?: string }>) =>
    planNcaabFantraxIdentityLinks({ refs, identities: people.map((x) => x.p), sourcePlayers: people.map((x) => sourceOf(x.p, x.n)),
      teams: rows, rosterIds: new Set(refs.map((r) => r.fantraxId)), currentAppearances }).links

  it('links a player on a code stored twice for one school (Villanova "NOVA")', () => {
    const p = person('v', 'Tyler Perkins', 'Villanova University')
    expect(run([{ fantraxId: 'f', name: 'Perkins, Tyler', team: 'NOVA', position: 'G' }], [{ p, n: 'Tyler Perkins' }])).toHaveLength(1)
  })
  it('matches a school name written with an en dash to the hyphenated one (UMKC)', () => {
    const p = person('u', 'Jayson Petty', 'University of Missouri–Kansas City')
    expect(run([{ fantraxId: 'f', name: 'Petty, Jayson', team: 'UMKC', position: 'G' }], [{ p, n: 'Jayson Petty' }])).toHaveLength(1)
  })
  it('settles a shared Fantrax code from already-linked anchors, only to one of its own schools (UNH)', () => {
    // Fantrax's UNH is New Hampshire. Three New Hampshire players already linked under UNH teach it.
    const anchors = ['Ann Alpha', 'Ben Beta', 'Cal Gamma'].map((n, i) => ({ p: person(`a${i}`, n, 'University of New Hampshire', `fa${i}`), n }))
    const target = { p: person('t', 'Nicholas Sangermano', 'University of New Hampshire'), n: 'Nicholas Sangermano' }
    const refs = [...anchors.map(({ p, n }) => ({ fantraxId: p.fantraxId!, name: n.split(' ').reverse().join(', '), team: 'UNH', position: 'G' })),
      { fantraxId: 'ft', name: 'Sangermano, Nicholas', team: 'UNH', position: 'G' }]
    expect(run(refs, [...anchors, target]).map((l) => l.fantraxId)).toEqual(['ft'])
    // Anchors at a school the code does not hold (Rider) teach it nothing.
    const elsewhere = anchors.map(({ p, n }) => ({ p: { ...p, currentTeam: 'Rider University' }, n }))
    expect(run(refs, [...elsewhere, target])).toEqual([])
  })
  it('lets a game resolve a shared code for the appearance learner (Mercer box scores under "MER")', () => {
    // #3910's learner: three active Mercer players under Fantrax code "Mercer", their box scores under MER.
    const mercer = ['Ann Alpha', 'Ben Beta', 'Cal Gamma', 'Dee Delta'].map((n, i) => ({ p: person(`m${i}`, n, 'Mercer University'), n }))
    const refs = mercer.map(({ p, n }) => ({ fantraxId: `f${p.id}`, name: n.split(' ').reverse().join(', '), team: 'Mercer', position: 'G' }))
    // A same-name record elsewhere keeps the OTHER learner (unique names) out, so only appearances teach "Mercer".
    const shadows = mercer.map(({ p, n }) => ({ p: { ...p, id: `${p.id}-x`, currentTeam: 'DUKE UNIVERSITY', rollingInsightsId: null }, n }))
    const ids = (ps: typeof mercer) => [...ps.map((x) => x.p), ...shadows.map((x) => x.p)]
    const plan = (gameId?: string) => planNcaabFantraxIdentityLinks({ refs, identities: ids(mercer), sourcePlayers: mercer.map((x) => sourceOf(x.p, x.n)),
      teams: rows, rosterIds: new Set(['fm3']), currentAppearances: mercer.map(({ p }) => ({ playerId: p.id, team: 'MER', gameId })) }).links
    expect(plan('20251103-285-272').map((l) => l.fantraxId)).toEqual(['fm3'])
    expect(plan(undefined)).toEqual([])
  })
})
