import { weeklyActionText, type WeeklyBlueprint } from './weeklyBlueprint'
import type { WeeklyPlayoffPath } from './weeklyPlayoffPath'

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
  const odds = data.playoff ? `${es ? 'Playoffs estimados' : 'Estimated playoff odds'} (${data.playoff.leagueName}): ${data.playoff.probability.toFixed(1)}%.` : ''
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

/** Render user text with canvas APIs, never interpreted HTML or external assets. */
export function drawWeeklyShareCard(canvas: HTMLCanvasElement, data: WeeklyBlueprint, es = false): void {
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
  y = 315
  wrap(data.matchup?.leagueName || `${data.leagueCount} ${es ? 'ligas' : 'leagues'} · ${data.sports.join(', ')}`, '32px sans-serif','#aabbd3',40,2)
  y = 415
  wrap(data.matchup ? `${es ? 'Período' : 'Period'} ${data.matchup.period} · vs ${data.matchup.opponent}` : es ? 'Mi plan para esta semana' : 'My plan for this week','38px sans-serif','#ffffff',48,2)
  const panel = (top: number,height: number) => { ctx.fillStyle = '#16283a'; ctx.fillRect(64,top,952,height) }
  panel(520,265); y = 565
  wrap(es ? 'MI CAMINO A LOS PLAYOFFS' : 'MY PLAYOFF PATH','bold 26px sans-serif','#aabbd3',34,1,92,880)
  y = 652
  wrap(data.playoff ? `${data.playoff.probability.toFixed(1)}%` : es ? 'Sin estimación' : 'Estimate unavailable','bold 76px sans-serif','#66e5c1',80,1,92,880)
  ctx.fillStyle = '#30475c'; ctx.fillRect(92,685,896,12)
  if (data.playoff) { ctx.fillStyle = '#66e5c1'; ctx.fillRect(92,685,896 * Math.max(0,Math.min(100,data.playoff.probability))/100,12) }
  y = 736
  wrap(data.playoff ? `${es ? 'Estimación' : 'Estimate'} · ${data.playoff.leagueName}` : es ? 'Revisa la clasificación y las reglas de la liga.' : 'Review league standings and rules.','26px sans-serif','#d8e2f1',32,1,92,880)
  panel(815,205); y = 862
  wrap(es ? 'MI PRÓXIMA PRIORIDAD' : 'MY NEXT PRIORITY','bold 26px sans-serif','#aabbd3',34,1,92,880)
  y = 913
  wrap(data.actions[0] ? weeklyActionText(data.actions[0],es) : es ? 'Revisar mi equipo y sus reglas' : 'Review my team and its rules','34px sans-serif','#ffffff',42,2,92,880)
  y = 995
  if (data.actions[0]) wrap(data.actions[0].leagueName,'24px sans-serif','#aabbd3',30,1,92,880)
  const story = rivalryNarrative(data,es,true)
  y = 1070
  wrap(story || (es ? 'Mi semana. Mis ligas. Mi próxima decisión.' : 'My week. My leagues. My next decision.'),'28px sans-serif','#d8e2f1',36,4)
  ctx.font = '28px sans-serif'; ctx.fillStyle = '#aabbd3'
  ctx.fillText(es ? 'Estimaciones, no garantías. Historial importado.' : 'Estimates, not guarantees. Imported history.',64,1225)
  ctx.fillText('allfantasy.ai · #AllFantasy',64,1280)
}
