/**
 * Chimmy's answers to "how does X work" in a Survivor league, built from THIS league's settings and
 * season plan rather than fixed copy. Pure: the caller loads the settings and plan. Nothing here
 * reads or reveals hidden state (who holds an idol, how anyone voted, token balances).
 */

import type { SurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import type { SurvivorFoundationSettings } from './survivorSettings'
import { weeklyPrizesActive, type SurvivorWeeklyPrizeSettings } from './survivorWeeklyPrizes'
import { SURVIVOR_FINALE_DEFAULTS, type SurvivorFinaleSettings, type SurvivorFinaleWindows } from './survivorFinaleSettings'

export type SurvivorRulesTopic =
  | 'voting' | 'ties' | 'idols' | 'merge' | 'exile' | 'jury' | 'immunity' | 'challenges' | 'schedule' | 'overview'
  | 'prizes' | 'house_rules'

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
  /** League.language: the prize and house-rules answers follow it (English / Spanish). */
  language?: string | null
  /** Jury, finale and reunion rules (survivorFinaleSettings.ts). Defaults when absent. */
  finale?: SurvivorFinaleSettings
  /** This season's finale windows, when set. */
  finaleWindows?: SurvivorFinaleWindows | null
}

function windowWhen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
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
  ['house_rules', /\b(house rules?|conduct|screenshots?|reglas de la casa)\b/],
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
 * The rules topic a message asks about, or null when it is not a rules question. "How does Survivor
 * work" with no specific topic is the overview.
 */
export function survivorRulesTopic(message: string): SurvivorRulesTopic | null {
  const text = message.toLowerCase().replace(/@chimmy\b/g, ' ').trim()
  if (!text || !QUESTION.test(text)) return null
  for (const [topic, pattern] of TOPIC_PATTERNS) if (pattern.test(text)) return topic
  if (/\bsurvivor\b/.test(text) || /\b(rules|how (?:does|do) this league work)\b/.test(text)) return 'overview'
  return null
}

const PERSONAL_ASK = /\b(my idols?|(?:use|play) my idol|am i safe|my survivor status)\b/

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
  }
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

export function answerSurvivorRules(topic: SurvivorRulesTopic, ctx: SurvivorRulesContext): string {
  const s = ctx.settings
  const period = periodWord(ctx.sport)
  switch (topic) {
    case 'prizes':
      return prizesAnswer(ctx)
    case 'house_rules':
      return houseRulesAnswer(ctx)
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
      ].join('\n')
    case 'jury': {
      const f = ctx.finale ?? SURVIVOR_FINALE_DEFAULTS
      const w = ctx.finaleWindows ?? null
      const qClose = windowWhen(w?.questionsDeadline)
      const qOpen = windowWhen(w?.questionsOpenAt)
      const aClose = windowWhen(w?.answersDeadline)
      const sClose = windowWhen(w?.speechesDeadline)
      return [
        '**Jury and finale**',
        s.juryEnabled ? '• Managers voted out after the merge join the jury.' : '• There is no jury in this league.',
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
    case 'challenges':
      return '**Challenges**\n• Weekly challenges are posted in the league. Lock your pick before the challenge locks.\n• Rewards can include immunity, tokens or an advantage, and are settled from real game results.'
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
        '• Ask me about voting, ties, idols, immunity, the merge, Exile, the jury or the schedule.',
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

/**
 * The whole rulebook for a league, from its current settings. Recomputed on every read. The prizes
 * section appears only when the commissioner set weekly prizes or a tie-break position, and the
 * house rules (pinned last) only when written, so a league with neither reads exactly as before.
 */
export function buildSurvivorRulebook(ctx: SurvivorRulesContext): SurvivorRulesSection[] {
  const topics: SurvivorRulesTopic[] = [...SURVIVOR_RULEBOOK_TOPICS]
  if (ctx.prizes && (weeklyPrizesActive(ctx.prizes) || ctx.prizes.tribeTieBreakPosition !== 'none')) topics.splice(topics.indexOf('challenges') + 1, 0, 'prizes')
  if (ctx.houseRules?.trim()) topics.push('house_rules')
  return topics.map(topic => survivorRulesSection(topic, ctx))
}
