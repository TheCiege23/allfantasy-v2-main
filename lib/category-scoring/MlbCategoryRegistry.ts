import type { CategoryDefinition, TeamStatTotals } from './types'
import { computeCategoryValue } from './CategoryMatchupResolver'
const count = (id: string, key = id): CategoryDefinition => ({id, label:id.toUpperCase(), direction:'higher', computation:{kind:'sum',statKey:key}})
export const MLB_FIVE_BY_FIVE: readonly CategoryDefinition[] = [
  count('r'), count('hr'), count('rbi'), count('sb'),
  {id:'avg',label:'AVG',direction:'higher',computation:{kind:'ratio',numeratorStatKey:'h',denominatorStatKey:'ab',unqualifiedWhenZero:true}},
  count('w'),count('sv'),count('k','so'),
  {id:'era',label:'ERA',direction:'lower',computation:{kind:'ratio',numeratorStatKey:'er',denominatorStatKey:'outs',multiplier:27,unqualifiedWhenZero:true}},
  {id:'whip',label:'WHIP',direction:'lower',computation:{kind:'ratio',numeratorStatKey:'p_h',additionalNumeratorStatKeys:['p_bb'],denominatorStatKey:'outs',multiplier:3,unqualifiedWhenZero:true}},
]
/** All categories use components present in the captured RI box-score contract. */
export const MLB_SIX_BY_SIX: readonly CategoryDefinition[] = [...MLB_FIVE_BY_FIVE,count('tb'),count('hld')]

/** Roto ties split the occupied rank points; missing rate qualifications place last. */
export function rankRotisserieTeams(teams: ReadonlyArray<{id:string;stats:TeamStatTotals}>, categories: readonly CategoryDefinition[]) {
  const result = new Map(teams.map(t=>[t.id,{total:0,categories:{} as Record<string,{value:number|null;points:number}>}]))
  for (const category of categories) {
    const sorted = teams.map(t=>({id:t.id,value:computeCategoryValue(t.stats,category)})).sort((a,b)=>{
      if (a.value===b.value) return 0
      if (a.value===null) return 1
      if (b.value===null) return -1
      return category.direction==='higher' ? b.value-a.value : a.value-b.value
    })
    for (let start=0;start<sorted.length;) {
      let end=start+1
      while (end<sorted.length && sorted[end].value===sorted[start].value) end++
      const points = sorted.length - (start+end-1)/2
      for(let i=start;i<end;i++) {
        const r=result.get(sorted[i].id)!
        r.total+=points; r.categories[category.id]={value:sorted[i].value,points}
      }
      start=end
    }
  }
  return result
}
