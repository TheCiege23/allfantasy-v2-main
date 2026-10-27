/**
 * THE DYNASTY ROLLOVER WIZARD — the steps between "the champion is crowned" and "next season is
 * being played" for a league that keeps its rosters, in the order a dynasty commissioner takes
 * them (docs/commissioner/DYNASTY_COMMISH_CHECKLIST.md):
 *
 *   season       the season is over; until then nothing below can happen
 *   draft order  how the rookie draft is ordered, then creating it (the order is fixed then)
 *   taxi         the taxi rules, and which taxi players the start will move to the bench
 *   contracts    salary-cap leagues only: contracts that run out with this season
 *   dues         next season's dues, a fresh list with nobody marked paid
 *   schedule     next season's schedule (the start builds one if it is missing)
 *   start        one action (lib/redraft/offseason/startDynastyNewSeason.ts): through the rookie
 *                draft when it is done, or without one when the commissioner skips it
 *
 * Nothing here resets a roster. Rosters were carried at finalize; the start re-checks taxi and IR
 * (dynastyRolloverHousekeeping.ts) and flags teams over the limit. The redraft wizard
 * (./rolloverWizard.ts) is the other half and is untouched by this one.
 *
 * Pure: the words are the UI's; this decides each step's state.
 */
import { fitAnnouncement, money, ord, type RolloverStepState } from './rolloverWizard'

export type DynastyStepKey = 'season' | 'draft_order' | 'taxi' | 'contracts' | 'dues' | 'schedule' | 'start'

/** Where the rookie draft's order comes from, in createNextLeagueDraft's precedence. */
export type RookieOrderSource = 'lottery' | 'live_order' | 'max_pf' | 'standings' | 'commissioner'

export type RookieDraftState = 'none' | 'open' | 'complete'

export type DynastyRolloverInput = {
  /** The season being rolled out of. */
  season: number
  nextSeason: number
  seasonOver: boolean
  /** Next season is being played. */
  started: boolean
  champion: string | null
  rookieDraft: RookieDraftState
  draftOrder: {
    source: RookieOrderSource
    /** The live rookie order saved its final order for next season's draft. */
    finalOrderSaved: boolean
  }
  taxi: {
    slots: number
    yearsLimit: number | null
    /** Max seasons on the taxi squad (lib/taxi/taxiMaxYears.ts); null is no limit. */
    maxSeasons: number | null
    allowNonRookies: boolean
    /** Taxi players the start will move to the bench (a preview before it, what it did after). */
    toBench: number
    /** Taxi players whose experience is not on file, so they stay where they are. */
    unverified: number
  }
  /** Null: the league has no contracts. */
  contracts: { active: number; expiring: number } | null
  dues: {
    enabled: boolean
    amountDollars: number | null
    /** This season's teams that have not paid. */
    unpaidTeams: number
    /** The commissioner already set next season's dues. */
    setForNextSeason: boolean
  }
  /** Next season's schedule, once its season exists. */
  schedule: { matchups: number; weeks: number }
  /** Teams over the roster limit after the carry (and the rookie draft). */
  overLimitTeams: number
}

export type DynastyRolloverStep = { key: DynastyStepKey; state: RolloverStepState }

export type DynastyRolloverPlan = {
  steps: DynastyRolloverStep[]
  canStart: boolean
  /** The start would begin the season without a rookie draft, so it needs a second yes. */
  startSkipsRookieDraft: boolean
}

export function buildDynastyRolloverPlan(input: DynastyRolloverInput): DynastyRolloverPlan {
  const over = input.seasonOver || input.started
  const gated = (state: RolloverStepState): RolloverStepState => (over ? state : 'blocked')
  const done = input.started
  const taxiState: RolloverStepState =
    input.taxi.toBench > 0 && !done ? 'todo' : input.taxi.slots > 0 || input.taxi.toBench > 0 ? 'done' : 'optional'
  const steps: DynastyRolloverStep[] = [
    { key: 'season', state: over ? 'done' : 'blocked' },
    { key: 'draft_order', state: gated(done || input.rookieDraft !== 'none' ? 'done' : 'todo') },
    { key: 'taxi', state: gated(taxiState) },
    ...(input.contracts
      ? [{ key: 'contracts' as const, state: gated(input.contracts.expiring > 0 && !done ? 'todo' : 'done') }]
      : []),
    { key: 'dues', state: gated(input.dues.setForNextSeason ? 'done' : 'optional') },
    { key: 'schedule', state: gated(input.schedule.matchups > 0 ? 'done' : 'optional') },
    {
      key: 'start',
      state: done ? 'done' : !input.seasonOver || input.rookieDraft === 'open' ? 'blocked' : 'todo',
    },
  ]
  const canStart = input.seasonOver && !input.started && input.rookieDraft !== 'open'
  return { steps, canStart, startSkipsRookieDraft: canStart && input.rookieDraft === 'none' }
}

const ORDER_WORDS: Record<RookieOrderSource, { en: string; es: string }> = {
  lottery: { en: 'a weighted lottery', es: 'una lotería ponderada' },
  live_order: { en: 'the final standings and playoffs', es: 'la clasificación final y los playoffs' },
  max_pf: { en: 'fewest points first', es: 'menos puntos primero' },
  standings: { en: 'worst record first', es: 'peor récord primero' },
  commissioner: { en: 'the order the commissioner set', es: 'el orden que fijó el comisionado' },
}

export function rookieOrderWords(source: RookieOrderSource, language: 'en' | 'es'): string {
  return ORDER_WORDS[source][language]
}

/**
 * AF Commissioner: the "we're back" announcement for a dynasty league, drafted for the
 * commissioner to edit and send through the @everyone broadcast. Never sent on its own.
 */
export function buildDynastyRolloverAnnouncement(input: {
  leagueName: string
  season: number
  nextSeason: number
  champion: string | null
  places: ReadonlyArray<{ place: number; cents: number; team: string | null }>
  duesDollars: number | null
  orderSource: RookieOrderSource
  rookieDraft: RookieDraftState
  taxiToBench: number
  language: 'en' | 'es'
}): string {
  const es = input.language === 'es'
  const paid = input.places.filter((p) => p.team && p.cents > 0)
  const order = rookieOrderWords(input.orderSource, input.language)
  const parts = [
    es ? `¡${input.leagueName} vuelve para ${input.nextSeason}!` : `${input.leagueName} is back for ${input.nextSeason}!`,
    input.champion
      ? es
        ? `Felicidades a ${input.champion}, campeón de ${input.season}.`
        : `Congratulations to ${input.champion}, our ${input.season} champion.`
      : null,
    paid.length
      ? (es ? 'Premios: ' : 'Payouts: ') + paid.map((p) => `${ord(p.place, es)} ${p.team} ${money(p.cents)}`).join(', ') + '.'
      : null,
    input.rookieDraft === 'complete'
      ? es
        ? 'El draft de novatos ya terminó.'
        : 'The rookie draft is done.'
      : es
        ? `El draft de novatos se ordena por ${order}.`
        : `The rookie draft is ordered by ${order}.`,
    input.taxiToBench > 0
      ? es
        ? `Revisa tu taxi: ${input.taxiToBench} jugador${input.taxiToBench === 1 ? '' : 'es'} ya no cumple${input.taxiToBench === 1 ? '' : 'n'} las reglas y pasará${input.taxiToBench === 1 ? '' : 'n'} al banquillo.`
        : `Check your taxi squad: ${input.taxiToBench} player${input.taxiToBench === 1 ? ' no longer qualifies and moves' : 's no longer qualify and move'} to the bench.`
      : null,
    input.duesDollars
      ? es
        ? `La cuota de ${input.nextSeason} es $${input.duesDollars}.`
        : `Dues for ${input.nextSeason} are $${input.duesDollars}.`
      : null,
    es ? 'Confirma que vuelves.' : 'Let us know you’re in.',
  ].filter((p): p is string => Boolean(p))
  return fitAnnouncement(parts, es ? 'Premios: ' : 'Payouts: ')
}

/**
 * Chimmy's view of the offseason, as prose (lib/chimmy-context/leagueOfficeSummary.ts). Members are
 * told what affects their team; the commissioner is also told what is left to do.
 */
export function describeDynastyOffseason(input: DynastyRolloverInput, viewer: 'commissioner' | 'member'): string[] {
  if (!input.seasonOver || input.started) return []
  const lines = [
    `The ${input.season} season is over and ${input.nextSeason} has not started. Rosters carry over; nothing is reset.`,
    input.rookieDraft === 'none'
      ? `The ${input.nextSeason} rookie draft has not been created yet; it will be ordered by ${rookieOrderWords(input.draftOrder.source, 'en')}.`
      : input.rookieDraft === 'open'
        ? `The ${input.nextSeason} rookie draft is set up and not finished; the season starts after it.`
        : `The ${input.nextSeason} rookie draft is done.`,
  ]
  if (input.taxi.toBench > 0)
    lines.push(`${input.taxi.toBench} taxi player${input.taxi.toBench === 1 ? ' no longer meets the league’s taxi rules and moves' : 's no longer meet the league’s taxi rules and move'} to the bench when the season starts.`)
  if (input.dues.setForNextSeason && input.dues.amountDollars) lines.push(`Dues for ${input.nextSeason} are $${input.dues.amountDollars}.`)
  if (viewer === 'commissioner') {
    const plan = buildDynastyRolloverPlan(input)
    const left = plan.steps.filter((s) => s.state === 'todo' && s.key !== 'start').map((s) => STEP_WORDS[s.key])
    lines.push(
      left.length
        ? `Commissioner: still to do in the rollover wizard on the Commissioner Hub: ${left.join(', ')}.`
        : 'Commissioner: the rollover wizard on the Commissioner Hub has nothing left but starting the season.',
    )
    if (input.contracts?.expiring)
      lines.push(`${input.contracts.expiring} contract${input.contracts.expiring === 1 ? '' : 's'} run out with the ${input.season} season.`)
  }
  return lines
}

const STEP_WORDS: Record<DynastyStepKey, string> = {
  season: 'finish the season',
  draft_order: 'create the rookie draft',
  taxi: 'review the taxi squads',
  contracts: 'expiring contracts',
  dues: 'next season’s dues',
  schedule: 'the schedule',
  start: 'start the season',
}
