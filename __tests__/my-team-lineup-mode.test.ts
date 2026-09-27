import { expect, it } from 'vitest'
import { isBestBallSettings } from '@/lib/core-app/lineupMode'
import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
it('uses explicit provider rules rather than the league name', () => {
 expect(isBestBallSettings({best_ball:1})).toBe(true)
 expect(isBestBallSettings({raw_settings:{best_ball:1}})).toBe(true)
 expect(isBestBallSettings({name:'Dynasty BestBall League!',isDynasty:true})).toBe(false)
 expect(isBestBallSettings({best_ball:0})).toBe(false)
})
it('preserves the provider Best Ball flag through import normalization', () => {
 const source={league:{league_id:'123',name:'Neutral name',season:'2026',sport:'nfl',total_rosters:12,settings:{type:2,best_ball:1},roster_positions:['QB','BN']}}
 expect(SleeperLeagueMapper.map(source as any)?.best_ball).toBe(true)
 expect(SleeperLeagueMapper.map({...source,league:{...source.league,settings:{type:2,best_ball:0}}} as any)?.best_ball).toBe(false)
})
