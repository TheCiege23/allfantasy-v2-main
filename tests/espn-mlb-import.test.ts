import { buildProviderSourceRef } from '@/lib/league-import/sourceRef'
import { describe, it, expect, vi, afterEach } from 'vitest'
import fixture from '../contracts/espn/fixtures/fantasy-league.MLB.2026.json'
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn() }))
import { getDecryptedAuth } from '@/lib/league-sync-core'
import { parseEspnMlbPayload, fetchEspnMlbLeagueForImport } from '@/lib/league-import/espn/EspnMlbLeagueFetchService'
import { parseEspnMlbSource, isEspnMlbSource } from '@/lib/league-import/espn/EspnMlbSource'
import { EspnAdapter } from '@/lib/league-import/adapters/espn/EspnAdapter'
import { fetchEspnLeagueForImport, fetchEspnActivityForSync } from '@/lib/league-import/espn/EspnLeagueFetchService'

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })
describe('ESPN MLB captured contract', () => {
  it.each(['MLB:2026:13262', '2026:MLB:13262', 'https://fantasy.espn.com/baseball/league?leagueId=13262&seasonId=2026'])(
    'accepts a sport-qualified source %s', s => expect(parseEspnMlbSource(s)).toEqual({ leagueId:'13262',season:2026 }))
  it('never interprets a football link or bare id as baseball', () => {
    expect(isEspnMlbSource('13262')).toBe(false)
    expect(isEspnMlbSource('https://fantasy.espn.com/football/league?leagueId=13262')).toBe(false)
    expect(() => parseEspnMlbSource('https://evil.example/baseball?leagueId=13262')).toThrow()
  })
  it('preserves every owned player and correctly separates MLB starters, bench and IL', () => {
    const p = parseEspnMlbPayload(fixture, 'MLB:2026:13262')
    expect(p.league).toMatchObject({sport:'MLB',leagueId:'MLB:13262',size:12})
    expect(p.teams).toHaveLength(12)
    expect(p.teams.reduce((s,t) => s+t.rosterPlayerIds.length,0)).toBe(395)
    expect(p.draftPicks).toHaveLength(360)
    for (const [i,t] of p.teams.entries()) {
      const entries = fixture.teams[i].roster.entries
      expect(t.starterPlayerIds).toEqual(entries.filter(e => ![16,17,19].includes(e.lineupSlotId)).map(e=>String(e.playerPoolEntry.player.id)))
      expect(t.reservePlayerIds).toEqual(entries.filter(e => e.lineupSlotId===17).map(e=>String(e.playerPoolEntry.player.id)))
      expect(Object.values(t.playerMap).some(p => ['QB','RB','WR','TE','D/ST'].includes(p.position))).toBe(false)
    }
    expect(p.settings?.lineupSlotCounts.find(s=>s.slotId===0)?.slot).toBe('C')
    expect(p.settings?.raw).toEqual(fixture.settings)
    expect(p.transactionsFetched).toBe(false)
  })
  it('does not turn MLB wins stat 53 into NFL PPR', async () => {
    const n = await EspnAdapter.normalize(parseEspnMlbPayload(fixture,'MLB:2026:13262'))
    expect(n.league.scoring).toBe('H2H_MOST_CATEGORIES')
    expect(n.league.sport).toBe('MLB')
    expect(n.source.source_league_id).toBe('MLB:13262')
  })
  it('rejects a payload from a different sport-qualified league/season', () => {
    expect(()=>parseEspnMlbPayload(fixture,'MLB:2025:13262')).toThrow('different league or season')
  })
  it('dispatches a connected private account to flb without spoofed headers', async () => {
    vi.mocked(getDecryptedAuth).mockResolvedValue({espnSwid:'fixture-manager-1',espnS2:'synthetic-test-cookie'} as any)
    const f = vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>fixture}); vi.stubGlobal('fetch',f)
    const p = await fetchEspnLeagueForImport('test-user','MLB:2026:13262')
    expect(p.viewerTeamId).toBeTruthy()
    expect(f.mock.calls[0][0]).toContain('/games/flb/')
    expect(f.mock.calls[0][1].headers).toEqual({Accept:'application/json',Cookie:'SWID=fixture-manager-1; espn_s2=synthetic-test-cookie'})
    expect(f).toHaveBeenCalledTimes(1)
  })
  it.each([401,403])('stops on private authorization failure %s', async status => {
    vi.mocked(getDecryptedAuth).mockResolvedValue(null)
    const f=vi.fn().mockResolvedValue({ok:false,status}); vi.stubGlobal('fetch',f)
    await expect(fetchEspnMlbLeagueForImport('test','MLB:2026:13262')).rejects.toThrow('Connected Accounts')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('never polls the NFL communication endpoint for a persisted MLB league', async () => {
    const f=vi.fn(); vi.stubGlobal('fetch',f)
    expect(await fetchEspnActivityForSync('test','MLB:13262',2026)).toEqual({teams:[],transactions:[],transactionsFetched:false})
    expect(f).not.toHaveBeenCalled()
  })
})


it.each(['13262','MLB:13262'])('restores saved sport/year before refreshing ESPN baseball %s', externalLeagueId => {
  const source=buildProviderSourceRef({provider:'espn',externalLeagueId,sport:'MLB',season:2024})
  expect(source).toBe('MLB:2024:13262')
  expect(parseEspnMlbSource(source)).toEqual({leagueId:'13262',season:2024})
})
it('preserves explicitly scoped MLB inputs and existing football/MFL source encoding', () => {
  expect(buildProviderSourceRef({provider:'espn',externalLeagueId:'MLB:2023:13262',sport:'MLB',season:2024})).toBe('MLB:2023:13262')
  expect(buildProviderSourceRef({provider:'espn',externalLeagueId:'13262',sport:'NFL',season:2024})).toBe('13262:2024')
  expect(buildProviderSourceRef({provider:'mfl',externalLeagueId:'13262',sport:'NFL',season:2024})).toBe('13262:2024')
})
