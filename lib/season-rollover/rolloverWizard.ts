/**
 * THE SEASON ROLLOVER WIZARD — the steps between "the champion is crowned" and "next season's
 * draft is set up", each one measured from the league's own rows, in the order a commissioner
 * takes them:
 *
 *   season       the season is over (a champion is crowned); until then nothing below can happen
 *   payouts      what each place is owed (lib/payouts) and whose dues are still unpaid
 *   managers     every team has a manager — an empty team should be filled before the draft
 *   dues         next season's dues, carried into the renew
 *   rules        a look at the rules before they carry over
 *   draft order  how next season's draft is ordered
 *   renew        one action (lib/redraft/offseason/renewRedraftLeague.ts): rosters reset, pending
 *                trades and claims cancelled, next season and its draft created
 *
 * The renew itself is the existing one, which is free. AF Commissioner adds two conveniences: a
 * drafted "we're back" announcement and carrying the dues into next season's payout buy-in.
 *
 * Pure: the words are the UI's; this decides each step's state.
 */
import type { RenewDraftOrderMode } from '@/lib/redraft/offseason/renewRedraftLeague'

export type RolloverStepKey = 'season' | 'payouts' | 'managers' | 'dues' | 'rules' | 'draft_order' | 'renew'
export type RolloverStepState = 'done' | 'todo' | 'blocked' | 'optional'

export type RolloverInput = {
  season: number
  nextSeason: number
  seasonOver: boolean
  /** The league already renewed into the season it is now in, and it has not started. */
  renewed: boolean
  champion: string | null
  payouts: { configured: boolean; final: boolean; places: ReadonlyArray<{ place: number; cents: number; team: string | null }> }
  managers: { active: number; orphanTeams: readonly string[] }
  dues: { enabled: boolean; amountDollars: number | null; unpaidTeams: number }
  draftOrder: RenewDraftOrderMode
  /** Cancelled by the renew; the commissioner should know before pressing it. */
  pendingTrades: number
  pendingClaims: number
}

export type RolloverStep = { key: RolloverStepKey; state: RolloverStepState }

export type RolloverPlan = {
  steps: RolloverStep[]
  canRenew: boolean
  /** Things the renew will undo, shown beside the button. */
  willCancel: { trades: number; claims: number }
}

export function buildRolloverPlan(input: RolloverInput): RolloverPlan {
  const over = input.seasonOver || input.renewed
  const gated = (state: RolloverStepState): RolloverStepState => (over ? state : 'blocked')
  const steps: RolloverStep[] = [
    { key: 'season', state: over ? 'done' : 'blocked' },
    {
      key: 'payouts',
      state: gated(!input.payouts.configured ? 'optional' : input.dues.unpaidTeams > 0 || !input.payouts.final ? 'todo' : 'done'),
    },
    { key: 'managers', state: gated(input.managers.orphanTeams.length > 0 ? 'todo' : 'done') },
    { key: 'dues', state: gated(input.dues.enabled ? 'done' : 'optional') },
    { key: 'rules', state: gated('optional') },
    { key: 'draft_order', state: gated('done') },
    { key: 'renew', state: input.renewed ? 'done' : over ? 'todo' : 'blocked' },
  ]
  return {
    steps,
    canRenew: input.seasonOver && !input.renewed,
    willCancel: { trades: input.pendingTrades, claims: input.pendingClaims },
  }
}

/** The broadcast route's limit (components/commish/BroadcastModal.tsx). */
export const ANNOUNCEMENT_LIMIT = 500

const DRAFT_ORDER_WORDS: Record<RenewDraftOrderMode, { en: string; es: string }> = {
  standings: { en: 'worst record picks first', es: 'el peor récord elige primero' },
  reverse_standings: { en: 'the champion picks first', es: 'el campeón elige primero' },
  random: { en: 'a random order', es: 'un orden aleatorio' },
  manual: { en: 'the order the commissioner set', es: 'el orden que fijó el comisionado' },
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`
const ord = (n: number, es: boolean) =>
  es ? `${n}.º` : `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

/**
 * AF Commissioner: the "we're back" announcement, drafted for the commissioner to edit and send
 * through the league's @everyone broadcast. Never sent on its own. Trimmed to the broadcast limit
 * by dropping the payout line first, then the last sentence, never mid-word.
 */
export function buildRolloverAnnouncement(input: {
  leagueName: string
  season: number
  nextSeason: number
  champion: string | null
  places: ReadonlyArray<{ place: number; cents: number; team: string | null }>
  duesDollars: number | null
  draftOrder: RenewDraftOrderMode
  language: 'en' | 'es'
}): string {
  const es = input.language === 'es'
  const paid = input.places.filter((p) => p.team && p.cents > 0)
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
    input.duesDollars
      ? es
        ? `La cuota de ${input.nextSeason} es $${input.duesDollars}.`
        : `Dues for ${input.nextSeason} are $${input.duesDollars}.`
      : null,
    es
      ? `El draft sigue ${DRAFT_ORDER_WORDS[input.draftOrder].es}. Confirma que vuelves.`
      : `The draft goes by ${DRAFT_ORDER_WORDS[input.draftOrder].en}. Let us know you’re in.`,
  ].filter((p): p is string => Boolean(p))

  let text = parts.join(' ')
  if (text.length > ANNOUNCEMENT_LIMIT) text = parts.filter((p) => !p.startsWith(es ? 'Premios: ' : 'Payouts: ')).join(' ')
  while (text.length > ANNOUNCEMENT_LIMIT) {
    const cut = text.lastIndexOf('. ', ANNOUNCEMENT_LIMIT - 1)
    text = cut > 0 ? text.slice(0, cut + 1) : text.slice(0, text.lastIndexOf(' ', ANNOUNCEMENT_LIMIT - 1))
  }
  return text
}
