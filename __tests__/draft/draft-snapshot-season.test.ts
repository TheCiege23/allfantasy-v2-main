import {describe,expect,it,vi} from 'vitest'
const state = vi.hoisted(() => ({reads:[] as {model:string,args:any}[]}))
vi.mock('@/lib/prisma', () => ({prisma:new Proxy({}, {get:(_target,model:string) => ({findFirst:vi.fn(async args => {state.reads.push({model,args});return null})})})}))
import {getFantasyValueSnapshot} from '@/lib/sports-reporting/FantasyValueSnapshotService'
describe('draft snapshot observed season', () => {
 it.each(['NFL','NBA','NHL','MLB','NCAAF','NCAAB','SOCCER'])('reads the requested season for %s', async sport => {
  state.reads=[]
  await getFantasyValueSnapshot({sport,playerName:'Fixture Player',season:2025})
  expect(state.reads.find(read=>read.model==='playerSeasonStats')?.args.where).toMatchObject({sport,season:'2025'})
 })
})
