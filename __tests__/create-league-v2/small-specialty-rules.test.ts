import {describe,it,expect} from 'vitest'
import {validateCreatePayload} from '@/lib/league-creation/canonical/validateCreateLeague'
import {getValidGuillotineTeamCountRange,validateGuillotineCreation} from '@/lib/guillotine/GuillotineValidation'
import {normalizeBestBallSettings} from '@/lib/bestball/rules'
const base={sport:'NFL',teamCount:4,draftType:'snake',scoringPreset:'fb_ppr',leagueName:'Four-team rules'}
describe('small specialty league rules',()=>{
 it.each(['dynasty','keeper','best_ball','guillotine'])('accepts a four-team %s through canonical validation',concept=>{expect(validateCreatePayload({...base,concept}).ok).toBe(true)})
 it('fits an unspecified best-ball playoff field to the league size',()=>{expect(normalizeBestBallSettings({sport:'NFL',teamCount:4}).playoffTeams).toBe(4)})
 it('refuses explicitly oversized best-ball playoffs',()=>{expect(validateCreatePayload({...base,concept:'best_ball',conceptSetup:{bestBall:{playoffTeams:6}}}).ok).toBe(false)})
 it('accepts four NFL guillotine teams in the secondary validation path',async()=>{
  expect((await getValidGuillotineTeamCountRange('NFL')).min).toBe(4)
  expect((await validateGuillotineCreation({sport:'NFL',teamCount:4,rosterMode:'redraft',draftType:'snake'})).valid).toBe(true)
 })
})
