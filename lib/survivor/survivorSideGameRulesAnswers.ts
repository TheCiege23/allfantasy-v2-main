/**
 * Rules answers for Exile Island and the side games, from the league's own settings, in English and
 * Spanish. Pure. survivorRulesAnswers.ts routes the `token_pool`, `survivor_pool`, `auction` and
 * `token_shop` topics here and adds the Exile extras to its own Exile answer.
 */

import { exileSlotLabel, SURVIVOR_SIDE_GAME_DEFAULTS, type SurvivorSideGameSettings } from './survivorSideGameSettings'

export type SideGameRulesTopic = 'token_pool' | 'survivor_pool' | 'auction' | 'token_shop'

const isEs = (language?: string | null) => String(language ?? '').toLowerCase().startsWith('es')
const block = (title: string, items: Array<string | false | null | undefined>) => [`**${title}**`, ...items.filter((x): x is string => Boolean(x)).map((x) => `• ${x}`)].join('\n')

function prizeText(p: SurvivorSideGameSettings['survivorPoolPrize'], es: boolean): string {
  switch (p.kind) {
    case 'none': return es ? 'solo el orgullo' : 'bragging rights only'
    case 'faab': return es ? `$${p.amount} de FAAB` : `$${p.amount} FAAB`
    case 'score_bonus': return es ? `+${p.amount} puntos la semana siguiente` : `+${p.amount} points the next week`
    case 'advantage': return es ? `una ventaja (${p.powerType.replace(/_/g, ' ')})` : `an advantage (${p.powerType.replace(/_/g, ' ')})`
    case 'free_trade_token': return es ? `un intercambio libre${p.samePositionOnly ? ' de la misma posición' : ''}` : `a free trade${p.samePositionOnly ? ' (same position)' : ''}`
    case 'steal_blocker': return es ? 'un bloqueador de robos' : 'a steal blocker'
    case 'auction_cash': return es ? `$${p.amount} de dinero de subasta` : `$${p.amount} auction cash`
    case 'tokens': return es ? `${p.amount} fichas del Exilio` : `${p.amount} Exile tokens`
    case 'opponent_penalty': return es ? `−${p.amount} puntos para un rival que elijas` : `−${p.amount} points on an opponent you choose`
    case 'forced_bench': return es ? 'mandar a la banca a un jugador de un rival que elijas' : 'forcing one of an opponent’s players to the bench'
    case 'vote_taken': return es ? 'quitarle el voto a un rival en su próximo Consejo Tribal' : 'taking an opponent’s vote at their next Tribal Council'
  }
}

/** The Survivor Pool's tie, missed-pick and no-reuse lines. */
function poolExtraLines(s: SurvivorSideGameSettings, es: boolean): string[] {
  const tie = s.survivorPoolTieRule === 'loss'
    ? (es ? 'Un empate cuenta como derrota: quedas fuera.' : 'A tie counts as a loss: you are out.')
    : s.survivorPoolTieRule === 'win'
      ? (es ? 'Un empate cuenta como victoria.' : 'A tie counts as a win.')
      : (es ? 'Un empate no gana ni elimina.' : 'A tie neither wins nor knocks you out.')
  const miss = s.survivorPoolMissedPick === 'loss'
    ? (es ? 'Si no eliges en una semana, cuenta como derrota.' : 'Miss a week’s pick and it counts as a loss.')
    : s.survivorPoolMissedPick === 'revive'
      ? (es ? 'Si no eliges en una semana, gastas una resurrección (sin resurrecciones, quedas fuera).' : 'Miss a week’s pick and it uses a revive (with none left, you are out).')
      : null
  const reuse = s.survivorPoolNoReuse ? (es ? 'Cada equipo se puede elegir una sola vez en la temporada.' : 'You can pick each team only once all season.') : null
  return [tie, miss, reuse].filter((x): x is string => Boolean(x))
}

export function answerSideGameRules(topic: SideGameRulesTopic, settings: SurvivorSideGameSettings | null | undefined, language?: string | null): string {
  const s = settings ?? SURVIVOR_SIDE_GAME_DEFAULTS
  const es = isEs(language)
  switch (topic) {
    case 'token_pool': {
      if (!s.tokenPoolEnabled) return es ? block('Pozo de Fichas', ['El Pozo de Fichas no está activo en esta liga.']) : block('Token Pool', ['The Token Pool is not running in this league.'])
      const wrong = s.tokenPoolWrongPick === 'lose_all'
        ? (es ? 'Si fallas, pierdes TODAS tus fichas.' : 'Pick wrong and you lose ALL your tokens.')
        : s.tokenPoolWrongPick === 'minus_one'
          ? (es ? 'Si fallas, pierdes una ficha.' : 'Pick wrong and you lose one token.')
          : (es ? 'Fallar no te cuesta fichas.' : 'A wrong pick costs you nothing.')
      return es
        ? block('Pozo de Fichas', [
          'Solo para los mánagers en la Isla del Exilio.',
          `Elige el ganador de un partido de la semana, hasta ${s.tokenPoolPicksPerWeek} por semana. Cada partido se cierra al empezar.`,
          s.tokenPoolMode === 'streak' ? 'Cada acierto suma una ficha a tu racha. Puedes cobrar la racha cuando quieras; si fallas antes de cobrarla, la pierdes.' : 'Cada acierto te da una ficha.',
          wrong,
          s.tokenPoolAutoSettle ? 'Se liquida solo con el marcador final.' : 'El comisionado liquida los resultados.',
          s.tokenPoolOpen ? 'Está abierto ahora.' : 'El comisionado lo cerró por ahora; tus elecciones abiertas se liquidan igual.',
        ])
        : block('Token Pool', [
          'For managers on Exile Island only.',
          `Pick the winner of a game this week, up to ${s.tokenPoolPicksPerWeek} a week. Each game locks at kickoff.`,
          s.tokenPoolMode === 'streak' ? 'Each correct pick adds a token to your streak. Cash the streak out whenever you like; a wrong pick before you do loses it.' : 'Each correct pick earns a token.',
          wrong,
          s.tokenPoolAutoSettle ? 'Picks settle on their own from the final score.' : 'The commissioner settles the results.',
          s.tokenPoolOpen ? 'It is open right now.' : 'The commissioner has closed it for now; open picks still settle.',
        ])
    }
    case 'survivor_pool': {
      if (!s.survivorPoolEnabled) return es ? block('Pozo Survivor', ['El Pozo Survivor no está activo en esta liga.']) : block('Survivor Pool', ['The Survivor Pool is not running in this league.'])
      const rule = s.survivorPoolRule === 'conference' ? (es ? `de la ${s.survivorPoolConference}` : `from the ${s.survivorPoolConference}`)
        : s.survivorPoolRule === 'away_only' ? (es ? 'que juegue de visitante' : 'playing away')
          : s.survivorPoolRule === 'allowed_list' ? (es ? `de esta lista: ${s.survivorPoolAllowedTeams.join(', ') || 'ninguno'}` : `from this list: ${s.survivorPoolAllowedTeams.join(', ') || 'none'}`)
            : s.survivorPoolRule === 'division' ? (es ? `de la división ${s.survivorPoolDivision}` : `from the ${s.survivorPoolDivision} division`)
              : ''
      const variants = s.survivorPoolWeekRules.length ? (es ? `Hay reglas especiales en la${s.survivorPoolWeekRules.length > 1 ? 's semanas' : ' semana'} ${s.survivorPoolWeekRules.map((w) => w.week).join(', ')}.` : `Special rules apply in week${s.survivorPoolWeekRules.length > 1 ? 's' : ''} ${s.survivorPoolWeekRules.map((w) => w.week).join(', ')}.`) : null
      return es
        ? block('Pozo Survivor', [
          `Desde la semana ${s.survivorPoolStartWeek}, cada náufrago en la isla elige un equipo ganador${rule ? ` ${rule}` : ''} por semana.`,
          variants,
          `Si aciertas, ganas ${prizeText(s.survivorPoolPrize, true)}. Si fallas, quedas fuera del pozo.`,
          `Puedes volver ${s.survivorPoolRevives} ${s.survivorPoolRevives === 1 ? 'vez' : 'veces'} con una resurrección; después quedas fuera para siempre.`,
          ...poolExtraLines(s, true),
          'Se liquida con el marcador final.',
        ])
        : block('Survivor Pool', [
          `From week ${s.survivorPoolStartWeek}, every castaway still on the island picks one winning team${rule ? ` ${rule}` : ''} each week.`,
          variants,
          `Pick right and you win ${prizeText(s.survivorPoolPrize, false)}. Pick wrong and you are out of the pool.`,
          `You can come back ${s.survivorPoolRevives} ${s.survivorPoolRevives === 1 ? 'time' : 'times'} with a revive; after that you are banned from the pool.`,
          ...poolExtraLines(s, false),
          'Picks settle from the final score.',
        ])
    }
    case 'auction': {
      const currency = s.auctionCurrency === 'auction_cash' ? (es ? 'dinero de subasta' : 'auction cash') : 'FAAB'
      return es
        ? block('Semana de Subasta', [
          'El comisionado programa subastas de ventajas y premios, con hora de apertura y cierre.',
          `Se puja con ${currency}${s.auctionCurrency === 'auction_cash' && s.auctionCashPerAuction ? `; cada náufrago recibe $${s.auctionCashPerAuction} al abrir cada subasta` : ''}.`,
          'En una subasta cerrada cada puja es secreta y no se puede cambiar. En una abierta se ve la puja más alta y hay que superarla.',
          'Gana la puja más alta; un empate lo gana la puja anterior. Algunos artículos son misteriosos hasta el cierre.',
          'El premio llega solo al cerrar, y solo se cobra al ganador.',
          'Si el premio no se puede entregar (por ejemplo, saliste de la isla antes del cierre), se te devuelve lo que pagaste automáticamente.',
          s.disadvantagesEnabled.length ? 'Hay desventajas a la venta: si ganas una, eliges al rival que la recibe.' : null,
        ])
        : block('Auction Week', [
          'The commissioner schedules auctions of advantages and prizes, each with an open and a close time.',
          `Bids are in ${currency}${s.auctionCurrency === 'auction_cash' && s.auctionCashPerAuction ? `; every castaway gets $${s.auctionCashPerAuction} when each auction opens` : ''}.`,
          'In a sealed auction every bid is secret and locks once placed. In an open auction the high bid shows and you must beat it.',
          'The highest bid wins; a tie goes to the earlier bid. Some items stay a mystery until the close.',
          'Prizes arrive on their own at the close, and only the winner pays.',
          'If a prize cannot be delivered (say you left the island before the close), what you paid is refunded automatically.',
          s.disadvantagesEnabled.length ? 'Disadvantages are on offer: win one and you choose the opponent it hits.' : null,
        ])
    }
    case 'token_shop': {
      const items = s.tokenShopEnabled ? s.tokenShopItems.filter((i) => i.enabled) : []
      if (!items.length) return es ? block('Tienda de fichas', ['La tienda de fichas está cerrada en esta liga.']) : block('Token shop', ['The token shop is closed in this league.'])
      return es
        ? block('Tienda de fichas', [
          ...items.map((i) => `${i.id.replace(/_/g, ' ')}: ${i.cost} ${i.cost === 1 ? 'ficha' : 'fichas'}`),
          'Comprar gasta fichas que también cuentan para volver del Exilio.',
          'Si compras en el Exilio, el artículo te llega al volver a la isla.',
        ])
        : block('Token shop', [
          ...items.map((i) => `${i.id.replace(/_/g, ' ')}: ${i.cost} ${i.cost === 1 ? 'token' : 'tokens'}`),
          'Buying spends tokens that also count toward a return from Exile.',
          'Buy while on Exile and the item reaches you when you are back on the island.',
        ])
    }
  }
}

/** Extra Exile lines (FAAB on return, lineup slots, team claims, secrecy) for the main Exile answer. */
export function sideGameExileLines(settings: SurvivorSideGameSettings | null | undefined, sport: string, language?: string | null): string[] {
  if (!settings) return []
  const s = settings
  const es = isEs(language)
  const out: string[] = []
  if (s.exileTokenFaabRate > 0) {
    out.push(es
      ? `• Al volver, ${s.exileTokenFaabBasis === 'leftover' ? 'cada ficha por encima del costo de regreso' : 'cada ficha que tengas'} se cambia por $${s.exileTokenFaabRate} de FAAB.`
      : `• On your return, ${s.exileTokenFaabBasis === 'leftover' ? 'each token beyond the return cost' : 'every token you hold'} converts to $${s.exileTokenFaabRate} FAAB.`)
  }
  if (s.exileLineupSlots.length) {
    const slots = s.exileLineupSlots.map((x) => exileSlotLabel(x, sport)).join(' ')
    out.push(es ? `• Tu alineación del Exilio: ${slots}${s.exileBenchSlots ? ` y ${s.exileBenchSlots} de banca` : ''}, todos de un mismo equipo real.` : `• Your Exile lineup: ${slots}${s.exileBenchSlots ? ` plus ${s.exileBenchSlots} bench` : ''}, all from one real team.`)
  }
  if (s.exileClaimMode === 'faab_bid') {
    out.push(es
      ? `• Los equipos del Exilio se ganan con puja cerrada (presupuesto de $${s.exileBidBudget} por semana) hasta el ${s.exileBidCloseDay} ${s.exileBidCloseTime} ET; gana la más alta y un empate lo gana la puja anterior. Luego los equipos libres son por orden de llegada.`
      : `• Exile teams are won by sealed bid ($${s.exileBidBudget} weekly budget) until ${s.exileBidCloseDay} ${s.exileBidCloseTime} ET; the highest bid wins and a tie goes to the earlier bid. Open teams are first-come after that.`)
  }
  if (s.hideExileMembership) out.push(es ? '• Quién está en el Exilio es secreto: solo lo saben los que están ahí.' : '• Who is on Exile is secret: only the people there know.')
  if (s.hideExileMembership && s.exileExposureRule !== 'off') {
    out.push(es
      ? `• Si expones a alguien del Exilio, el comisionado puede ${s.exileExposureRule === 'remove' ? 'sacarte de la temporada' : 'darte un strike de conducta'}.`
      : `• Expose someone on Exile and the commissioner can ${s.exileExposureRule === 'remove' ? 'remove you from the season' : 'give you a conduct strike'}.`)
  }
  return out
}
