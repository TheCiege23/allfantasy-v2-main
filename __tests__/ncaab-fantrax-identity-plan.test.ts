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
