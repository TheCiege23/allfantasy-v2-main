import type { MyTeamPulse } from './myTeamPulse'
import type { WeekBoard, WeekMatchup } from './weekBoard'
import type { SeasonOutlook, SwingMatchup } from './seasonOutlook'
import { lineupProjectionFor } from './weekLineups'
import type { WeekLineups } from './weekLineups'
import { formatPct1 } from './weeklyPercent'
import type { WeeklyCalendar } from './weeklyCalendar'
import { isAtRisk,isRuledOut } from './injuryStatus'

export type WeeklyAction = { id: string; leagueId: string; leagueName: string; kind: 'lineup' | 'monitor' | 'sync' | 'playoff' | 'review' | 'deadline'; count: number; href: string; gameAt: string | null; source: 'stored-lineup' | 'season-outlook' | 'league-context' | 'weekly-calendar'; season?: number | null; period?: number | null; sport?: string; deadlineKind?: 'lineup' | 'waivers' | 'trade'; playoffScenarios?: {ifWin:number;ifLose:number}; evidence?: { empty: number; out: number; bye: number | null; questionable: number; players?: string[] } }
export type WeeklyBlueprint = {
  name: string | null; teamName: string | null; leagueCount: number; sports: string[]; focusLeagueId: string | null
  actions: WeeklyAction[]; actionCount: number; attentionLeagueIds: string[]; lineupReadFailed: boolean
  coverage: Array<{ leagueId: string; leagueName: string; af: boolean; provider: boolean; partial: boolean }>
  matchup?: { opponent: string; period: number; leagueName: string; leagueId?: string; season?: number }
  playoff?: { probability: number; leagueName: string; leagueId?: string; season?: number; period?: number }
  rivalry?: { opponent: string; wins: number; losses: number; ties: number; winningStreak: number; losingStreak: number; final: boolean }
  sportPlans?: Array<{ leagueId: string; leagueName: string; sport: string }>
  calendar?: WeeklyCalendar
  commissionerLeagueIds?: string[]
}
/**
 * The game a forward-looking plan is about.
 *
 * The NFL board advances a finished marker when the next schedule is stored. For any remaining
 * finished board card, keep the same-league model's later game as a forward-looking fallback.
 * Its odds still require independent matching period provenance below.
 */
export function upcomingGame(card: WeekMatchup | undefined, outlook: SeasonOutlook | null): SwingMatchup | null {
  if (!card?.live?.final) return null
  const swing = outlook?.swingByLeague?.[card.leagueId]
  const season = outlook?.leagues.find(l => l.leagueId === card.leagueId)?.season
  return swing?.opponentName && season === card.season && swing.week > card.week ? swing : null
}

export function buildWeeklyBlueprint(input: {
  name?: string | null; leagues: Array<{ id: string; name?: string | null; sport?: string | null }>
  board: WeekBoard; pulse: MyTeamPulse | null; outlook: SeasonOutlook | null; lineups?: WeekLineups | null
  calendar?: WeeklyCalendar
  favoriteIds?: ReadonlySet<string>; focusLeagueId?: string | null; now: Date
  commissionerLeagueIds?: string[]
}): WeeklyBlueprint {
  const focus = input.focusLeagueId ?? null
  const leagues = input.leagues.filter(l => !focus || l.id === focus)
  const allowed = new Set(leagues.map(l => l.id))
  const rows = (input.pulse?.inventory ?? [...input.pulse?.needs ?? [], ...input.pulse?.set ?? []]).filter(r => allowed.has(r.leagueId))
  const cards = [...input.board.coinFlips, ...input.board.leaning, ...input.board.unprojected].filter(m => allowed.has(m.leagueId))
  const actions: WeeklyAction[] = []
  const now = input.now.getTime()
  for (const row of rows) {
    if (row.bestBall || row.automatic || row.archived) continue
    const game = row.lockAt ? Date.parse(row.lockAt) : NaN
    const card = cards.find(m => m.leagueId === row.leagueId)
    // My Team already reading the week after a FINISHED board week is the Tuesday gap above, not stale data.
    const nextWeek = card?.live?.final === true && row.season === card.season && row.week === card.week + 1
    const periodMismatch = card && !nextWeek && (row.season !== card.season || row.week !== card.week)
    const unreadable = row.syncFailed || row.unresolved > 0 || periodMismatch
    const count = row.actionableSeverity ?? (row.locked ? 0 : row.severity)
    const kind = unreadable ? 'sync' : !row.locked && count > 0 ? 'lineup' : !row.locked && row.questionable > 0 ? 'monitor' : null
    if (!kind) continue
    actions.push({ id: `${row.leagueId}:${kind}`, leagueId: row.leagueId, leagueName: row.leagueName, kind,
      count: kind === 'lineup' ? count : kind === 'monitor' ? row.questionable : row.unresolved,
      href: `/core/${kind === 'sync' ? 'league-sync' : 'my-team'}?league=${encodeURIComponent(row.leagueId)}`,
      gameAt: !unreadable && game > now ? new Date(game).toISOString() : null, source: 'stored-lineup', season: row.season, period: row.week, evidence: unreadable || ![row.empty,row.out,row.questionable].every(Number.isFinite) ? undefined : {empty:row.empty,out:row.out,bye:row.bye,questionable:row.questionable,players:row.players?.filter(p=>p.starter && (p.onBye || isRuledOut(p.status) || isAtRisk(p.status)) && (!p.kickoff || Date.parse(p.kickoff)>now)).slice(0,3).map(p=>p.name)} })
    // A lineup repair and an injury watch are distinct decisions in a focused league.
    if (kind === 'lineup' && row.questionable > 0) actions.push({...actions[actions.length-1],id:`${row.leagueId}:monitor`,kind:'monitor',count:row.questionable})
  }
  for (const event of input.calendar?.events ?? []) {
    const at=Date.parse(event.at)
    if (!allowed.has(event.leagueId) || !['lineup','waivers','trade'].includes(event.kind) || !Number.isFinite(at) || at<=now || at>now+7*86400000) continue
    const kind=event.kind as 'lineup' | 'waivers' | 'trade'
    const id=`${event.leagueId}:deadline:${kind}`
    if(actions.some(a=>a.id===id))continue
    actions.push({id,leagueId:event.leagueId,leagueName:event.leagueName,kind:'deadline',deadlineKind:kind,count:0,href:event.href,gameAt:event.at,source:'weekly-calendar'})
  }
  const priority = { lineup: 0, monitor: 1, sync: 2, deadline: 3, playoff: 4, review: 5 }
  actions.sort((a, b) => priority[a.kind] - priority[b.kind] || (a.gameAt ? Date.parse(a.gameAt) : Infinity) - (b.gameAt ? Date.parse(b.gameAt) : Infinity) || b.count - a.count || a.leagueName.localeCompare(b.leagueName))
  const swings = Object.values(input.outlook?.swingByLeague ?? {}).filter(s => {
    const model = input.outlook?.leagues.find(l=>l.leagueId === s.leagueId)
    const card = cards.find(m=>m.leagueId === s.leagueId)
    const next = upcomingGame(card,input.outlook)
    return allowed.has(s.leagueId) && model?.you?.modelled && model.period != null && s.week >= model.period &&
      [s.ifWin,s.ifLose].every(p=>Number.isFinite(p) && p >= 0 && p <= 100) &&
      (!card || (model.season === card.season && model.period === (next?.week ?? card.week)))
  }).sort((a,b) => b.swing - a.swing)
  for (const swing of swings) if (!actions.some(a => a.leagueId === swing.leagueId && (a.kind === 'sync' || a.kind === 'playoff'))) actions.push({ id: `${swing.leagueId}:playoff`, leagueId: swing.leagueId, leagueName: swing.leagueName, kind: 'playoff', count: swing.week,
    href: `/core/season-outlook?league=${encodeURIComponent(swing.leagueId)}`, gameAt: null, source: 'season-outlook', playoffScenarios:{ifWin:swing.ifWin,ifLose:swing.ifLose}, period: swing.week, season: input.outlook?.leagues.find(l=>l.leagueId === swing.leagueId)?.season })
  if (!actions.length && leagues.length) {
    const l = leagues.find(l => input.favoriteIds?.has(l.id)) ?? leagues[0]
    actions.push({ id: `${l.id}:review`, leagueId: l.id, leagueName: l.name?.trim() || 'League', kind: 'review', count: 0,
      href: `/core/my-team?league=${encodeURIComponent(l.id)}`, gameAt: null, source: 'league-context' })
  }
  const attentionLeagueIds = [...new Set([...actions.map(a => a.leagueId), ...leagues.filter(l => input.favoriteIds?.has(l.id)).map(l => l.id), ...swings.map(s => s.leagueId)])]
  const coverage = cards.map(m => {
    const p = lineupProjectionFor(input.lineups, m.leagueId, m.season, m.week)
    return { leagueId: m.leagueId, leagueName: m.leagueName, af: p?.af?.you != null, provider: p?.api?.you != null, partial: p?.partial ?? false }
  })
  const featured = cards.find(m => m.leagueId === attentionLeagueIds[0]) ?? cards[0]
  const upcoming = upcomingGame(featured, input.outlook)
  // The matchup and odds describe one league, season and period, including in portfolio view.
  // With no matching model, omit odds rather than borrow another league's probability.
  const outlook = input.outlook?.leagues.find(l => allowed.has(l.leagueId) && l.leagueId === (featured?.leagueId ?? focus) && l.you?.modelled && (!featured || (l.season === featured.season && l.period === (upcoming?.week ?? featured.week))))
  const candidates = (input.board.rivalryPlans ?? []).filter(r=>featured != null && r.leagueId===featured.leagueId && r.season===featured.season && r.period===(upcoming?.week ?? featured.week) && (upcoming ? r.opponent===upcoming.opponentName : r.opponentRosterId===featured.opponent.rosterId))
  const rivalry = candidates.length===1 ? candidates[0] : null
  const probability = outlook?.you?.playoffPct
  return { name: input.name?.trim() || null, teamName: input.board.leagueBoard?.yourTeamName ?? null, leagueCount: leagues.length,
    sports: [...new Set(leagues.map(l => l.sport?.trim()).filter((s): s is string => Boolean(s)))], focusLeagueId: focus,
    actions: actions.slice(0, 3).map(a=>({...a,sport:leagues.find(l=>l.id===a.leagueId)?.sport?.trim().toUpperCase()})), actionCount: actions.length, attentionLeagueIds, lineupReadFailed: input.pulse == null || (leagues.length > 0 && rows.length === 0), coverage,
    sportPlans: leagues.map(l=>({leagueId:l.id,leagueName:l.name?.trim() || 'League',sport:l.sport?.trim().toUpperCase() || 'UNKNOWN'})),
    calendar: input.calendar,
    commissionerLeagueIds: input.commissionerLeagueIds?.filter(id => allowed.has(id)) ?? [],
    // Prior meetings must belong to the exact displayed opponent and period.
    ...(rivalry ? {rivalry:{...rivalry,final:!upcoming && featured?.live?.final===true}} : focus && !upcoming && input.board.leagueBoard?.rivalry && input.board.leagueBoard.yours?.opponent.name ? { rivalry: {
      opponent: input.board.leagueBoard.yours.opponent.name, ...input.board.leagueBoard.rivalry,
      winningStreak: input.board.leagueBoard.rivalry.winningStreak ?? 0,
      losingStreak: input.board.leagueBoard.rivalry.losingStreak ?? 0, final: input.board.leagueBoard.yours.live?.final ?? false,
    } } : {}),
    ...(upcoming ? { matchup: { opponent: upcoming.opponentName!, period: upcoming.week, leagueName: featured!.leagueName, leagueId: featured!.leagueId, season: featured!.season } }
      : featured?.opponent.name ? { matchup: { opponent: featured.opponent.name, period: featured.week, leagueName: featured.leagueName, leagueId: featured.leagueId, season: featured.season } } : {}),
    ...(outlook && probability != null && Number.isFinite(probability) && probability >= 0 && probability <= 100 ? { playoff: { probability, leagueName: outlook.leagueName, leagueId: outlook.leagueId, season: outlook.season, period: outlook.period } } : {}) }
}
export function weeklyActionText(action: WeeklyAction, es = false): string {
  if(action.kind==='deadline')return es ? ({lineup:'Revisa el cierre de alineación',waivers:'Prepara tus reclamos antes del plazo',trade:'Revisa la fecha límite de intercambios'})[action.deadlineKind ?? 'lineup'] : ({lineup:'Review the confirmed lineup deadline',waivers:'Prepare claims before waiver processing',trade:'Review the confirmed trade deadline'})[action.deadlineKind ?? 'lineup']
  if (es) return ({ lineup: `Revisa ${action.count} problema${action.count === 1 ? '' : 's'} en tu alineación`, monitor: `Vigila ${action.count} titular${action.count === 1 ? '' : 'es'} con dudas`, sync: 'Actualiza los datos de tu equipo', playoff: `Explora los escenarios del período ${action.count}`, review: 'Revisa tu equipo y sus reglas' })[action.kind]
  return ({ lineup: `Review ${action.count} lineup issue${action.count === 1 ? '' : 's'}`, monitor: `Monitor ${action.count} questionable starter${action.count === 1 ? '' : 's'}`, sync: 'Refresh your team data', playoff: `Explore period ${action.count} playoff scenarios`, review: 'Review your team and its rules' })[action.kind]
}
export function weeklyActionReason(action: WeeklyAction, es = false): string {
  if(action.kind==='lineup' && action.sport && !['NFL','NCAAF'].includes(action.sport)) return es ? 'Los huecos y las ausencias pueden afectar tu resultado; compara opciones elegibles según el formato.' : 'Empty slots and unavailable starters can affect your result; compare eligible options under your scoring format.'
  if(action.kind==='deadline')return es ? 'Hay una fecha confirmada guardada para esta liga. Comprueba las reglas y completa tu decisión antes del plazo.' : 'A confirmed date is stored for this league. Check the rules and complete your decision before the deadline.'
  return es ? ({lineup:'Los huecos, las ausencias o los descansos pueden costarte puntos. Revisa las opciones elegibles.',monitor:'Una designación de duda puede cambiar. Comprueba las noticias antes de decidir.',sync:'Los datos están incompletos o no coinciden con el período. Actualízalos antes de elegir jugadores.',playoff:'Compara los escenarios de victoria y derrota y revisa las reglas del modelo.',review:'Revisa los titulares y las reglas de esta liga para preparar tu próxima decisión.'})[action.kind]
    : ({lineup:'Empty slots, absences or byes can cost points. Review eligible options.',monitor:'A questionable designation can change. Check the latest status before deciding.',sync:'Team data is incomplete or differs from the matchup period. Refresh it before choosing players.',playoff:'Compare the win and loss scenarios and review the model’s rules.',review:'Review this league’s starters and rules to prepare your next decision.'})[action.kind]
}
/** An unsent, scoped question; no lineup changes or claims are executed. */
export function weeklyActionPrompt(action: WeeklyAction, es = false): string {
  const period = action.period ? `${es ? 'Período' : 'Period'} ${action.period}${action.season ? ` · ${action.season}` : ''}. ` : ''
  const timing = action.gameAt ? `${action.kind === 'deadline' ? es ? 'Plazo confirmado' : 'Confirmed deadline' : es ? 'Próximo partido registrado' : 'Next stored game time'}: ${action.gameAt}. ` : ''
  return `${action.leagueName}. ${period}${weeklyActionText(action,es)}. ${weeklyActionReason(action,es)} ${timing}${es ? 'Ayúdame a comparar mis opciones. Verifica los datos, las reglas y el plazo oficial de esta liga; no inventes jugadores, horarios ni movimientos.' : 'Help me compare my options. Verify this league’s data, rules and official deadline; do not invent players, timing or transactions.'}`
}
export function weeklyBrief(data: WeeklyBlueprint, es = false): string {
  const scope = data.teamName ?? (es ? `${data.leagueCount} liga${data.leagueCount === 1 ? '' : 's'}` : `${data.leagueCount} league${data.leagueCount === 1 ? '' : 's'}`)
  const sports = data.sports.length ? ` (${data.sports.join(', ')})` : ''
  const next = data.actions[0]
  const matchup = data.matchup ? es ? `Período ${data.matchup.period}: frente a ${data.matchup.opponent} en ${data.matchup.leagueName}. ` : `Period ${data.matchup.period}: facing ${data.matchup.opponent} in ${data.matchup.leagueName}. ` : ''
  const playoff = data.playoff ? es ? `Probabilidad estimada de playoffs en ${data.playoff.leagueName}: ${formatPct1(data.playoff.probability)}%. ` : `Estimated playoff probability in ${data.playoff.leagueName}: ${formatPct1(data.playoff.probability)}%. ` : ''
  return es ? `Tu plan para ${scope}${sports}. ${matchup}${playoff}${next ? `Primero: ${weeklyActionText(next, true)} en ${next.leagueName}. ` : ''}Chimmy puede ayudarte a evaluar tus opciones con el contexto de tus ligas.`
    : `Your plan for ${scope}${sports}. ${matchup}${playoff}${next ? `First: ${weeklyActionText(next)} in ${next.leagueName}. ` : ''}Chimmy can help you weigh your options with your league context.`
}
/** Unitless closeness; raw scoring scales never order a multi-sport portfolio. */
export function matchupCloseness(m: { live?: { margin: number; you: number; them: number } | null; projection?: { winProbability: number } | null }): number {
  if (m.live) {
    const total = Math.abs(m.live.you) + Math.abs(m.live.them)
    return total > 0 ? Math.abs(m.live.margin) / total : 0
  }
  return m.projection ? Math.abs(m.projection.winProbability - 0.5) : 1
}
