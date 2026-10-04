import { weeklyBrief, weeklyActionText, type WeeklyBlueprint } from './weeklyBlueprint'

export const WEEK_SOCIALS = ['X', 'Facebook', 'Instagram', 'TikTok', 'Threads', 'LinkedIn', 'YouTube'] as const
export type WeekSocial = typeof WEEK_SOCIALS[number]
// Sharing a page link never grants access to another user's private league.
export const WEEK_PUBLIC_URL = 'https://www.allfantasy.ai/core/week'
export function rivalryNarrative(data: WeeklyBlueprint, es = false): string {
  const r = data.rivalry
  if (!r) return ''
  if (r.winningStreak > 0) return es
    ? `En los encuentros importados anteriores a este período, ganaste ${r.winningStreak} veces seguidas contra ${r.opponent}.${r.final ? '' : ` ¡Vamos por ${r.winningStreak + 1}!`}`
    : `In imported meetings before this period, you beat ${r.opponent} ${r.winningStreak} straight time${r.winningStreak === 1 ? '' : 's'}.${r.final ? '' : ` Let’s make it ${r.winningStreak + 1}!`}`
  if (r.losingStreak > 0 && !r.final) return es
    ? `En el historial importado, ${r.opponent} ganó los últimos ${r.losingStreak} encuentros anteriores. Esta semana es una oportunidad para cambiar la historia.`
    : `In imported history, ${r.opponent} won the last ${r.losingStreak} meetings before this period. This week is a chance to change the story.`
  return es ? `Historial importado contra ${r.opponent}: ${r.wins}-${r.losses}-${r.ties} (victorias-derrotas-empates).`
    : `Imported series against ${r.opponent}: ${r.wins}-${r.losses}-${r.ties} (wins-losses-ties).`
}
function shortText(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max - 1).join('') + '…'
}
export function weeklySocialPost(data: WeeklyBlueprint, platform: WeekSocial, es = false): string {
  const team = data.teamName || (es ? 'mi semana de fantasy' : 'my fantasy week')
  const story = rivalryNarrative(data, es)
  const next = data.actions[0]
  const action = next ? `${weeklyActionText(next, es)} (${next.leagueName}).` : ''
  const odds = data.playoff ? `${es ? 'Playoffs estimados' : 'Estimated playoff odds'}: ${data.playoff.probability.toFixed(1)}%.` : ''
  if (platform === 'X') return `${shortText(`${team}: ${story || action} ${odds}`.trim(), 210)}\n#AllFantasy ${WEEK_PUBLIC_URL}`
  const hook = platform === 'TikTok' || platform === 'YouTube' ? es ? 'Mi plan de fantasy para esta semana 👇' : 'My fantasy blueprint for this week 👇' : `${team} · AllFantasy`
  return [hook, weeklyBrief(data, es), story, es ? '¿Cuál es tu decisión más difícil esta semana?' : 'What’s your toughest decision this week?', '#AllFantasy #FantasySports', WEEK_PUBLIC_URL].filter(Boolean).join('\n\n')
}
export function commissionerWeekDraft(data: WeeklyBlueprint, es = false): string {
  return [es ? 'Resumen semanal de la liga' : 'League weekly briefing',
    data.matchup ? `${data.matchup.leagueName} · ${es ? 'Período' : 'Period'} ${data.matchup.period}` : '',
    es ? 'Revisa la clasificación, las reglas y los plazos de tu equipo antes del bloqueo.' : 'Review standings, rules and your team’s deadlines before lineup lock.',
    es ? 'Confirma los plazos oficiales y añade los anuncios de la liga antes de publicar.' : 'Confirm official deadlines and add league announcements before publishing.'].filter(Boolean).join('\n\n')
}

/** Render user text with canvas APIs, never interpreted HTML or external assets. */
export function drawWeeklyShareCard(canvas: HTMLCanvasElement, data: WeeklyBlueprint, es = false): void {
  canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#0b1423'; ctx.fillRect(0,0,1080,1350)
  ctx.fillStyle = '#66e5c1'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('ALLFANTASY · YOUR WEEK',64,100)
  let y = 185
  const wrap = (text: string, font: string, color: string, lineHeight: number, maxLines: number) => {
    ctx.font = font; ctx.fillStyle = color
    const words = text.split(/\s+/); const lines: string[] = []; let line = ''
    for (const raw of words) {
      // Bound unbroken names too, so an imported string cannot overflow the card.
      let word = raw
      while (ctx.measureText(word).width > 930 && word.length > 1) {
        let chunk = ''
        while (word.length && ctx.measureText(chunk + word[0]).width <= 900) { chunk += word[0]; word = word.slice(1) }
        if (line) { lines.push(line); line = '' }; lines.push(chunk)
      }
      if (ctx.measureText(`${line} ${word}`).width > 930 && line) { lines.push(line); line = word } else line = `${line} ${word}`.trim()
    }
    if (line) lines.push(line)
    lines.slice(0,maxLines).forEach((l,i) => { ctx.fillText(i === maxLines-1 && lines.length > maxLines ? shortText(l,40) + '…' : l,64,y); y += lineHeight })
    y += 30
  }
  wrap(data.teamName || (es ? 'Mi plan de fantasy' : 'My fantasy blueprint'), 'bold 64px sans-serif','#ffffff',76,2)
  if (data.matchup) wrap(`${es ? 'Período' : 'Period'} ${data.matchup.period} · vs ${data.matchup.opponent}`,'40px sans-serif','#d8e2f1',54,2)
  if (data.playoff) wrap(`${data.playoff.probability.toFixed(1)}% · ${es ? 'playoffs estimados' : 'estimated playoff odds'}`,'bold 46px sans-serif','#66e5c1',56,2)
  if (data.actions[0]) wrap(weeklyActionText(data.actions[0],es),'40px sans-serif','#ffffff',52,2)
  const story = rivalryNarrative(data,es)
  if (story) wrap(story,'36px sans-serif','#d8e2f1',48,3)
  ctx.font = '28px sans-serif'; ctx.fillStyle = '#aabbd3'
  ctx.fillText(es ? 'Estimaciones, no garantías. Historial importado.' : 'Estimates, not guarantees. Imported history.',64,1225)
  ctx.fillText('allfantasy.ai · #AllFantasy',64,1280)
}
