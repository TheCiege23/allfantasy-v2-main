import { weeklyActionText, type WeeklyBlueprint } from './weeklyBlueprint'
import type { WeeklyPlayoffPath } from './weeklyPlayoffPath'
import { formatPct1 } from './weeklyPercent'
import { messagesFor } from '@/lib/i18n/messages'
import { weeklyShareTextMessages } from './messages/weeklyShareText'
import { langFromFlag } from './messages/coreLocale'

const copy = (es: boolean) => messagesFor(weeklyShareTextMessages, langFromFlag(es))

export const WEEK_SOCIALS = ['X', 'Facebook', 'Instagram', 'TikTok', 'Threads', 'LinkedIn', 'YouTube'] as const
export type WeekSocial = typeof WEEK_SOCIALS[number]
// Sharing a page link never grants access to another user's private league.
export const WEEK_PUBLIC_URL = 'https://www.allfantasy.ai/core/week'
export function rivalryNarrative(data: WeeklyBlueprint, es = false, firstPerson = false): string {
  const r = data.rivalry
  if (!r) return ''
  const c = copy(es)
  const record = c.record(r.wins, r.losses, r.ties)
  if (r.winningStreak === 1) return c.wonLast(firstPerson, r.opponent, r.final) + record
  if (r.winningStreak > 1) return c.wonStreak(firstPerson, r.opponent, r.winningStreak, r.final) + record
  if (r.losingStreak > 0 && !r.final) return c.lostStreak(r.opponent, r.losingStreak, record)
  return c.series(r.opponent, r.wins, r.losses, r.ties)
}
function shortText(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max - 1).join('') + '…'
}
export function weeklySocialPost(data: WeeklyBlueprint, platform: WeekSocial, es = false): string {
  const c = copy(es)
  const team = data.teamName || c.myFantasyWeek
  const story = rivalryNarrative(data, es, true)
  const next = data.actions[0]
  const action = next ? `${c.myPriority}: ${weeklyActionText(next, es)} (${next.leagueName}).` : ''
  const matchup = data.matchup ? `${c.period} ${data.matchup.period}: vs ${data.matchup.opponent} (${data.matchup.leagueName}).` : ''
  const odds = data.playoff ? `${c.estimatedPlayoffOdds} (${data.playoff.leagueName}): ${formatPct1(data.playoff.probability)}%.` : ''
  if (platform === 'X') return `${shortText([`${team}:`,matchup,odds,story || action].filter(Boolean).join(' '), 210)}\n#AllFantasy ${WEEK_PUBLIC_URL}`
  const hook = platform === 'TikTok' || platform === 'YouTube' ? c.videoHook : `${team} · AllFantasy`
  return [hook,matchup,odds,action,story,data.playoff ? c.oddsAreEstimates : '',c.toughestDecision, '#AllFantasy #FantasySports', WEEK_PUBLIC_URL].filter(Boolean).join('\n\n')
}
export function commissionerWeekDraft(data: WeeklyBlueprint, es = false, path?: WeeklyPlayoffPath | null): string {
  const c = copy(es)
  return [c.leagueBriefing,
    data.matchup ? `${data.matchup.leagueName} · ${c.period} ${data.matchup.period}` : '',
    data.sports.length ? `${c.sport}: ${data.sports.join(', ')}.` : '',
    path?.swing ? c.playoffScenarios(path.swing.week) : '',
    path?.league?.assumptions.missing.length ? `${c.rulesToReview}: ${path.league.assumptions.missing.join(' ')}` : '',
    c.lineupDeadline,
    c.scoringCorrections,
    c.reviewBeforeLock,
    c.confirmBeforePublishing].filter(Boolean).join('\n\n')
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
  const c = copy(es)
  ctx.fillStyle = '#0b1423'; ctx.fillRect(0,0,1080,1350)
  ctx.fillStyle = '#66e5c1'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(c.cardTitle,64,90)
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
  wrap(data.teamName || c.myFantasyWeek, 'bold 62px sans-serif','#ffffff',72,2)
  y = 285
  wrap([data.sports.join(' · '),data.matchup?.season ? String(data.matchup.season) : ''].filter(Boolean).join(' · '),'24px sans-serif','#66e5c1',30,1)
  y = 315
  wrap(data.matchup?.leagueName || `${data.leagueCount} ${c.leagues} · ${data.sports.join(', ')}`, '32px sans-serif','#aabbd3',40,2)
  ctx.fillStyle = '#16283a'; ctx.fillRect(64,375,952,120)
  y = 425
  wrap(data.matchup ? `${c.period} ${data.matchup.period} · vs ${data.matchup.opponent}` : c.myPlanThisWeek,'38px sans-serif','#ffffff',48,2)
  const panel = (top: number,height: number) => { ctx.fillStyle = '#16283a'; ctx.fillRect(64,top,952,height) }
  panel(520,265); y = 565
  wrap(c.myPlayoffPath,'bold 26px sans-serif','#aabbd3',34,1,92,880)
  const probability = data.playoff?.probability
  const valid = probability != null && Number.isFinite(probability) && probability >= 0 && probability <= 100 && (!data.matchup || (data.playoff?.leagueId === data.matchup.leagueId && data.playoff?.season === data.matchup.season && data.playoff?.period === data.matchup.period))
  ctx.lineWidth = 16; ctx.strokeStyle = '#30475c'; ctx.beginPath(); ctx.arc(192,672,70,0,Math.PI*2); ctx.stroke()
  if (valid && probability > 0) { ctx.strokeStyle = '#66e5c1'; ctx.beginPath(); ctx.arc(192,672,70,-Math.PI/2,-Math.PI/2+Math.PI*2*probability/100); ctx.stroke() }
  y = 678
  wrap(valid ? `${formatPct1(probability)}%` : c.estimateUnavailable,'bold 62px sans-serif','#66e5c1',70,1,300,680)
  y = 727
  wrap(valid ? `${c.estimate} · ${data.playoff!.leagueName}` : c.reviewStandingsRules,'26px sans-serif','#d8e2f1',32,1,300,680)
  const scenario = weeklyCardScenarios(data,path)
  panel(815,150)
  y = 852
  wrap(scenario ? `${c.oddsByResult} ${scenario.period}` : c.prepareNextDecision,'bold 24px sans-serif','#aabbd3',30,1,92,880)
  if (scenario) {
    y = 908; wrap(`${c.ifIWin}: ${formatPct1(scenario.ifWin)}%`,'bold 34px sans-serif','#66e5c1',42,1,92,420)
    y = 908; wrap(`${c.ifILose}: ${formatPct1(scenario.ifLose)}%`,'bold 34px sans-serif','#f6bf87',42,1,552,420)
    for (const [x,value,color] of [[92,scenario.ifWin,'#66e5c1'],[552,scenario.ifLose,'#f6bf87']] as const) { ctx.fillStyle='#30475c';ctx.fillRect(x,930,420,12);ctx.fillStyle=color;ctx.fillRect(x,930,420*value/100,12) }
  } else {
    y = 900; wrap(c.compareOptions,'30px sans-serif','#d8e2f1',38,2,92,880)
  }
  panel(990,185); y = 1030
  wrap(c.myNextPriority,'bold 26px sans-serif','#aabbd3',34,1,92,880)
  y = 1080
  wrap(data.actions[0] ? weeklyActionText(data.actions[0],es) : c.reviewMyTeam,'34px sans-serif','#ffffff',42,2,92,880)
  y = 1152
  if (data.actions[0]) wrap(data.actions[0].leagueName,'24px sans-serif','#aabbd3',30,1,92,880)
  const story = rivalryNarrative(data,es,true)
  y = 1210
  wrap(story || c.cardTagline,'26px sans-serif','#d8e2f1',32,2)
  ctx.font = '24px sans-serif'; ctx.fillStyle = '#aabbd3'
  ctx.fillText(c.cardDisclaimer,64,1280)
  ctx.fillText('allfantasy.ai · #AllFantasy',64,1322)
}
