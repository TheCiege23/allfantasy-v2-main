import { weeklyActionText, type WeeklyBlueprint } from './weeklyBlueprint'
import type { WeeklyPlayoffPath } from './weeklyPlayoffPath'
import { formatPct1 } from './weeklyPercent'

export const WEEK_SOCIALS = ['X', 'Facebook', 'Instagram', 'TikTok', 'Threads', 'LinkedIn', 'YouTube'] as const
export type WeekSocial = typeof WEEK_SOCIALS[number]
// Sharing a page link never grants access to another user's private league.
export const WEEK_PUBLIC_URL = 'https://www.allfantasy.ai/core/week'
export function rivalryNarrative(data: WeeklyBlueprint, es = false, firstPerson = false): string {
  const r = data.rivalry
  if (!r) return ''
  const record = es ? ` Serie importada: ${r.wins}-${r.losses}-${r.ties} (victorias-derrotas-empates).` : ` Imported series: ${r.wins}-${r.losses}-${r.ties} (wins-losses-ties).`
  if (r.winningStreak === 1) return (es
    ? `${firstPerson ? 'Gané' : 'Ganaste'} el último encuentro importado contra ${r.opponent}.${r.final ? '' : ' ¡Vamos por dos seguidos!'}`
    : `${firstPerson ? 'I won' : 'You won'} the last imported meeting with ${r.opponent}.${r.final ? '' : ' Let’s make it two in a row!'}`) + record
  if (r.winningStreak > 1) return (es
    ? `En los encuentros importados anteriores a este período, ${firstPerson ? 'gané' : 'ganaste'} ${r.winningStreak} veces seguidas contra ${r.opponent}.${r.final ? '' : ` ¡Vamos por ${r.winningStreak + 1}!`}`
    : `In imported meetings before this period, ${firstPerson ? 'I' : 'you'} beat ${r.opponent} ${r.winningStreak} straight times.${r.final ? '' : ` Let’s make it ${r.winningStreak + 1}!`}`) + record
  if (r.losingStreak > 0 && !r.final) return es
    ? `En el historial importado, ${r.opponent} ganó los últimos ${r.losingStreak} encuentros anteriores. Esta semana es una oportunidad para cambiar la historia.${record}`
    : `In imported history, ${r.opponent} won the last ${r.losingStreak} meetings before this period. This week is a chance to change the story.${record}`
  return es ? `Historial importado contra ${r.opponent}: ${r.wins}-${r.losses}-${r.ties} (victorias-derrotas-empates).`
    : `Imported series against ${r.opponent}: ${r.wins}-${r.losses}-${r.ties} (wins-losses-ties).`
}
function shortText(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max - 1).join('') + '…'
}
export function weeklySocialPost(data: WeeklyBlueprint, platform: WeekSocial, es = false): string {
  const team = data.teamName || (es ? 'Mi semana de fantasy' : 'My fantasy week')
  const story = rivalryNarrative(data, es, true)
  const next = data.actions[0]
  const action = next ? `${es ? 'Mi prioridad' : 'My priority'}: ${weeklyActionText(next, es)} (${next.leagueName}).` : ''
  const matchup = data.matchup ? `${es ? 'Período' : 'Period'} ${data.matchup.period}: vs ${data.matchup.opponent} (${data.matchup.leagueName}).` : ''
  const odds = data.playoff ? `${es ? 'Playoffs estimados' : 'Estimated playoff odds'} (${data.playoff.leagueName}): ${formatPct1(data.playoff.probability)}%.` : ''
  if (platform === 'X') return `${shortText([`${team}:`,matchup,odds,story || action].filter(Boolean).join(' '), 210)}\n#AllFantasy ${WEEK_PUBLIC_URL}`
  const hook = platform === 'TikTok' || platform === 'YouTube' ? es ? 'Mi plan de fantasy para esta semana 👇' : 'My fantasy blueprint for this week 👇' : `${team} · AllFantasy`
  return [hook,matchup,odds,action,story,data.playoff ? es ? 'Las probabilidades son estimaciones.' : 'Odds are estimates.' : '',es ? '¿Cuál es tu decisión más difícil esta semana?' : 'What’s your toughest decision this week?', '#AllFantasy #FantasySports', WEEK_PUBLIC_URL].filter(Boolean).join('\n\n')
}
export function commissionerWeekDraft(data: WeeklyBlueprint, es = false, path?: WeeklyPlayoffPath | null): string {
  return [es ? 'Resumen semanal de la liga' : 'League weekly briefing',
    data.matchup ? `${data.matchup.leagueName} · ${es ? 'Período' : 'Period'} ${data.matchup.period}` : '',
    data.sports.length ? `${es ? 'Deporte' : 'Sport'}: ${data.sports.join(', ')}.` : '',
    path?.swing ? es ? `Hay escenarios de playoffs para el período ${path.swing.week}. Revisa la clasificación antes de comentar quién puede clasificarse.` : `Playoff scenarios are available for period ${path.swing.week}. Review standings before naming qualification possibilities.` : '',
    path?.league?.assumptions.missing.length ? `${es ? 'Reglas o datos pendientes de revisar' : 'Rules or data to review'}: ${path.league.assumptions.missing.join(' ')}` : '',
    es ? 'Plazo oficial de alineación: [añade el horario y la zona horaria de la liga].' : 'Official lineup deadline: [add the league’s time and timezone].',
    es ? 'Correcciones de puntuación y anuncios: [añade las novedades confirmadas].' : 'Scoring corrections and announcements: [add confirmed updates].',
    es ? 'Revisa la clasificación, las reglas y los plazos de tu equipo antes del bloqueo.' : 'Review standings, rules and your team’s deadlines before lineup lock.',
    es ? 'Confirma los plazos oficiales y añade los anuncios de la liga antes de publicar.' : 'Confirm official deadlines and add league announcements before publishing.'].filter(Boolean).join('\n\n')
}

/** Only share scenarios proven to belong to this card's league, season and period. */
export function weeklyCardScenarios(data: WeeklyBlueprint, path?: WeeklyPlayoffPath | null) {
  const m = data.matchup, p = data.playoff, l = path?.league, s = path?.swing
  const percentage = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100
  if (!m?.leagueId || !m.season || !p || !l?.you?.modelled || !s || !path ||
    l.leagueId !== m.leagueId || p.leagueId !== m.leagueId || s.leagueId !== m.leagueId ||
    l.season !== m.season || p.season !== m.season || path.season !== m.season ||
    l.period !== m.period || p.period !== m.period || path.period !== m.period || s.week !== m.period ||
    !percentage(p.probability) || !percentage(l.you.playoffPct) || !percentage(s.ifWin) || !percentage(s.ifLose)) return null
  return {period:s.week,ifWin:s.ifWin,ifLose:s.ifLose}
}
/** Render user text with canvas APIs, never interpreted HTML or external assets. */
export function drawWeeklyShareCard(canvas: HTMLCanvasElement, data: WeeklyBlueprint, es = false, path?: WeeklyPlayoffPath | null): void {
  canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#0b1423'; ctx.fillRect(0,0,1080,1350)
  ctx.fillStyle = '#66e5c1'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(es ? 'ALLFANTASY · TU SEMANA' : 'ALLFANTASY · YOUR WEEK',64,90)
  let y = 180
  const wrap = (text: string, font: string, color: string, lineHeight: number, maxLines: number, x = 64, width = 930) => {
    ctx.font = font; ctx.fillStyle = color
    const words = text.split(/\s+/); const lines: string[] = []; let line = ''
    for (const raw of words) {
      // Bound unbroken names too, so an imported string cannot overflow the card.
      let word = raw
      while (ctx.measureText(word).width > width && word.length > 1) {
        let chunk = ''
        while (word.length && ctx.measureText(chunk + word[0]).width <= width - 30) { chunk += word[0]; word = word.slice(1) }
        if (line) { lines.push(line); line = '' }; lines.push(chunk)
      }
      if (ctx.measureText(`${line} ${word}`).width > width && line) { lines.push(line); line = word } else line = `${line} ${word}`.trim()
    }
    if (line) lines.push(line)
    lines.slice(0,maxLines).forEach((l,i) => {
      let text = l
      if (i === maxLines-1 && lines.length > maxLines) { while (ctx.measureText(text + '…').width > width) text = text.slice(0,-1); text += '…' }
      ctx.fillText(text,x,y); y += lineHeight
    })
  }
  wrap(data.teamName || (es ? 'Mi semana de fantasy' : 'My fantasy week'), 'bold 62px sans-serif','#ffffff',72,2)
  y = 285
  wrap([data.sports.join(' · '),data.matchup?.season ? String(data.matchup.season) : ''].filter(Boolean).join(' · '),'24px sans-serif','#66e5c1',30,1)
  y = 315
  wrap(data.matchup?.leagueName || `${data.leagueCount} ${es ? 'ligas' : 'leagues'} · ${data.sports.join(', ')}`, '32px sans-serif','#aabbd3',40,2)
  ctx.fillStyle = '#16283a'; ctx.fillRect(64,375,952,120)
  y = 425
  wrap(data.matchup ? `${es ? 'Período' : 'Period'} ${data.matchup.period} · vs ${data.matchup.opponent}` : es ? 'Mi plan para esta semana' : 'My plan for this week','38px sans-serif','#ffffff',48,2)
  const panel = (top: number,height: number) => { ctx.fillStyle = '#16283a'; ctx.fillRect(64,top,952,height) }
  panel(520,265); y = 565
  wrap(es ? 'MI CAMINO A LOS PLAYOFFS' : 'MY PLAYOFF PATH','bold 26px sans-serif','#aabbd3',34,1,92,880)
  const probability = data.playoff?.probability
  const valid = probability != null && Number.isFinite(probability) && probability >= 0 && probability <= 100 && (!data.matchup || (data.playoff?.leagueId === data.matchup.leagueId && data.playoff?.season === data.matchup.season && data.playoff?.period === data.matchup.period))
  ctx.lineWidth = 16; ctx.strokeStyle = '#30475c'; ctx.beginPath(); ctx.arc(192,672,70,0,Math.PI*2); ctx.stroke()
  if (valid && probability > 0) { ctx.strokeStyle = '#66e5c1'; ctx.beginPath(); ctx.arc(192,672,70,-Math.PI/2,-Math.PI/2+Math.PI*2*probability/100); ctx.stroke() }
  y = 678
  wrap(valid ? `${formatPct1(probability)}%` : es ? 'Sin estimación' : 'Estimate unavailable','bold 62px sans-serif','#66e5c1',70,1,300,680)
  y = 727
  wrap(valid ? `${es ? 'Estimación' : 'Estimate'} · ${data.playoff!.leagueName}` : es ? 'Revisa la clasificación y las reglas.' : 'Review standings and rules.','26px sans-serif','#d8e2f1',32,1,300,680)
  const scenario = weeklyCardScenarios(data,path)
  panel(815,150)
  y = 852
  wrap(scenario ? `${es ? 'PLAYOFFS SEGÚN EL RESULTADO · PERÍODO' : 'PLAYOFF ODDS BY RESULT · PERIOD'} ${scenario.period}` : es ? 'PREPARA TU PRÓXIMA DECISIÓN' : 'PREPARE YOUR NEXT DECISION','bold 24px sans-serif','#aabbd3',30,1,92,880)
  if (scenario) {
    y = 908; wrap(`${es ? 'Si gano' : 'If I win'}: ${formatPct1(scenario.ifWin)}%`,'bold 34px sans-serif','#66e5c1',42,1,92,420)
    y = 908; wrap(`${es ? 'Si pierdo' : 'If I lose'}: ${formatPct1(scenario.ifLose)}%`,'bold 34px sans-serif','#f6bf87',42,1,552,420)
  } else {
    y = 900; wrap(es ? 'Compara tus opciones y comprueba los plazos de tu liga.' : 'Compare your options and check your league’s deadlines.','30px sans-serif','#d8e2f1',38,2,92,880)
  }
  panel(990,185); y = 1030
  wrap(es ? 'MI PRÓXIMA PRIORIDAD' : 'MY NEXT PRIORITY','bold 26px sans-serif','#aabbd3',34,1,92,880)
  y = 1080
  wrap(data.actions[0] ? weeklyActionText(data.actions[0],es) : es ? 'Revisar mi equipo y sus reglas' : 'Review my team and its rules','34px sans-serif','#ffffff',42,2,92,880)
  y = 1152
  if (data.actions[0]) wrap(data.actions[0].leagueName,'24px sans-serif','#aabbd3',30,1,92,880)
  const story = rivalryNarrative(data,es,true)
  y = 1210
  wrap(story || (es ? 'Mi semana. Mis ligas. Mi próxima decisión.' : 'My week. My leagues. My next decision.'),'26px sans-serif','#d8e2f1',32,2)
  ctx.font = '24px sans-serif'; ctx.fillStyle = '#aabbd3'
  ctx.fillText(es ? 'Estimaciones, no garantías. Historial importado.' : 'Estimates, not guarantees. Imported history.',64,1280)
  ctx.fillText('allfantasy.ai · #AllFantasy',64,1322)
}
