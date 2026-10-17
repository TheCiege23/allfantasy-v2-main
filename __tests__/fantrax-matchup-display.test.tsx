import {describe,expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {MatchupView} from '@/app/league/[leagueId]/tabs/redraft/MatchupView'
describe('Fantrax source score display',()=>{
 it('renders unplayed source fixtures as missing scores without crashing',()=>{const markup=renderToStaticMarkup(<MatchupView sport="NCAAF" selectedRosterId="a" matchup={{id:'source',week:6,status:'scheduled',homeRosterId:'a',awayRosterId:'b',homeRoster:{id:'a',teamName:'Alpha',wins:0,losses:0,pointsFor:0},awayRoster:{id:'b',teamName:'Beta',wins:0,losses:0,pointsFor:0},homeScore:null,awayScore:null,source:'fantrax',readOnly:true,scoringEvidence:{teamScores:'fantrax',individualSourceScores:'unavailable',message:'Individual source scores are unavailable.'}}} />);expect(markup).toContain('Fantrax totals');expect(markup).toContain('Individual source scores are unavailable.');expect(markup).toContain('—');expect(markup).not.toContain('0.00')})
})
