import type { WeeklyBlueprint, WeeklyAction } from './weeklyBlueprint'
import { weeklyActionText, weeklyActionReason, weeklyActionPrompt } from './weeklyBlueprint'
import { messagesFor } from '@/lib/i18n/messages'
import { weeklySportPlanMessages } from './messages/weeklySportPlan'
import { langFromFlag } from './messages/coreLocale'
const copy = (es: boolean) => messagesFor(weeklySportPlanMessages, langFromFlag(es))
type WeeklySwing = { id: string; leagueId: string; leagueName: string; sport: string; tone: 'risk' | 'opportunity' | 'check'; title: string; detail: string; href: string; prompt: string }
export function sportWeekAdvice(sport: string, es = false): string {
  const key = sport.toUpperCase()
  const m = copy(es)
  const advice: Record<string, string> = {
    NFL: m.adviceNFL,
    NCAAF: m.adviceNCAAF,
    NBA: m.adviceNBA,
    NCAAB: m.adviceNCAAB,
    NHL: m.adviceNHL,
    MLB: m.adviceMLB,
    SOCCER: m.adviceSOCCER,
  }
  return advice[key] ?? m.adviceDefault
}
export function buildWeeklySwings(data: WeeklyBlueprint, es = false): WeeklySwing[] {
  const contexts = data.sportPlans ?? []
  /* 2026-11-14: a sport's advice ("Check bye weeks, injury designations…") once per list, on its first card. */
  const advised = new Set<string>()
  return data.actions.map((a: WeeklyAction) => {
    const context = contexts.find(c => c.leagueId === a.leagueId)
    const sport = context?.sport ?? ''
    const e = a.evidence
    const football = sport === 'NFL' || sport === 'NCAAF'
    const m = copy(es)
    const evidence = e ? m.evidence(e.empty, e.out, football, e.bye, e.questionable) : ''
    const reason = a.kind === 'lineup' && sport && !football ? m.lineupReason : weeklyActionReason(a,es)
    const players = e?.players?.length ? `${m.startersToReview}: ${e.players.join(', ')}.` : ''
    const branches = a.playoffScenarios ? `${m.ifWinProbability}: ${a.playoffScenarios.ifWin.toFixed(1)}%; ${m.ifLose}: ${a.playoffScenarios.ifLose.toFixed(1)}%.` : ''
    const advice = sportWeekAdvice(sport,es)
    const firstForSport = !advised.has(sport)
    advised.add(sport)
    const detail = [reason, evidence, players, branches, firstForSport ? advice : ''].filter(Boolean).join(' ')
    /* Chimmy's prompt keeps the advice on every card: each prompt is read on its own. */
    const promptDetail = [reason, evidence, players, branches, advice].filter(Boolean).join(' ')
    return { id:a.id, leagueId:a.leagueId, leagueName:a.leagueName, sport, tone:a.kind === 'lineup' || a.kind === 'monitor' ? 'risk' as const : a.kind === 'playoff' ? 'opportunity' as const : 'check' as const,
      title:weeklyActionText(a,es), detail, href:a.href,
      prompt:`${weeklyActionPrompt(a,es)} ${promptDetail}` }
  }).slice(0,3)
}
