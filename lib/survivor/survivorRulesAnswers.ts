/**
 * Chimmy's answers to "how does X work" in a Survivor league, built from THIS league's settings and
 * season plan rather than fixed copy. Pure: the caller loads the settings and plan. Nothing here
 * reads or reveals hidden state (who holds an idol, how anyone voted, token balances).
 */

import type { SurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import type { SurvivorFoundationSettings } from './survivorSettings'
import { weeklyPrizesActive, type SurvivorWeeklyPrizeSettings } from './survivorWeeklyPrizes'
import { SURVIVOR_FINALE_DEFAULTS, type SurvivorFinaleSettings, type SurvivorFinaleWindows } from './survivorFinaleSettings'
import { SURVIVOR_GOVERNANCE_DEFAULTS, type SurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { dayTimeLabel, governanceLang } from './survivorGovernanceCopy'
import { crossTribeWindowsLabel } from './survivorGovernanceCopy'
import type { SurvivorSideGameSettings } from './survivorSideGameSettings'
import { answerSideGameRules, sideGameExileLines } from './survivorSideGameRulesAnswers'
import { finalJuryStepRulesLine } from './survivorFinalJuryStep'

export type SurvivorRulesTopic =
  | 'voting' | 'ties' | 'idols' | 'merge' | 'exile' | 'jury' | 'immunity' | 'challenges' | 'schedule' | 'overview'
  | 'prizes' | 'house_rules'
  | 'trades' | 'strikes' | 'alliances' | 'swaps'
  | 'token_pool' | 'survivor_pool' | 'auction' | 'token_shop'

export type SurvivorRulesContext = {
  sport: string
  settings: SurvivorFoundationSettings
  plan: SurvivorFullSeasonPlan | null
  /** Active managers right now, when known. */
  activeCount?: number | null
  /** The commissioner's weekly tribe prizes (survivorWeeklyPrizes.ts). Absent = none. */
  prizes?: SurvivorWeeklyPrizeSettings | null
  /** The commissioner's free-text house rules. Quoted as written, never paraphrased. */
  houseRules?: string | null
  /** Trade rules, strikes, alliances and extra swaps (survivorGovernanceSettings.ts). Absent: defaults, and the rulebook leaves those sections out. */
  governance?: SurvivorGovernanceSettings | null
  /** Exile Island and the side games (survivorSideGameSettings.ts). Absent: defaults, and the rulebook leaves them out. */
  sideGames?: SurvivorSideGameSettings | null
  /** League.language: the prize, house-rules and governance answers follow it (English / Spanish). */
  language?: string | null
  /** Jury, finale and reunion rules (survivorFinaleSettings.ts). Defaults when absent. */
  finale?: SurvivorFinaleSettings
  /** This season's finale windows, when set. */
  finaleWindows?: SurvivorFinaleWindows | null
  /** Challenge settings: the weekly FAAB cap per winner and the real-game challenge setup. */
  challenges?: { faabWeeklyCap: number; realGame: { enabled: boolean; perWeek: number; prizeText: string } } | null
  /** Reward house rules: "thieves cannot steal from each other" (off by default). */
  rewardRules?: { thievesCannotStealFromEachOther: boolean } | null
}

function windowWhen(iso: string | null | undefined, locale = 'en-US'): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString(locale, { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

/** The jury and finale answer in Spanish (League.language), the same facts as the English one. */
function juryAnswerEs(ctx: SurvivorRulesContext): string {
  const s = ctx.settings
  const f = ctx.finale ?? SURVIVOR_FINALE_DEFAULTS
  const w = ctx.finaleWindows ?? null
  const when = (iso: string | null | undefined) => windowWhen(iso, 'es-ES')
  const qClose = when(w?.questionsDeadline)
  const qOpen = when(w?.questionsOpenAt)
  const aClose = when(w?.answersDeadline)
  const sClose = when(w?.speechesDeadline)
  return [
    '**Jurado y final**',
    s.juryEnabled ? '• Quienes salen eliminados después de la fusión se unen al jurado.' : '• Esta liga no tiene jurado.',
    s.juryEnabled ? finalJuryStepRulesLine(f, 'es') ?? '' : '',
    ctx.plan ? `• El Consejo Tribal Final es en la semana ${ctx.plan.finaleWeek} con ${ctx.plan.finalistCount} finalistas.` : '• Los últimos que quedan en pie van al Consejo Tribal Final.',
    s.juryEnabled && f.juryQuestionsEnabled ? `• Cada miembro del jurado puede hacer una pregunta a cada finalista${qOpen || qClose ? ` (${qOpen ? `desde ${qOpen}` : ''}${qOpen && qClose ? ' ' : ''}${qClose ? `hasta ${qClose}` : ''})` : ' mientras la final está abierta'}. Los finalistas responden${aClose ? ` antes de ${aClose}` : ''} y el jurado marca la respuesta como vista.` : '',
    f.closingSpeechesEnabled ? `• Cada finalista publica un discurso final, editable${sClose ? ` hasta ${sClose}` : ' hasta que termine la votación del jurado'}.${sClose ? ' La votación del jurado abre cuando cierran los discursos.' : ''} El jurado los ve primero; todos los ven después de la final.` : '',
    s.juryEnabled && s.finaleVotingEnabled ? '• El jurado vota en secreto por el ganador.' : '',
    f.endOfSeasonBallotReveal ? '• Al terminar la temporada se revelan los votos de cada Consejo: quién votó por quién. Nunca antes de coronar al campeón.' : '• Los votos siguen siendo secretos, incluso después de la temporada.',
    f.reunionChatEnabled ? '• Después de la final, el chat de la isla se reabre para todos en la reunión.' : '',
  ].filter(Boolean).join('\n')
}

function votesDueLine(ctx: SurvivorRulesContext): string {
  const hours = (ctx.finale ?? SURVIVOR_FINALE_DEFAULTS).votesDueHoursBeforeCeremony
  return hours > 0
    ? `Ballots are due ${hours} hour${hours === 1 ? '' : 's'} before the Torch Ceremony (${DAY_TIME(ctx.settings)}).`
    : `Votes close at the Torch Ceremony, ${DAY_TIME(ctx.settings)}.`
}

// Survivor words only: a league chat full of fantasy questions ("when does he play?", "who won the
// game?") must not be pulled away from general Chimmy.
const TOPIC_PATTERNS: Array<[SurvivorRulesTopic, RegExp]> = [
  // Governance first: "can I trade a player who played before tribal?" is a trade question, not a vote one.
  ['trades', /\b(trade (?:rules?|window|freeze|lock)|cross[- ]tribe|trades? (?:between|across|with(?: an?)? other) tribes?|trade (?:with|outside) (?:my|another|the other) tribe|tribe trades?|reglas? de cambios?|cambios? entre tribus)\b/],
  ['strikes', /\b(conduct|strike (?:policy|rule|limit)s?|conduct strikes?|my strikes?|how many strikes|faltas?|conducta)\b/],
  ['alliances', /\b(alliances?|side chats?|alianzas?)\b/],
  ['swaps', /\b(swaps?|swapping|tribe shuffle|redraw|original tribes|new tribes|cambio de tribus)\b/],
  // Side games before Exile and voting: "how does the token pool work on exile" is a Token Pool question.
  ['token_pool', /\b(token pool|pozo de fichas|cash out|cobrar (?:la )?racha|streak pot)\b/],
  ['survivor_pool', /\b(survivor pool|pozo survivor|revives?|resurrecci(?:o|ó)n(?:es)?)\b/],
  ['auction', /\b(auctions?|auction week|auction cash|subastas?|pujas?|bids?|bidding)\b/],
  ['token_shop', /\b(token shop|tienda de fichas|spend (?:my )?tokens|buy (?:an? )?advantages?|comprar ventajas?)\b/],
  ['house_rules', /\b(house rules?|screenshots?|reglas de la casa)\b/],
  // "Steal" alone stays with idols (a vote-steal idol); only the reward words are prizes.
  ['prizes', /\b(prizes?|premios?|tie[- ]?break(?:ers?)?|free trades?|steal blockers?|blockers?)\b/],
  ['ties', /\b(tie|tied|ties|rocks|deadlock(?:ed)?)\b/],
  ['idols', /\b(idols?|shot in the dark)\b/],
  ['exile', /\b(exile|return(?:ing)? to the island)\b/],
  ['jury', /\b(jury|jurors?|finale|final tribal|finalists?|closing speech(?:es)?|reunion|who voted for whom)\b/],
  ['merge', /\b(merge|merged|merging)\b/],
  ['immunity', /\b(immunity|immune)\b/],
  ['challenges', /\b(challenges?|mini[- ]?games?)\b/],
  ['voting', /\b(vote|votes|voting|ballot|tribal council|tribal|council|voted out)\b/],
  ['schedule', /\b(torch ceremony|elimination weeks?|vote deadline|voting deadline|votes due)\b/],
]

const QUESTION = /\b(how|what|when|why|rules?|explain|does|do|can|is|are|which|who)\b|\?/

/**
 * Spanish topic words. A topic matches when its English OR its Spanish pattern does, and topics keep
 * the English list's priority, so "¿cómo funciona el consejo tribal final?" is a jury question (jury
 * comes before voting) and a side-game question that mentions votes stays a side-game question.
 * Unicode-aware word edges (JS \b treats "ó" as a non-word character). Only Spanish-specific forms:
 * "la final" / "finalistas", never a bare "final", so an English "what was the final score?" is not
 * read as a finale question. Its own list, so the English patterns above stay untouched.
 */
const esWords = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'u')
const TOPIC_PATTERNS_ES: ReadonlyMap<SurvivorRulesTopic, RegExp> = new Map<SurvivorRulesTopic, RegExp>([
  ['ties', esWords('empates?|empatad[oa]s?|piedras')],
  ['idols', esWords('[íi]dolos?|disparo en la oscuridad')],
  ['exile', esWords('exilio|isla del exilio|volver a la isla')],
  ['jury', esWords('jurado|miembros? del jurado|la final|de la final|en la final|finalistas?|consejo tribal final|discursos? final(?:es)?|discurso de cierre|reuni[óo]n|qui[ée]n vot[óo] por qui[ée]n')],
  ['merge', esWords('fusi[óo]n|fusionad[oa]s?')],
  ['immunity', esWords('inmunidad|inmunes?')],
  ['challenges', esWords('retos?|desaf[íi]os?|minijuegos?')],
  ['schedule', esWords('hora l[íi]mite|ceremonia de la antorcha|semanas? de eliminaci[óo]n|cu[áa]ndo (?:se )?vota')],
  ['voting', esWords('votos?|votar|votaci[óo]n(?:es)?|vot[ée]|consejo tribal|eliminad[oa]s?|papeletas?')],
])

const QUESTION_ES = new RegExp(`¿|(?<![\\p{L}])(?:c[óo]mo|qu[ée]|cu[áa]ndo|por qu[ée]|reglas?|expl[íi]ca(?:me)?|cu[áa]nt[oa]s?|qui[ée]n(?:es)?|d[óo]nde|puedo|se puede|funciona)(?![\\p{L}])`, 'u')

/**
 * The rules topic a message asks about, or null when it is not a rules question. "How does Survivor
 * work" with no specific topic is the overview.
 */
export function survivorRulesTopic(message: string): SurvivorRulesTopic | null {
  const text = message.toLowerCase().replace(/@chimmy\b/g, ' ').trim()
  if (!text || !(QUESTION.test(text) || QUESTION_ES.test(text))) return null
  for (const [topic, pattern] of TOPIC_PATTERNS) if (pattern.test(text) || TOPIC_PATTERNS_ES.get(topic)?.test(text)) return topic
  if (/\bsurvivor\b/.test(text) || /\b(rules|how (?:does|do) this league work)\b/.test(text)) return 'overview'
  return null
}

const PERSONAL_ASK = /\b(my idols?|(?:use|play) my idol|am i safe|my survivor status|my strikes?|my alliances?|cu[aá]ntas faltas)\b/

/**
 * Whether a private @Chimmy message in a Survivor league's chat belongs to the Survivor host rather
 * than the general fantasy assistant: a rules question, or a question about the sender's own game.
 */
export function isSurvivorChimmyAsk(message: string): boolean {
  const text = message.toLowerCase()
  return survivorRulesTopic(text) != null || PERSONAL_ASK.test(text)
}

const DAY_TIME = (s: SurvivorFoundationSettings) => `${s.tribalCouncilDay} at ${formatTime(s.tribalCouncilTime)} ET`

function formatTime(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!match) return '8:00 PM'
  const hour = Number(match[1])
  const suffix = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${match[2]} ${suffix}`
}

const periodWord = (sport: string) => (sport.toUpperCase() === 'NFL' ? 'week' : 'scoring week')

function mergeLine(ctx: SurvivorRulesContext): string {
  const s = ctx.settings
  return s.mergeTriggerType === 'week'
    ? `The tribes merge in week ${s.mergeWeek}.`
    : `The tribes merge when ${s.mergeActivePlayerCount} managers are left${ctx.activeCount ? ` (${ctx.activeCount} are in the game now)` : ''}.`
}

function tieLine(s: SurvivorFoundationSettings): string {
  switch (s.tieRule) {
    case 'rocks_immediately': return 'A tie goes straight to rocks: a random draw among the tied managers decides who goes home.'
    case 'revote_then_season_points': return 'A tie means a revote among the tied managers. If it is still tied, the manager with the fewest season points goes home.'
    case 'season_points_only': return 'A tie is settled by season points: the tied manager with the fewest season points goes home.'
    default: return 'A tie means a revote among the tied managers. If it is still tied, it goes to rocks: a random draw decides who goes home.'
  }
}

function idolExpiryLine(s: SurvivorFoundationSettings): string {
  if (s.idolExpiryMode === 'merge') return 'Idols expire at the merge.'
  if (s.idolExpiryMode === 'week') return `Idols expire after week ${s.idolExpiryWeek}.`
  return `Idols expire when ${s.idolExpiryRemainingPlayers} managers are left.`
}

function scheduleLine(ctx: SurvivorRulesContext): string {
  const plan = ctx.plan
  if (!plan) return votesDueLine(ctx)
  const doubles = [...new Set(plan.eliminationWeeks.filter((week, index, all) => all.indexOf(week) !== index))]
  return [
    votesDueLine(ctx),
    `The season runs weeks ${plan.startWeek}–${plan.endWeek}, with the finale in week ${plan.finaleWeek}.`,
    plan.noEliminationWeeks.length ? `Nobody goes home in week${plan.noEliminationWeeks.length > 1 ? 's' : ''} ${plan.noEliminationWeeks.join(', ')}.` : '',
    doubles.length ? `Week${doubles.length > 1 ? 's' : ''} ${doubles.join(', ')} send${doubles.length > 1 ? '' : 's'} two managers home.` : '',
  ].filter(Boolean).join(' ')
}

const isEs = (ctx: SurvivorRulesContext) => String(ctx.language ?? '').toLowerCase().startsWith('es')

function prizesAnswer(ctx: SurvivorRulesContext): string {
  const p = ctx.prizes
  const es = isEs(ctx)
  const lines: string[] = [es ? '**Premios semanales**' : '**Weekly prizes**']
  if (!p || (!weeklyPrizesActive(p) && p.tribeTieBreakPosition === 'none')) {
    lines.push(es ? '• Esta liga no tiene premios semanales de tribu. Los retos pueden dar sus propias recompensas.' : '• This league has no weekly tribe prizes. Challenges can still pay their own rewards.')
  } else {
    if (p.winningTribeFaabPerPlayer > 0) lines.push(es ? `• Antes de la fusión, la tribu con más puntos cada semana gana $${p.winningTribeFaabPerPlayer} de FAAB por jugador.` : `• Before the merge, the top-scoring tribe each week wins $${p.winningTribeFaabPerPlayer} FAAB per player.`)
    if (p.topScorerReward === 'faab') lines.push(es ? `• El máximo anotador de esa tribu gana además $${p.topScorerAmount} de FAAB.` : `• That tribe's top scorer also wins $${p.topScorerAmount} FAAB.`)
    if (p.topScorerReward === 'score_boost') lines.push(es ? `• El máximo anotador de esa tribu gana +${p.topScorerAmount} puntos en la semana siguiente.` : `• That tribe's top scorer wins +${p.topScorerAmount} points on the next week's score.`)
    if (p.topScorerReward === 'advantage') lines.push(es ? `• El máximo anotador de esa tribu gana una ventaja (${p.topScorerPowerType.replace(/_/g, ' ')}).` : `• That tribe's top scorer wins an advantage (${p.topScorerPowerType.replace(/_/g, ' ')}).`)
    if (p.tribeTieBreakPosition !== 'none') lines.push(es ? `• Si dos tribus empatan en puntos, gana la tribu con el ${p.tribeTieBreakPosition} titular que más puntuó.` : `• If two tribes tie on points, the tribe whose starting ${p.tribeTieBreakPosition} scored more wins the tie.`)
    if (p.payInTribeWeeksAfterMerge && weeklyPrizesActive(p)) lines.push(es ? '• Después de la fusión, estos premios también se pagan en cualquier semana en que compitan tribus (por ejemplo, una semana sorpresa de dos tribus).' : '• After the merge, these prizes are also paid in any week where tribes compete (for example a surprise two-tribe week).')
  }
  if (ctx.rewardRules?.thievesCannotStealFromEachOther) lines.push(es ? '• Los ladrones no se roban entre sí: quien tiene o ya usó un robo esa semana no puede ser objetivo de otro robo.' : '• Thieves cannot steal from each other: a manager who holds or has used a steal that week cannot be the target of another steal.')
  lines.push(es
    ? '• Las recompensas de los retos pueden incluir puntos (a favor o en contra), FAAB tomado de otra tribu, puntos para un compañero, un premio para la semana siguiente, un intercambio libre o un robo que un bloqueador cancela. Pregúntame "¿qué gané?" para ver los tuyos.'
    : '• Challenge rewards can include points (up or down), FAAB taken from another tribe, points you place on a tribemate, a prize that pays next week, a free trade, or a steal that a blocker cancels. Ask me "what did I win?" to see yours.')
  return lines.join('\n')
}

function houseRulesAnswer(ctx: SurvivorRulesContext): string {
  const es = isEs(ctx)
  const text = (ctx.houseRules ?? '').trim()
  if (!text) return es ? '**Reglas de la casa**\n• El comisionado no ha escrito reglas de la casa.' : '**House rules**\n• The commissioner has not written any house rules.'
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => `• ${line.replace(/^[-•*]\s*/, '')}`)
  return [es ? '**Reglas de la casa (del comisionado)**' : "**House rules (from the commissioner)**", ...lines].join('\n')
}

function governanceAnswer(topic: 'trades' | 'strikes' | 'alliances' | 'swaps', ctx: SurvivorRulesContext): string {
  const g = ctx.governance ?? SURVIVOR_GOVERNANCE_DEFAULTS
  const es = governanceLang(ctx.language) === 'es'
  const tribal = dayTimeLabel(ctx.language, ctx.settings.tribalCouncilDay, ctx.settings.tribalCouncilTime)
  const close = dayTimeLabel(ctx.language, g.crossTribeCloseDay, g.crossTribeCloseTime)
  const freeze = dayTimeLabel(ctx.language, g.weeklyTradeFreezeDay, g.weeklyTradeFreezeTime)
  // Several weekly windows (or one opened at a set time): name every one of them.
  const crossWindows = g.crossTribeWindows ?? []
  const multiWindow = crossWindows.length > 1 || crossWindows[0]?.opensOn === 'time'
  const windowsText = multiWindow ? crossTribeWindowsLabel(ctx.language, crossWindows) : ''
  const lines = (title: string, items: Array<string | false>) => [`**${title}**`, ...items.filter((x): x is string => Boolean(x)).map((x) => `• ${x}`)].join('\n')
  if (topic === 'trades') {
    if (!g.tradeRulesEnabled) {
      return es
        ? lines('Cambios', ['Esta liga usa las reglas normales de cambios: no hay reglas especiales de Survivor.'])
        : lines('Trades', ['This league uses its normal trade rules: there are no extra Survivor trade rules.'])
    }
    return es
      ? lines('Cambios', [
        g.crossTribeTrades === 'banned' ? 'Antes de la fusión no se permiten cambios entre tribus.'
          : g.crossTribeTrades === 'window' && multiWindow ? `Los cambios entre tribus abren cada semana ${windowsText}; fuera de esas ventanas están cerrados.`
          : g.crossTribeTrades === 'window' ? `Los cambios entre tribus abren después del Consejo Tribal (${tribal} ET) y cierran ${close} ET cada semana.`
            : 'Los cambios entre tribus se permiten en cualquier momento.',
        g.withinTribeUnplayedOnly && 'Dentro de tu tribu puedes cambiar en cualquier momento a jugadores que todavía no han jugado esta semana.',
        g.playedLockUntilTribal && 'Un jugador que ya jugó esta semana no se puede cambiar hasta después del Consejo Tribal.',
        (g.playedLockUntilTribal || g.withinTribeUnplayedOnly) && 'En una semana sin Consejo Tribal, ese bloqueo se levanta cuando termina el último partido de la semana (o cuando avanza la semana, si no se puede leer el resultado final).',
        g.tradeCheckFailureMode === 'hold' && 'Si la revisión de reglas no puede hacerse, el cambio queda retenido hasta que el comisionado lo apruebe o lo vete.',
        g.weeklyTradeFreezeEnabled && `Los cambios se congelan ${freeze} ET y vuelven después del Consejo Tribal.`,
        'Después de la fusión todos son una tribu, así que solo aplican las reglas de jugadores que ya jugaron y la congelación.',
      ])
      : lines('Trades', [
        g.crossTribeTrades === 'banned' ? 'Trades between tribes are not allowed before the merge.'
          : g.crossTribeTrades === 'window' && multiWindow ? `Trades between tribes are open each week ${windowsText}; outside those windows they are closed.`
          : g.crossTribeTrades === 'window' ? `Trades between tribes open after Tribal Council (${tribal} ET) and close ${close} ET each week.`
            : 'Trades between tribes are allowed at any time.',
        g.withinTribeUnplayedOnly && 'Within your tribe, you can trade players who have not played yet this week at any time.',
        g.playedLockUntilTribal && 'A player who has already played this week cannot be traded until after Tribal Council.',
        (g.playedLockUntilTribal || g.withinTribeUnplayedOnly) && "In a week with no Tribal Council, that lock lifts once the week's last game is final (or when the week advances, if the final score cannot be read).",
        g.tradeCheckFailureMode === 'hold' && 'If the trade-rule check cannot run, the trade is held for the commissioner to approve or veto.',
        g.weeklyTradeFreezeEnabled && `Trades freeze ${freeze} ET and reopen after Tribal Council.`,
        'After the merge everyone is one tribe, so only the played-player rule and the freeze still apply.',
      ])
  }
  if (topic === 'strikes') {
    return es
      ? lines('Conducta', [
        'Engañar dentro del juego está permitido; el abuso o el acoso no.',
        `El comisionado puede dar una falta de conducta con un motivo. Chimmy te avisa en privado y solo tú y el comisionado ven tus faltas.`,
        g.strikeAutoRemove ? `Con ${g.strikeLimit} ${g.strikeLimit === 1 ? 'falta' : 'faltas'} quedas fuera de la temporada.` : `Con ${g.strikeLimit} ${g.strikeLimit === 1 ? 'falta' : 'faltas'} el comisionado decide si quedas fuera de la temporada.`,
        'Pregúntame "¿cuántas faltas tengo?" para ver las tuyas.',
      ])
      : lines('Conduct', [
        'Deceiving people inside the game is allowed; abuse or harassment is not.',
        'The commissioner can issue a conduct strike with a reason. Chimmy tells you privately, and only you and the commissioner see your strikes.',
        g.strikeAutoRemove ? `Reaching ${g.strikeLimit} ${g.strikeLimit === 1 ? 'strike' : 'strikes'} removes you from the season.` : `At ${g.strikeLimit} ${g.strikeLimit === 1 ? 'strike' : 'strikes'} the commissioner decides whether you are removed from the season.`,
        'Ask me "how many strikes do I have?" to see yours.',
      ])
  }
  if (topic === 'alliances') {
    if (!g.alliancesEnabled) {
      return es ? lines('Alianzas', ['Los chats de alianza están desactivados en esta liga.']) : lines('Alliances', ['Alliance chats are turned off in this league.'])
    }
    return es
      ? lines('Alianzas', [
        `Mientras sigas en el juego puedes formar un chat privado de alianza con hasta ${g.allianceMaxSize} náufragos (tú incluido).`,
        g.allianceSameTribeOnly && 'Antes de la fusión, solo con náufragos de tu tribu.',
        g.allianceHostCanRead ? 'El anfitrión puede leer las alianzas, pero no escribe en ellas.' : 'Solo los miembros leen el chat.',
        'Si te eliminan o te mandan al Exilio, ya no puedes escribir en tus alianzas.',
        'Chimmy nunca se une a una alianza.',
      ])
      : lines('Alliances', [
        `While you are still in the game you can open a private alliance chat with up to ${g.allianceMaxSize} castaways, you included.`,
        g.allianceSameTribeOnly && 'Before the merge, only with castaways in your own tribe.',
        g.allianceHostCanRead ? 'The host can read alliances but never posts in them.' : 'Only the members can read the chat.',
        'Once you are voted out or sent to Exile, you can no longer post in your alliances.',
        'Chimmy never joins an alliance.',
      ])
  }
  const swapWeeks = g.swapSchedule.map((w) => w.week)
  const extra = swapWeeks.length
    ? (es ? `Hay cambios de tribu programados después de la${swapWeeks.length > 1 ? 's semanas' : ' semana'} ${swapWeeks.join(', ')}.` : `Tribe swaps are scheduled after week${swapWeeks.length > 1 ? 's' : ''} ${swapWeeks.join(', ')}.`)
    : (es ? 'No hay cambios de tribu extra programados.' : 'No extra tribe swaps are scheduled.')
  return es
    ? lines('Cambios de tribu', [
      extra,
      'Un cambio puede repartir el elenco en más o menos tribus, devolver a todos a su tribu original, o seguir un patrón del comisionado.',
      'Las nuevas tribus quedan en secreto hasta el próximo cierre de alineaciones. Los ídolos viajan contigo y tu chat de tribu cambia solo.',
    ])
    : lines('Tribe swaps', [
      extra,
      'A swap can redraw the cast into more or fewer tribes, send everyone back to their original tribe, or follow the commissioner\'s own pattern.',
      'The new tribes stay sealed until the next lineup lock. Idols travel with you, and your tribe chat switches over on its own.',
    ])
}

export function answerSurvivorRules(topic: SurvivorRulesTopic, ctx: SurvivorRulesContext): string {
  const s = ctx.settings
  const period = periodWord(ctx.sport)
  switch (topic) {
    case 'prizes':
      return prizesAnswer(ctx)
    case 'house_rules':
      return houseRulesAnswer(ctx)
    case 'trades':
    case 'strikes':
    case 'alliances':
    case 'swaps':
      return governanceAnswer(topic, ctx)
    case 'token_pool':
    case 'survivor_pool':
    case 'auction':
    case 'token_shop':
      return answerSideGameRules(topic, ctx.sideGames, ctx.language)
    case 'voting':
      return [
        '**Voting**',
        `• Vote privately: send @Chimmy vote @manager, or use the ballot on the Chimmy page. Nobody sees your vote until the read.`,
        `• ${votesDueLine(ctx)}${s.lateVotesAllowed ? ' Late votes are accepted.' : ' Late votes do not count.'}`,
        `• ${s.voteChangePolicy === 'allow_until_close' ? 'You can change your vote until voting closes.' : 'Your first valid vote locks in.'}`,
        `• Voting for yourself is ${s.selfVotesAllowed ? 'allowed' : 'not allowed'}.`,
        `• ${s.nonVoterAutoCast ? 'If you do not vote, a vote is cast for you against the lowest scorer you could have voted for.' : 'If you do not vote, you have no vote that council.'}`,
        `• ${tieLine(s)}`,
      ].join('\n')
    case 'ties':
      return `**Ties**\n• ${tieLine(s)}`
    case 'idols':
      if (!s.idolsEnabled) return '**Idols**\n• Idols are turned off in this league.'
      return [
        '**Idols**',
        `• ${s.idolCount} idols are hidden on players. An idol belongs to the PLAYER, so it moves with them in a trade or on waivers.`,
        '• Holders are told privately by Chimmy. Nobody else is told who has one.',
        '• Play one before votes are read: message me "use my idol", or tap Play Idol on the open council.',
        `• ${idolExpiryLine(s)}`,
        s.idolPlayCutoffHours > 0 ? `• Idols must be played at least ${s.idolPlayCutoffHours} hour${s.idolPlayCutoffHours === 1 ? '' : 's'} before votes close. Votes still run to the close.` : '',
        `• Shot in the Dark: give up your vote for a 1 in ${s.shotInTheDarkOdds} chance to be safe. Send @Chimmy shot in the dark.`,
      ].filter(Boolean).join('\n')
    case 'merge':
      return [
        '**Merge**',
        `• ${mergeLine(ctx)}`,
        '• After the merge everyone is in one tribe and immunity is individual: the top scorer that week is safe.',
        s.postMergeSurpriseTribeWeeks > 0 ? `• Watch for ${s.postMergeSurpriseTribeWeeks} surprise week${s.postMergeSurpriseTribeWeeks > 1 ? 's' : ''} after the merge with two temporary tribes.` : '',
        s.idolsEnabled && s.idolExpiryMode === 'merge' ? '• Idols expire at the merge.' : '',
      ].filter(Boolean).join('\n')
    case 'exile':
      if (!s.exileIslandEnabled || s.eliminationOutcome !== 'exile_island') return '**Exile Island**\n• Exile Island is off in this league: a voted-out manager is out, and their players go to waivers.'
      return [
        '**Exile Island**',
        '• A voted-out manager goes to Exile Island and keeps playing for tokens.',
        `• At the end of week ${s.exileReturnWeek}, the Exile manager with the most tokens (and at least ${s.exileReturnTokens}) returns to the island and rebuilds through waivers.`,
        '• Token balances are private. You can see yours on the Token Pool screen; nobody sees anyone else\'s.',
        ...sideGameExileLines(ctx.sideGames, ctx.sport, ctx.language),
      ].join('\n')
    case 'jury': {
      if (isEs(ctx)) return juryAnswerEs(ctx)
      const f = ctx.finale ?? SURVIVOR_FINALE_DEFAULTS
      const w = ctx.finaleWindows ?? null
      const qClose = windowWhen(w?.questionsDeadline)
      const qOpen = windowWhen(w?.questionsOpenAt)
      const aClose = windowWhen(w?.answersDeadline)
      const sClose = windowWhen(w?.speechesDeadline)
      return [
        '**Jury and finale**',
        s.juryEnabled ? '• Managers voted out after the merge join the jury.' : '• There is no jury in this league.',
        s.juryEnabled ? finalJuryStepRulesLine(f, 'en') ?? '' : '',
        ctx.plan ? `• Final Tribal Council is in week ${ctx.plan.finaleWeek} with ${ctx.plan.finalistCount} finalists.` : '• The last managers standing go to Final Tribal Council.',
        s.juryEnabled && f.juryQuestionsEnabled ? `• Each juror may ask each finalist one question${qOpen || qClose ? ` (${qOpen ? `from ${qOpen}` : ''}${qOpen && qClose ? ' ' : ''}${qClose ? `until ${qClose}` : ''})` : ' while the finale is open'}. Finalists answer${aClose ? ` by ${aClose}` : ''}, and the juror marks the answer as seen.` : '',
        f.closingSpeechesEnabled ? `• Each finalist posts one closing speech, editable${sClose ? ` until ${sClose}` : ' until the jury vote is complete'}.${sClose ? ' Jury voting opens when the speeches close.' : ''} The jury sees them first; everyone sees them after the finale.` : '',
        s.juryEnabled && s.finaleVotingEnabled ? '• The jury votes privately for the winner.' : '',
        f.endOfSeasonBallotReveal ? '• After the season, every council\'s ballots are revealed: who voted for whom. Never before the champion is crowned.' : '• Ballots stay secret, even after the season.',
        f.reunionChatEnabled ? '• After the finale, Island Chat reopens to everyone for the reunion.' : '',
      ].filter(Boolean).join('\n')
    }
    case 'immunity':
      return [
        '**Immunity**',
        `• Before the merge, the top-scoring tribe each ${period} is safe${s.twoHighestTribesImmune ? ' (the top two with three or more tribes)' : ''}. The lowest-scoring tribe goes to Tribal Council.`,
        '• After the merge, the top individual scorer is safe.',
        '• Winning a challenge can also earn immunity.',
        (ctx.finale ?? SURVIVOR_FINALE_DEFAULTS).sealedImmunity ? '• Immunity is sealed: who holds individual immunity stays hidden until every vote is in, then it is read with the votes. Votes against them do not count.' : '',
      ].filter(Boolean).join('\n')
    case 'challenges': {
      const c = ctx.challenges
      if (isEs(ctx)) {
        return [
          '**Retos**',
          '• El comisionado crea retos semanales: el total de un partido, quién gana, más o menos, la estadística de un jugador o una pregunta propia. Cada uno dice si es individual o por tribu, cuándo abre y cuándo cierra (hora del Este).',
          '• Respondes una sola vez: la primera respuesta cuenta. En un reto por tribu, la primera respuesta de la tribu cuenta para todos.',
          '• Los retos ligados a un partido o a un jugador se resuelven solos con los resultados guardados; los demás los resuelve el comisionado.',
          '• Los premios pueden ser puntos, FAAB, FAAB quitado a otra tribu, puntos para un compañero, un intercambio libre, un bloqueador o un robo, una ventaja o inmunidad. Algunos se pagan una semana después.',
          c ? `• El FAAB de los retos tiene un tope de $${c.faabWeeklyCap} por ganador y semana.` : '',
          c?.realGame.enabled ? `• Retos de partido real: ${c.realGame.perWeek} por semana, premio ${c.realGame.prizeText}.` : '',
        ].filter(Boolean).join('\n')
      }
      return [
        '**Challenges**',
        '• The commissioner posts weekly challenges: a game total, who wins, over/under, a player stat, or their own question. Each says whether it is individual or tribe, when it opens and when it locks (Eastern time).',
        '• You answer once: the first answer stands. In a tribe challenge, the first answer from your tribe counts for everyone.',
        '• Challenges tied to a game or a player settle themselves from the stored results; the commissioner settles the rest.',
        '• Prizes can be points, FAAB, FAAB taken from another tribe, points to place on a tribemate, a free trade, a steal blocker or a steal, an advantage, or immunity. Some pay out a week later.',
        c ? `• Challenge FAAB is capped at $${c.faabWeeklyCap} per winner per week.` : '',
        c?.realGame.enabled ? `• Real-game challenges: ${c.realGame.perWeek} a week, prize ${c.realGame.prizeText}.` : '',
      ].filter(Boolean).join('\n')
    }
    case 'schedule':
      return `**Schedule**\n• ${scheduleLine(ctx)}`
    case 'overview':
      return [
        `**How Survivor works here (${ctx.sport.toUpperCase()})**`,
        '• Your fantasy team scores like a normal league. Your tribe\'s total decides who goes to Tribal Council.',
        '• The lowest-scoring tribe votes someone out, privately, through me.',
        `• ${mergeLine(ctx)}`,
        s.exileIslandEnabled && s.eliminationOutcome === 'exile_island' ? `• Voted out? You go to Exile Island and can earn your way back in week ${s.exileReturnWeek}.` : '',
        s.juryEnabled ? '• After the merge, voted-out managers form the jury that picks the winner.' : '',
        ctx.governance ? '• Ask me about voting, ties, idols, immunity, the merge, Exile, the jury, the schedule, trades, alliances, swaps or conduct.' : '• Ask me about voting, ties, idols, immunity, the merge, Exile, the jury or the schedule.',
      ].filter(Boolean).join('\n')
  }
}

export type SurvivorRulesSection = { topic: SurvivorRulesTopic; title: string; lines: string[] }

/** The rulebook order: how a manager meets each part of the season. */
export const SURVIVOR_RULEBOOK_TOPICS: readonly SurvivorRulesTopic[] = ['overview', 'immunity', 'voting', 'ties', 'idols', 'challenges', 'merge', 'exile', 'jury', 'schedule']

/** One answer as a titled list: "**Title**\n• a\n• b" becomes { title, lines }. */
export function survivorRulesSection(topic: SurvivorRulesTopic, ctx: SurvivorRulesContext): SurvivorRulesSection {
  const [head, ...rest] = answerSurvivorRules(topic, ctx).split('\n')
  return {
    topic,
    title: head.replace(/\*\*/g, '').trim(),
    lines: rest.map(line => line.replace(/^•\s*/, '').trim()).filter(Boolean),
  }
}

/** The side-game sections a rulebook carries: only those the commissioner switched on. */
export function sideGameRulebookTopics(sideGames: SurvivorSideGameSettings | null | undefined, exileOn: boolean): SurvivorRulesTopic[] {
  if (!sideGames) return []
  return [
    ...(exileOn && sideGames.tokenPoolEnabled ? ['token_pool' as const] : []),
    ...(sideGames.tokenShopEnabled && sideGames.tokenShopItems.some((i) => i.enabled) ? ['token_shop' as const] : []),
    ...(sideGames.survivorPoolEnabled ? ['survivor_pool' as const] : []),
  ]
}

/** The governance sections a league's rulebook carries: conduct always, the rest when switched on. */
export function governanceRulebookTopics(governance: SurvivorGovernanceSettings | null | undefined): SurvivorRulesTopic[] {
  if (!governance) return []
  return [
    ...(governance.tradeRulesEnabled ? ['trades' as const] : []),
    ...(governance.alliancesEnabled ? ['alliances' as const] : []),
    ...(governance.swapSchedule.length ? ['swaps' as const] : []),
    'strikes' as const,
  ]
}

/**
 * The whole rulebook for a league, from its current settings. Recomputed on every read. The prizes
 * section appears only when the commissioner set weekly prizes or a tie-break position, the
 * governance sections when switched on, and the house rules (pinned last) only when written, so a
 * league with none of them reads exactly as before.
 */
export function buildSurvivorRulebook(ctx: SurvivorRulesContext): SurvivorRulesSection[] {
  const topics: SurvivorRulesTopic[] = [...SURVIVOR_RULEBOOK_TOPICS]
  if (ctx.prizes && (weeklyPrizesActive(ctx.prizes) || ctx.prizes.tribeTieBreakPosition !== 'none')) topics.splice(topics.indexOf('challenges') + 1, 0, 'prizes')
  topics.push(...governanceRulebookTopics(ctx.governance))
  topics.push(...sideGameRulebookTopics(ctx.sideGames, ctx.settings.exileIslandEnabled && ctx.settings.eliminationOutcome === 'exile_island'))
  if (ctx.houseRules?.trim()) topics.push('house_rules')
  return topics.map(topic => survivorRulesSection(topic, ctx))
}
