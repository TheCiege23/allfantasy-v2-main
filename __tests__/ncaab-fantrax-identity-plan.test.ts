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
