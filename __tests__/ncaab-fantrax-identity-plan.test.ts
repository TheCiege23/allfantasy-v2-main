import { describe, expect, it } from 'vitest'
import { planNcaabFantraxIdentityLinks, type NcaabIdentity } from '@/lib/player-identity/ncaabFantraxIdentityPlan'

const identity: NcaabIdentity = { id: 'ri-1', normalizedName: 'bryce baker', position: 'G',
  currentTeam: 'RIDER UNIVERSITY', rollingInsightsId: '20542', fantraxId: null }
const args = {
  refs: [{ fantraxId: '064v9', name: 'Baker, Bryce', team: 'Rider', position: 'G' }],
  identities: [identity],
  sourcePlayers: [{ externalId: '20542', name: 'Bryce Baker', position: 'G', team: 'Rider University' }],
  teams: [{ name: 'Rider University', shortName: 'Rider' }],
  rosterIds: new Set(['064v9']),
}

describe('Fantrax NCAAB identity bridge', () => {
  it('links a rostered player only with exact name, school, position and RI source proof', () => {
    expect(planNcaabFantraxIdentityLinks(args).links).toEqual([
      { id: 'ri-1', fantraxId: '064v9', rollingInsightsId: '20542' },
    ])
    expect(planNcaabFantraxIdentityLinks({ ...args, rosterIds: new Set() }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...args,
      sourcePlayers: [{ ...args.sourcePlayers[0]!, team: 'Winthrop University' }] }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...args,
      sourcePlayers: [...args.sourcePlayers, args.sourcePlayers[0]!] }).links).toEqual([])
  })

  it('refuses duplicate school codes, identity rows, and competing provider IDs', () => {
    expect(planNcaabFantraxIdentityLinks({ ...args,
      teams: [...args.teams, { name: 'Other Rider', shortName: 'Rider' }] }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...args,
      identities: [identity, { ...identity, id: 'ri-2' }] }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...args,
      refs: [...args.refs, { ...args.refs[0]!, fantraxId: 'other' }] }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...args,
      identities: [{ ...identity, fantraxId: 'owned' }] }).links).toEqual([])
  })
})

describe('school abbreviations confirmed by current games', () => {
  const refs = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, i) => ({ fantraxId: 'f' + i, name, team: 'Rdr', position: 'G' }))
  const identities = refs.map((r, i) => ({ ...identity, id: 'i' + i, normalizedName: r.name.toLowerCase(), rollingInsightsId: 'r' + i }))
  const sourcePlayers = refs.map((r, i) => ({ ...args.sourcePlayers[0]!, name: r.name, externalId: 'r' + i }))
  const currentAppearances = identities.map(p => ({ playerId: p.id, team: 'Rider' }))
  const input = { ...args, refs, identities, sourcePlayers, currentAppearances, rosterIds: new Set(['f3']) }
  it('accepts an exact current player on the agreed school and rejects a missing or conflicting box', () => {
    expect(planNcaabFantraxIdentityLinks(input).links).toEqual([{ id: 'i3', fantraxId: 'f3', rollingInsightsId: 'r3' }])
    expect(planNcaabFantraxIdentityLinks({ ...input, currentAppearances: currentAppearances.slice(0, 3) }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...input, currentAppearances: [...currentAppearances, { playerId: 'i3', team: 'OTHER' }] }).links).toEqual([])
  })
  it('requires independent athletes, one school and an unambiguous current identity', () => {
    expect(planNcaabFantraxIdentityLinks({ ...input, refs: refs.slice(2) }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...input, teams: [...args.teams, { shortName: 'O', name: 'Other' }],
      identities: identities.map((p,i) => i ? p : { ...p, currentTeam: 'Other' }),
      sourcePlayers: sourcePlayers.map((p,i) => i ? p : { ...p, team: 'Other' }),
      currentAppearances: currentAppearances.map((p,i) => i ? p : { ...p, team: 'O' }),
    }).links).toEqual([])
    expect(planNcaabFantraxIdentityLinks({ ...input, refs: [...refs, { ...refs[3]!, fantraxId: 'other-id' }] }).links).toEqual([])
  })
})

/* The rostered ids still unlinked in production on 2026-11-19, one case per class. */
describe('Fantrax NCAAB: the remaining unlinked classes', () => {
  const rider = (over: Partial<NcaabIdentity> & { name: string }, ri: string) => {
    const id: NcaabIdentity = { id: `ri-${ri}`, normalizedName: over.name.toLowerCase(), position: 'G', currentTeam: 'RIDER UNIVERSITY',
      rollingInsightsId: ri, fantraxId: null, ...over }
    return { id, source: { externalId: ri, name: over.name, position: id.position, team: id.currentTeam } }
  }
  const run = (refs: Array<{ fantraxId: string; name: string; team: string; position: string }>, people: Array<ReturnType<typeof rider>>, extra: NcaabIdentity[] = []) =>
    planNcaabFantraxIdentityLinks({ refs, identities: [...people.map((x) => x.id), ...extra], sourcePlayers: people.map((x) => x.source),
      teams: [{ name: 'Rider University', shortName: 'Rider' }, { name: 'Tulane University', shortName: 'Tul' }], rosterIds: new Set(refs.map((r) => r.fantraxId)) }).links

  it("ignores apostrophes Fantrax drops (OConnor / Collin O'Connor)", () => {
    expect(run([{ fantraxId: 'f1', name: 'OConnor, Collin', team: 'Rider', position: 'G' }], [rider({ name: "Collin O'Connor" }, '1')])).toHaveLength(1)
  })
  it('does not require the registry and its RI row to agree on the G/F/C label', () => {
    const p = rider({ name: 'Donovan Rakotonanahary' }, '2'); p.source.position = 'F'
    expect(run([{ fantraxId: 'f2', name: 'Rakotonanahary, Donovan', team: 'Rider', position: 'G' }], [p])).toHaveLength(1)
  })
  it('matches a spelling the registry does not hold (Kordelius / Kordel), never an initial alone', () => {
    expect(run([{ fantraxId: 'f3', name: 'Jefferson, Kordelius', team: 'Rider', position: 'G' }], [rider({ name: 'Kordel Jefferson' }, '3')])).toHaveLength(1)
    expect(run([{ fantraxId: 'f3', name: 'Jones, Gavin', team: 'Rider', position: 'F' }], [rider({ name: 'Gabe Jones' }, '3')])).toEqual([])
    expect(run([{ fantraxId: 'f3', name: 'Jefferson, Kordelius', team: 'Rider', position: 'G' }],
      [rider({ name: 'Kordel Jefferson' }, '3'), rider({ name: 'Mike Jefferson' }, '4')])).toEqual([])
  })
  it('links a transfer only when the name is unique on both sides (JoJo Moore, Tulane / Oral Roberts)', () => {
    const moore = rider({ name: 'JoJo Moore' }, '5')
    const ref = { fantraxId: 'f5', name: 'Moore, JoJo', team: 'Tul', position: 'G' }
    expect(run([ref], [moore])).toEqual([{ id: 'ri-5', fantraxId: 'f5', rollingInsightsId: '5' }])
    // A namesake anywhere — even one already linked to another Fantrax id — or a second Fantrax JoJo Moore.
    expect(run([ref], [moore], [{ ...moore.id, id: 'other', currentTeam: 'DUKE UNIVERSITY', fantraxId: 'taken' }])).toEqual([])
    expect(run([ref, { ...ref, fantraxId: 'f6', team: 'Rider' }], [moore]).filter((l) => l.fantraxId === 'f5')).toEqual([])
  })
  it('learns a school code no linked player can teach yet, from three unique-name players', () => {
    const villa = (p: ReturnType<typeof rider>) => ({ ...p, id: { ...p.id, currentTeam: 'VILLANOVA UNIVERSITY' }, source: { ...p.source, team: 'VILLANOVA UNIVERSITY' } })
    const anchors = ['Ann Alpha', 'Ben Beta', 'Cal Gamma'].map((n, i) => villa(rider({ name: n }, `v${i}`)))
    // The target has a namesake at another school, so it cannot be an anchor itself.
    const target = villa(rider({ name: 'Dee Delta' }, 'v9'))
    const namesake: NcaabIdentity = { ...target.id, id: 'elsewhere', currentTeam: 'DUKE UNIVERSITY', rollingInsightsId: null }
    const ref = (p: ReturnType<typeof rider>, i: string) => ({ fantraxId: i, name: p.source.name.split(' ').reverse().join(', '), team: 'Vill', position: 'G' })
    const targetRef = ref(target, 'xt')
    expect(run([...anchors.map((a, i) => ref(a, `x${i}`)), targetRef], [...anchors, target], [namesake]).some((l) => l.fantraxId === 'xt')).toBe(true)
    expect(run([...anchors.slice(0, 2).map((a, i) => ref(a, `x${i}`)), targetRef], [...anchors.slice(0, 2), target], [namesake]).some((l) => l.fantraxId === 'xt')).toBe(false)
  })
})
