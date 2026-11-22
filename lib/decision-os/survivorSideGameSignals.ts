import { SEVERITY_RANK, type AttentionSignalSeverity, type DecisionOsAttentionSignal } from './attentionSignals'

/**
 * Exile Island and the Survivor side games as Decision OS attention signals: "Survivor Pool pick due
 * tonight", "Auction closes in 2h", "You have 4 tokens: the shop is open", "Exile claims close at …".
 *
 * Same contract as `attentionSignals.ts`, `careerSignals.ts`, `survivorPrizeSignals.ts` and
 * `survivorSignals.ts`: pure, zero I/O, interpret facts that ALREADY exist (the manager's own
 * side-game view, `loadSurvivorSideGameView`) and never invent one. Ids are deterministic. Nothing
 * here names another manager, their bid, or who is on Exile.
 */

export interface SurvivorSideGameSignalInput {
  leagueId: string
  language?: string | null
  role: 'active' | 'exile' | 'out'
  week: number
  /** The earliest kickoff still open this week (ISO), or null when nothing is left to pick. */
  nextLockAt: string | null
  tokenPool: { enabled: boolean; open: boolean; picksLeft: number; pot: number; streak: boolean } | null
  /** `missedPick`: the commissioner's missed-pick rule — a miss that costs something makes the pick urgent. */
  pool: { enabled: boolean; started: boolean; alive: boolean; banned: boolean; picked: boolean; revivesLeft: number; missedPick?: 'none' | 'loss' | 'revive' } | null
  auctions: ReadonlyArray<{ auctionId: string; label: string; closesAt: string; takingBids: boolean; myBids: number }>
  shop: { open: boolean; tokens: number; cheapest: number | null } | null
  exileBid: { week: number; closesAt: string; hasBid: boolean } | null
}

const es = (language: string | null | undefined) => String(language ?? '').toLowerCase().startsWith('es')
const HOUR = 3_600_000

function hoursUntil(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / HOUR
}

function when(iso: string, now: Date, spanish: boolean): string {
  const h = hoursUntil(iso, now)
  if (h < 1) return spanish ? 'en menos de una hora' : 'in under an hour'
  if (h < 24) return spanish ? `en ${Math.round(h)} h` : `in ${Math.round(h)}h`
  const text = new Intl.DateTimeFormat(spanish ? 'es-US' : 'en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  return spanish ? `el ${text} ET` : `${text} ET`
}

function signal(input: SurvivorSideGameSignalInput, now: Date, key: string, severity: AttentionSignalSeverity, title: string, explanation: string, action: string | null): DecisionOsAttentionSignal {
  return {
    id: `survivor_side_game:${input.leagueId}:${key}`,
    leagueId: input.leagueId,
    type: 'survivor_side_game',
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title,
    explanation,
    recommendedAction: action,
    timestamp: now.toISOString(),
    source: 'survivor',
  }
}

export function deriveSurvivorSideGameSignals(inputs: readonly SurvivorSideGameSignalInput[], now: Date): DecisionOsAttentionSignal[] {
  const out: DecisionOsAttentionSignal[] = []
  for (const input of inputs) {
    const sp = es(input.language)
    const lockSoon = input.nextLockAt && hoursUntil(input.nextLockAt, now) > 0 && hoursUntil(input.nextLockAt, now) <= 48 ? input.nextLockAt : null

    const pool = input.pool
    if (pool?.enabled && pool.started && input.role === 'active') {
      if (pool.alive && !pool.picked && lockSoon) {
        // A miss that costs you (a loss or a revive) is more than a lost prize: raise it a level.
        const costly = pool.missedPick === 'loss' || pool.missedPick === 'revive'
        const urgent = hoursUntil(lockSoon, now) <= 12 || (costly && hoursUntil(lockSoon, now) <= 24)
        const missText = pool.missedPick === 'loss'
          ? (sp ? ' Sin elección, cuenta como derrota.' : ' No pick counts as a loss.')
          : pool.missedPick === 'revive'
            ? (sp ? ' Sin elección, gastas una resurrección.' : ' No pick uses a revive.')
            : (sp ? ' Sin elección no ganas el premio.' : ' No pick, no prize.')
        out.push(signal(input, now, `pool_pick:${input.week}`, urgent ? 'high' : 'medium',
          sp ? (urgent ? 'Tu elección del Pozo Survivor vence hoy' : 'Haz tu elección del Pozo Survivor') : (urgent ? 'Survivor Pool pick due tonight' : 'Make your Survivor Pool pick'),
          sp ? `El primer partido de la semana ${input.week} empieza ${when(lockSoon, now, true)}.${missText}` : `Week ${input.week}'s first game kicks off ${when(lockSoon, now, false)}.${missText}`,
          sp ? 'Abre Survivor y elige un equipo ganador.' : 'Open Survivor and pick a winning team.'))
      } else if (!pool.alive && !pool.banned && pool.revivesLeft > 0) {
        out.push(signal(input, now, `pool_revive:${input.week}`, 'low',
          sp ? 'Puedes volver al Pozo Survivor' : 'You can get back into the Survivor Pool',
          sp ? `Te quedan ${pool.revivesLeft} ${pool.revivesLeft === 1 ? 'resurrección' : 'resurrecciones'}.` : `You have ${pool.revivesLeft} ${pool.revivesLeft === 1 ? 'revive' : 'revives'} left.`,
          sp ? 'Usa una resurrección y elige de nuevo.' : 'Use a revive and pick again.'))
      }
    }

    const tp = input.tokenPool
    if (tp?.enabled && tp.open && input.role === 'exile' && tp.picksLeft > 0 && lockSoon) {
      out.push(signal(input, now, `token_pool:${input.week}`, 'medium',
        sp ? 'El Pozo de Fichas está abierto' : 'The Token Pool is open',
        sp ? `Te ${tp.picksLeft === 1 ? 'queda 1 elección' : `quedan ${tp.picksLeft} elecciones`} esta semana; el próximo partido empieza ${when(lockSoon, now, true)}.` : `You have ${tp.picksLeft} ${tp.picksLeft === 1 ? 'pick' : 'picks'} left this week; the next game kicks off ${when(lockSoon, now, false)}.`,
        sp ? 'Elige un ganador para ganar una ficha.' : 'Pick a winner to earn a token.'))
    }
    if (tp?.enabled && tp.streak && tp.pot >= 2 && input.role === 'exile') {
      out.push(signal(input, now, `token_pool_pot:${tp.pot}`, 'low',
        sp ? `Tienes una racha de ${tp.pot} fichas sin cobrar` : `You have a ${tp.pot}-token streak to bank`,
        sp ? 'Un fallo antes de cobrarla la pierde.' : 'One wrong pick before you bank it loses it.',
        sp ? 'Cobra la racha en el Pozo de Fichas.' : 'Cash it out in the Token Pool.'))
    }

    for (const a of input.auctions) {
      if (!a.takingBids || input.role !== 'active') continue
      const h = hoursUntil(a.closesAt, now)
      if (h <= 0 || h > 24) continue
      const severity: AttentionSignalSeverity = h <= 2 ? 'high' : 'medium'
      out.push(signal(input, now, `auction:${a.auctionId}`, severity,
        sp ? `La subasta cierra ${when(a.closesAt, now, true)}` : `Auction closes ${when(a.closesAt, now, false)}`,
        sp ? `"${a.label}"${a.myBids ? `: tienes ${a.myBids} ${a.myBids === 1 ? 'puja' : 'pujas'}.` : ': todavía no pujaste.'}` : `"${a.label}"${a.myBids ? `: you have ${a.myBids} ${a.myBids === 1 ? 'bid' : 'bids'} in.` : ': you have not bid yet.'}`,
        sp ? 'Abre la subasta en Survivor.' : 'Open the auction in Survivor.'))
    }

    const shop = input.shop
    if (shop?.open && shop.cheapest != null && shop.tokens >= shop.cheapest) {
      out.push(signal(input, now, `shop:${shop.tokens}`, 'informational',
        sp ? `Tienes ${shop.tokens} ${shop.tokens === 1 ? 'ficha' : 'fichas'}: la tienda está abierta` : `You have ${shop.tokens} ${shop.tokens === 1 ? 'token' : 'tokens'}: the shop is open`,
        sp ? 'Comprar gasta fichas que también cuentan para volver del Exilio.' : 'Buying spends tokens that also count toward a return from Exile.',
        null))
    }

    const bid = input.exileBid
    if (bid && input.role === 'exile') {
      const h = hoursUntil(bid.closesAt, now)
      if (h > 0 && h <= 36) {
        out.push(signal(input, now, `exile_bid:${bid.week}`, bid.hasBid ? 'low' : h <= 6 ? 'high' : 'medium',
          sp ? `Las pujas por equipos del Exilio cierran ${when(bid.closesAt, now, true)}` : `Exile claims close ${when(bid.closesAt, now, false)}`,
          sp ? (bid.hasBid ? 'Tu puja está hecha; puedes cambiarla hasta el cierre.' : 'Todavía no pujaste por un equipo.') : (bid.hasBid ? 'Your bid is in; you can change it until the close.' : 'You have not bid on a team yet.'),
          sp ? 'Puja por tu equipo del Exilio.' : 'Bid for your Exile team.'))
      }
    }
  }
  return out
}
