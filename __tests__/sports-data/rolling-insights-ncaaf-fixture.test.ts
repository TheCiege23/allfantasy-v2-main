import {readFileSync} from 'node:fs'
import path from 'node:path'
import {describe,it,expect} from 'vitest'
import {normalizeRiGameBox} from '@/lib/sports-data/rollingInsightsGameLogs'
const games=JSON.parse(readFileSync(path.join(process.cwd(),'contracts/rolling-insights/fixtures/live.NCAAFB.json'),'utf8')).data.NCAAFB as Record<string,any>[]
describe('captured NCAAF RI box contract',()=>{
 it('extracts every source player with RI ID provenance',()=>{
  expect(games).toHaveLength(54)
  let total=0
  for(const g of games){const box=normalizeRiGameBox(g)!;const count=Object.values(g.player_box).reduce((sum:number,side:any)=>sum+Object.keys(side).length,0);expect(box.lines).toHaveLength(count);expect(box.season).toBe(2026);expect(box.weekOrRound).toBe(5);expect(box.lines.every(l=>/^\d+$/.test(l.providerPlayerId))).toBe(true);total+=box.lines.length}
  expect(total).toBe(3588)
 })
 it('preserves distances and reconciles every kicker against source made totals',()=>{
  let count=0
  for(const g of games)for(const line of normalizeRiGameBox(g)!.lines){if(line.raw.field_goals_made===undefined)continue;const distances=line.raw.field_goal_distances as number[];expect(Array.isArray(distances)).toBe(true);expect(distances).toHaveLength(Number(line.raw.field_goals_made));expect(distances.every(v=>Number.isInteger(v)&&v>0)).toBe(true);count++}
  expect(count).toBe(107)
 })
 it('does not claim missing advanced player fields are observed zeros',()=>{
  const keys=new Set(games.flatMap(g=>normalizeRiGameBox(g)!.lines.flatMap(l=>Object.keys(l.raw))))
  expect(keys.has('two_point_conversions')).toBe(false)
  expect(keys.has('forced_fumbles')).toBe(false)
  expect(keys.has('assisted_tackles')).toBe(false)
 })
})
