/**
 * The war room is about the week being played. It named and ranked the last SCORED week, and a week is
 * scored only when it is chopped, so from week 2 on its tiers could never be live and "this week" was
 * last week's settled score.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'lib/guillotine-war-room/guillotineWarRoomContext.ts'), 'utf8').replace(/\r\n/g, '\n')

describe('guillotine war room week', () => {
  it('the week on screen is the live week', () => {
    expect(src).toMatch(/^\s*const currentWeek = await resolveGuillotineLiveWeek\(leagueId, config\)/m)
  })
  it('the danger tiers are asked for the live week', () => {
    expect(src).toMatch(/^\s*const \{ rows: dangerRows, live: dangerLive \} = await getLiveDangerTiers\(\{ leagueId, weekOrPeriod: currentWeek \}\)/m)
  })
  it('settled totals come from the last scored week, and are never shown as this week’s score', () => {
    expect(src).toMatch(/^\s*\.findMany\(\{ where: \{ leagueId, weekOrPeriod: scoredWeek \}/m)
    expect(src).toMatch(/^\s*periodPoints: dangerLive && danger \? danger\.projectedPoints : scoredWeek === currentWeek \? score\?\.periodPoints \?\? null : null,$/m)
  })
})
