import type { PlayoffPoint } from './weeklyPlayoffPath'
export function playoffInputChanges(previous:PlayoffPoint | undefined,current:PlayoffPoint | undefined,es=false):string[] {
  const a=previous?.inputs,b=current?.inputs
  if(!a||!b)return []
  const keys=['wins','losses','ties','seed','pointsFor','weeksRemaining','weeklyMean'] as const
  const labels:Record<typeof keys[number],string>=es?{wins:'Victorias',losses:'Derrotas',ties:'Empates',seed:'Posición',pointsFor:'Puntos a favor',weeksRemaining:'Períodos restantes',weeklyMean:'Media de puntuación modelada'}:{wins:'Wins',losses:'Losses',ties:'Ties',seed:'Seed',pointsFor:'Points for',weeksRemaining:'Periods remaining',weeklyMean:'Modeled scoring mean'}
  return keys.flatMap(key=>typeof a[key]==='number'&&typeof b[key]==='number'&&Number.isFinite(a[key])&&Number.isFinite(b[key])&&a[key]!==b[key] ? [`${labels[key]}: ${Number(a[key]!.toFixed(1))} → ${Number(b[key]!.toFixed(1))}`] : [])
}
