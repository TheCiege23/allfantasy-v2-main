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
  /*
   * A same-name record at another school for each player (no Rolling Insights id, no appearance). It leaves
   * this learner's evidence untouched, and keeps the file's OTHER learner (linked/unique-name anchors) from
   * also learning 'Rdr' — so these assertions test a code only current appearances taught, which is what
   * they were written for. Where both learners know a code, that learner's rules decide (owner, 2026-11-19).
   */
  const elsewhere = identities.map((p) => ({ ...p, id: `${p.id}-elsewhere`, currentTeam: 'DUKE UNIVERSITY', rollingInsightsId: null }))
  const input = { ...args, refs, identities: [...identities, ...elsewhere], sourcePlayers, currentAppearances, rosterIds: new Set(['f3']) }
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

/*
 * Captured 2026-11-19 (`contracts/fantrax/fixtures/ncaab-player-ids.json`): 191 of Fantrax's school codes
 * are not our `SportsTeam.shortName` (PRINC vs PRIN, KAN vs KU), so their players could never link.
 */
describe('Fantrax NCAAB school codes we do not hold', () => {
  const school = 'PRINCETON UNIVERSITY'
  const anchor = (n: number): NcaabIdentity => ({ id: `a${n}`, normalizedName: `anchor ${n}`, position: 'G',
    currentTeam: school, rollingInsightsId: `ra${n}`, fantraxId: `fa${n}` })
  const target: NcaabIdentity = { id: 'ri-t', normalizedName: 'xaivian lee', position: 'G', currentTeam: school,
    rollingInsightsId: '777', fantraxId: null }
  const base = {
    refs: [
      ...[1, 2, 3].map((n) => ({ fantraxId: `fa${n}`, name: `${n}, Anchor`, team: 'PRINC', position: 'G' })),
      { fantraxId: 'fx-t', name: 'Lee, Xaivian', team: 'PRINC', position: 'G' },
    ],
    identities: [anchor(1), anchor(2), anchor(3), target],
    sourcePlayers: [{ externalId: '777', name: 'Xaivian Lee', position: 'G', team: 'Princeton University' }],
    teams: [{ name: 'Princeton University', shortName: 'PRIN' }],
    rosterIds: new Set(['fx-t']),
  }

  it('learns the code from three players already linked at one school', () => {
    expect(planNcaabFantraxIdentityLinks(base).links).toEqual([{ id: 'ri-t', fantraxId: 'fx-t', rollingInsightsId: '777' }])
  })
  it('learns nothing from two anchors', () => {
    expect(planNcaabFantraxIdentityLinks({ ...base, identities: [anchor(1), anchor(2), target] }).links).toEqual([])
  })
  it('learns nothing when one anchor sits at another school', () => {
    const dissent = { ...anchor(4), currentTeam: 'RIDER UNIVERSITY' }
    expect(planNcaabFantraxIdentityLinks({ ...base,
      refs: [...base.refs, { fantraxId: 'fa4', name: '4, Anchor', team: 'PRINC', position: 'G' }],
      identities: [...base.identities, dissent] }).links).toEqual([])
  })
  it('never overrides a code we already hold', () => {
    // PRIN is ours and means Princeton; three anchors claiming it for Rider change nothing.
    const held = { ...base, refs: base.refs.map((r) => ({ ...r, team: 'PRIN' })),
      identities: [...[1, 2, 3].map((n) => ({ ...anchor(n), currentTeam: 'RIDER UNIVERSITY' })), target] }
    expect(planNcaabFantraxIdentityLinks(held).links).toEqual([{ id: 'ri-t', fantraxId: 'fx-t', rollingInsightsId: '777' }])
  })
})

describe('Fantrax NCAAB position is a tie-breaker, not a gate', () => {
  it('links one same-named player at the school when only the label differs (F vs G)', () => {
    expect(planNcaabFantraxIdentityLinks({ ...args, refs: [{ ...args.refs[0]!, position: 'F' }] }).links)
      .toEqual([{ id: 'ri-1', fantraxId: '064v9', rollingInsightsId: '20542' }])
  })
  it('splits two same-named teammates by position, and refuses when position cannot', () => {
    const forward: NcaabIdentity = { ...identity, id: 'ri-f', position: 'F', rollingInsightsId: '20543' }
    const sources = [...args.sourcePlayers, { externalId: '20543', name: 'Bryce Baker', position: 'F', team: 'Rider University' }]
    expect(planNcaabFantraxIdentityLinks({ ...args, identities: [identity, forward], sourcePlayers: sources }).links)
      .toEqual([{ id: 'ri-1', fantraxId: '064v9', rollingInsightsId: '20542' }])
    expect(planNcaabFantraxIdentityLinks({ ...args, refs: [{ ...args.refs[0]!, position: 'C' }],
      identities: [identity, forward], sourcePlayers: sources }).links).toEqual([])
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

/*
 * Two school-code learners, both kept (owner's decision 2026-11-19): this file's (linked anchors, unique-name
 * bootstrap, supermajority) and #3910's (current game appearances). Where they disagree, nothing links.
 */
describe('Fantrax NCAAB: the two school-code learners together', () => {
  const teams = [{ name: 'Rider University', shortName: 'Rider' }, { name: 'Princeton University', shortName: 'PRIN' }]
  const person = (id: string, name: string, school: string, fantraxId: string | null = null): NcaabIdentity =>
    ({ id, normalizedName: name.toLowerCase(), position: 'G', currentTeam: school, rollingInsightsId: `ri-${id}`, fantraxId })
  const sourceOf = (p: NcaabIdentity, name: string) => ({ externalId: p.rollingInsightsId!, name, position: 'G', team: p.currentTeam })
  const ref = (fantraxId: string, name: string) => ({ fantraxId, name: name.split(' ').reverse().join(', '), team: 'PRINC', position: 'G' })
  // Three players already linked at Princeton under Fantrax's code PRINC: this file's learner says PRINC = Princeton.
  const linked = ['Ann Alpha', 'Ben Beta', 'Cal Gamma'].map((n, i) => ({ p: person(`a${i}`, n, 'PRINCETON UNIVERSITY', `fa${i}`), n }))
  const target = person('t', 'Dee Delta', 'PRINCETON UNIVERSITY')
  const base = {
    refs: [...linked.map(({ p, n }) => ref(p.fantraxId!, n)), ref('ft', 'Dee Delta')],
    identities: [...linked.map(({ p }) => p), target],
    sourcePlayers: [...linked.map(({ p, n }) => sourceOf(p, n)), sourceOf(target, 'Dee Delta')],
    teams, rosterIds: new Set(['ft']),
  }

  it('links on a code only this file learned, without needing a current appearance', () => {
    expect(planNcaabFantraxIdentityLinks(base).links).toEqual([{ id: 't', fantraxId: 'ft', rollingInsightsId: 'ri-t' }])
  })
  it('lets this file decide the player when both learners agree on the school (no minutes yet still links)', () => {
    // Three ACTIVE Princeton players under PRINC: #3910's learner also says PRINC = Princeton. The target
    // has no appearance yet — #3910's rule alone would refuse him; in agreement, this file's rules decide.
    const active = ['Eve Epsilon', 'Fay Zeta', 'Gus Eta'].map((n, i) => ({ p: person(`p${i}`, n, 'PRINCETON UNIVERSITY'), n }))
    const plan = planNcaabFantraxIdentityLinks({
      ...base,
      teams: [...teams, { name: 'Princeton University', shortName: 'Prn' }],
      refs: [...base.refs, ...active.map(({ p, n }) => ref(`fp${p.id}`, n))],
      identities: [...base.identities, ...active.map(({ p }) => p)],
      sourcePlayers: [...base.sourcePlayers, ...active.map(({ p, n }) => sourceOf(p, n))],
      currentAppearances: active.map(({ p }) => ({ playerId: p.id, team: 'Prn' })),
    })
    expect(plan.links.filter((l) => l.fantraxId === 'ft')).toEqual([{ id: 't', fantraxId: 'ft', rollingInsightsId: 'ri-t' }])
  })
  it('refuses when #3910 learned the same code for another school', () => {
    // Three active Rider players Fantrax also lists under PRINC: #3910's learner says PRINC = Rider.
    const riders = ['Eve Epsilon', 'Fay Zeta', 'Gus Eta'].map((n, i) => ({ p: person(`r${i}`, n, 'RIDER UNIVERSITY'), n }))
    const input = {
      ...base,
      refs: [...base.refs, ...riders.map(({ p, n }) => ref(`fr${p.id}`, n))],
      identities: [...base.identities, ...riders.map(({ p }) => p)],
      sourcePlayers: [...base.sourcePlayers, ...riders.map(({ p, n }) => sourceOf(p, n))],
      currentAppearances: riders.map(({ p }) => ({ playerId: p.id, team: 'Rider' })),
    }
    // The target is active at Princeton (so #3910's own rule would accept him there) and has a Fantrax
    // namesake elsewhere (so he cannot vote): only the disagreement between the learners can refuse him.
    const plan = planNcaabFantraxIdentityLinks({ ...input, refs: [...input.refs, { fantraxId: 'fdup', name: 'Delta, Dee', team: 'Rider', position: 'G' }],
      currentAppearances: [...input.currentAppearances, { playerId: 't', team: 'PRIN' }] })
    expect(plan.links).toEqual([])
  })
  it('does not refuse a player over a box-score code that is ambiguous or collides with ours', () => {
    // Production 2026-11-19: New Haven players appear as "UNH" (our New Hampshire); NOVA/UWG/MER are held
    // twice. A per-player box-score veto refused 45 correct links, so the code-level reading has none.
    expect(planNcaabFantraxIdentityLinks({ ...args, teams, currentAppearances: [{ playerId: 'ri-1', team: 'PRIN' }] }).links).toHaveLength(1)
  })
})
