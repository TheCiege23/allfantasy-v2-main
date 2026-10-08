import type { WeeklyBlueprint, WeeklyAction } from './weeklyBlueprint'
import { weeklyActionText, weeklyActionReason, weeklyActionPrompt } from './weeklyBlueprint'
export type WeeklySwing = { id: string; leagueId: string; leagueName: string; sport: string; tone: 'risk' | 'opportunity' | 'check'; title: string; detail: string; href: string; prompt: string }
export function sportWeekAdvice(sport: string, es = false): string {
  const key = sport.toUpperCase()
  const advice: Record<string, [string,string]> = {
    NFL: ['Check bye weeks, injury designations and each player’s kickoff before replacing a starter.', 'Revisa descansos, lesiones y el inicio de cada jugador antes de cambiar un titular.'],
    NCAAF: ['Check college injury availability, bye weeks and the league’s eligible player pool.', 'Revisa lesiones universitarias, descansos y los jugadores elegibles de la liga.'],
    NBA: ['Check rest and back-to-backs. Confirm daily, weekly, Game Pick or Lock-In rules before using game volume.', 'Revisa descansos y partidos consecutivos. Confirma las reglas diarias, semanales, Game Pick o Lock-In antes de usar el volumen de partidos.'],
    NCAAB: ['Check college schedules, availability and category or points scoring before streaming.', 'Revisa calendarios universitarios, disponibilidad y puntuación por categorías o puntos antes de añadir jugadores.'],
    NHL: ['Review starting goalies, off-night games and category or points scoring before streaming.', 'Revisa porteros titulares, días con pocos partidos y puntuación por categorías o puntos antes de añadir jugadores.'],
    MLB: ['Review probable pitchers, confirmed batting lineups and innings/start limits before streaming.', 'Revisa lanzadores probables, alineaciones confirmadas y límites de entradas o aperturas antes de añadir jugadores.'],
    SOCCER: ['Check the gameweek, confirmed lineups, rotation and transfer/captain deadlines under this league’s rules.', 'Revisa la jornada, alineaciones confirmadas, rotaciones y plazos de transferencias o capitán según las reglas de la liga.'],
  }
  return (advice[key] ?? [ 'Confirm this sport’s scoring format, schedule and lineup rules before making changes.', 'Confirma el formato de puntuación, calendario y reglas de alineación antes de cambiar jugadores.'])[es ? 1 : 0]
}
export function buildWeeklySwings(data: WeeklyBlueprint, es = false): WeeklySwing[] {
  const contexts = data.sportPlans ?? []
  return data.actions.map((a: WeeklyAction) => {
    const context = contexts.find(c => c.leagueId === a.leagueId)
    const sport = context?.sport ?? ''
    const e = a.evidence
    const football = sport === 'NFL' || sport === 'NCAAF'
    const evidence = e ? es ? `Datos guardados: ${e.empty} huecos, ${e.out} ausentes, ${football ? `${e.bye ?? 'sin verificar'} en descanso` : 'revisa la cobertura del calendario'} y ${e.questionable} con dudas.` : `Stored lineup: ${e.empty} empty slots, ${e.out} unavailable, ${football ? `${e.bye ?? 'unchecked'} on bye` : 'review schedule coverage'} and ${e.questionable} questionable.` : ''
    const reason = a.kind === 'lineup' && sport && !football ? es ? 'Los huecos y las ausencias pueden afectar tu resultado; compara opciones elegibles según el formato.' : 'Empty slots and unavailable starters can affect your result; compare eligible options under your scoring format.' : weeklyActionReason(a,es)
    const players = e?.players?.length ? `${es ? 'Titulares para revisar' : 'Starters to review'}: ${e.players.join(', ')}.` : ''
    const branches = a.playoffScenarios ? `${es ? 'Probabilidad estimada si ganas' : 'Estimated playoff probability if you win'}: ${a.playoffScenarios.ifWin.toFixed(1)}%; ${es ? 'si pierdes' : 'if you lose'}: ${a.playoffScenarios.ifLose.toFixed(1)}%.` : ''
    const detail = [reason, evidence, players, branches, sportWeekAdvice(sport,es)].filter(Boolean).join(' ')
    return { id:a.id, leagueId:a.leagueId, leagueName:a.leagueName, sport, tone:a.kind === 'lineup' || a.kind === 'monitor' ? 'risk' as const : a.kind === 'playoff' ? 'opportunity' as const : 'check' as const,
      title:weeklyActionText(a,es), detail, href:a.href,
      prompt:`${weeklyActionPrompt(a,es)} ${detail}` }
  }).slice(0,3)
}
