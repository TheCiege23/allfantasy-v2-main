import {beforeEach,expect,it,vi} from 'vitest'
const {session,league,ledger}=vi.hoisted(()=>({session:vi.fn(),league:vi.fn(),ledger:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findFirst:league}}}))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService',()=>({getTradeGrades:ledger}))
vi.mock('next/og',()=>({ImageResponse:class {status=200;constructor(public node:unknown){}}}))
import {GET} from '@/app/api/share/trade-card/route'
function texts(node:unknown):string[]{
  if(node==null||typeof node==='boolean')return []
  if(typeof node==='string'||typeof node==='number')return [String(node)]
  if(Array.isArray(node))return node.flatMap(texts)
  const element=node as {type?:unknown;props?:Record<string,unknown>}
  return typeof element.type==='function'?texts((element.type as (props:unknown)=>unknown)(element.props)):texts(element.props?.children)
}
const side={rosterId:1,managerName:'Casey Smith',teamName:'Ice Kings',avatar:null,playersIn:[{name:'Josh Allen',creditedBySeason:{'2026':100}}],playersOut:[],picksIn:[],picksOut:[],seasonNets:[{season:'2026',net:100}],cumulativeNet:100,trend:'improving'}
beforeEach(()=>{vi.clearAllMocks();session.mockResolvedValue({user:{id:'u'}});league.mockResolvedValue({id:'l',name:'League name',platform:'sleeper',platformLeagueId:'p'});ledger.mockResolvedValue({trades:[{id:'t',season:'2026',week:4,tie:false,sides:[side]}]})})
const request=(lang?:string,cookie?:string)=>({nextUrl:new URL(`http://x/api/share/trade-card?leagueId=l&tradeId=t${lang?`&lang=${lang}`:''}`),cookies:{get:()=>cookie?{value:cookie}:undefined}})
it('draws Spanish, then English result images with original manager and player identities',async()=>{
  const spanish=texts((await GET(request('es') as never) as unknown as {node:unknown}).node).join(' | ')
  expect(spanish).toContain('¿QUIÉN GANÓ EL INTERCAMBIO?')
  expect(spanish).toContain('GANÓ')
  expect(spanish).toContain('resultado hasta ahora · mejorando')
  expect(spanish).toContain('100,0')
  expect(spanish).toContain('Casey Smith')
  expect(spanish).toContain('Josh Allen')
  const english=texts((await GET(request('en','es') as never) as unknown as {node:unknown}).node).join(' | ')
  expect(english).toContain('WHO WON THIS TRADE?')
  expect(english).toContain('WON')
  expect(english).not.toContain('GANÓ')
})
it('uses the preference cookie when the image URL has no language',async()=>{
  const words=texts((await GET(request(undefined,'es') as never) as unknown as {node:unknown}).node).join(' | ')
  expect(words).toContain('¿QUIÉN GANÓ EL INTERCAMBIO?')
})
