// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),league:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findUnique:m.league}}}))
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error('REDIRECT:'+url)},notFound:()=>{throw new Error('NOT_FOUND')}}))
vi.mock('@/app/zombie/components/commissioner/ZombieSetupPanel',()=>({ZombieSetupPanel:()=>null}))
vi.mock('@/app/zombie/components/commissioner/ZombieUniversePanel',()=>({ZombieUniversePanel:()=>null}))
vi.mock('@/app/zombie/components/commissioner/ZombieStatusBoardCard',()=>({ZombieStatusBoardCard:()=>null}))
import Dashboard from '@/app/league/[leagueId]/zombie-commissioner/page'
describe('dedicated Zombie commissioner page',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({user:{id:'owner'}})})
 it('requires sign-in before reading the league',async()=>{
  m.session.mockResolvedValue(null)
  await expect(Dashboard({params:Promise.resolve({leagueId:'league'})})).rejects.toThrow('REDIRECT:/login')
  expect(m.league).not.toHaveBeenCalled()
 })
 it('rejects a member before returning commissioner controls',async()=>{
  m.league.mockResolvedValue({userId:'someone',zombieLeague:{universeId:null,universe:null}})
  await expect(Dashboard({params:Promise.resolve({leagueId:'league'})})).rejects.toThrow('NOT_FOUND')
 })
 it('serves standalone owners',async()=>{
  m.league.mockResolvedValue({userId:'owner',zombieLeague:{universeId:null,universe:null}})
  expect(await Dashboard({params:Promise.resolve({leagueId:'league'})})).toBeTruthy()
 })
 it('serves the current universe owner but rejects a superseded creator',async()=>{
  m.league.mockResolvedValue({userId:'someone',zombieLeague:{universeId:'u',universe:{commissionedByUserId:'owner',createdByUserId:'previous'}}})
  expect(await Dashboard({params:Promise.resolve({leagueId:'league'})})).toBeTruthy()
  m.session.mockResolvedValue({user:{id:'previous'}})
  await expect(Dashboard({params:Promise.resolve({leagueId:'league'})})).rejects.toThrow('NOT_FOUND')
 })
})
