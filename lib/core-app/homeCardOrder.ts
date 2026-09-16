/**
 * The /core home's card order, per viewer: time-sensitive sections first, then the ones this viewer
 * actually uses, then the designed order.
 *
 * WHAT MOVES AND WHAT DOES NOT.
 *   - The decision queue always leads and the coverage footnote always closes. Neither is ordered here.
 *   - Cards move only WITHIN their group (the bands above the dashboard, the dashboard's main column,
 *     its side column, the bottom stack). A group is a layout region; letting a side card into the
 *     main column would change the layout, not the priority.
 *   - A card is "time-sensitive" only on a fact the server holds for this render: a slate is live, a
 *     draft is on the clock. Never on a guess about the day of the week.
 *
 * WHY USAGE NEEDS A THRESHOLD. One stray tap should not rearrange someone's home. A card needs
 * `USAGE_MIN_TAPS` recorded taps before usage can lift it, and the counts decay (`recordCardUse`), so
 * a habit that stops fades out rather than pinning a card forever.
 *
 * ⚠ THE ORDER IS DECIDED ONCE PER RENDER, ON THE SERVER, FROM A COOKIE. It never changes while the
 * page is on screen: a card jumping under someone's thumb is worse than a card in a slightly worse
 * place. The counts are per device, which suits them — a phone and a desktop are used differently.
 */

export const CARD_USE_COOKIE = 'af_core_use'
export const USAGE_MIN_TAPS = 3
/** When the total passes this, every count is halved — the decay. */
const USAGE_DECAY_TOTAL = 120
const USAGE_MAX_KEYS = 24

export const HOME_CARD_GROUPS = {
  bands: ['since-last-visit', 'game-day', 'drafts', 'triage', 'trade-band', 'carryover', 'user-os', 'schedule'],
  main: ['routine', 'matchups'],
  side: ['chimmy', 'career', 'rivals'],
  stack: ['exposure', 'following', 'receipts'],
} as const

export type HomeCardGroup = keyof typeof HOME_CARD_GROUPS
export type OrderableCard = (typeof HOME_CARD_GROUPS)[HomeCardGroup][number]
export type HomeCardOrder = { [G in HomeCardGroup]: Array<(typeof HOME_CARD_GROUPS)[G][number]> }

const KNOWN = new Set<string>(Object.values(HOME_CARD_GROUPS).flat())

export type CardUsage = Record<string, number>

export function parseCardUsage(raw: string | null | undefined): CardUsage {
  const usage: CardUsage = {}
  if (!raw) return usage
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return usage
  }
  for (const pair of decoded.split('.').slice(0, USAGE_MAX_KEYS)) {
    const [key, value] = pair.split(':')
    const count = Number(value)
    if (key && KNOWN.has(key) && Number.isInteger(count) && count > 0 && count < 10_000) usage[key] = count
  }
  return usage
}

export function serializeCardUsage(usage: CardUsage): string {
  return Object.entries(usage)
    .filter(([key, count]) => KNOWN.has(key) && Number.isInteger(count) && count > 0)
    .slice(0, USAGE_MAX_KEYS)
    .map(([key, count]) => `${key}:${count}`)
    .join('.')
}

/** One tap on a card. Unknown cards are ignored; the counts decay once their total is large. */
export function recordCardUse(usage: CardUsage, card: string): CardUsage {
  if (!KNOWN.has(card)) return usage
  const next: CardUsage = { ...usage, [card]: (usage[card] ?? 0) + 1 }
  const total = Object.values(next).reduce((sum, n) => sum + n, 0)
  if (total <= USAGE_DECAY_TOTAL) return next
  const decayed: CardUsage = {}
  for (const [key, count] of Object.entries(next)) {
    const half = Math.floor(count / 2)
    if (half > 0) decayed[key] = half
  }
  return decayed
}

export function orderHomeCards(input: {
  usage: CardUsage
  /** Cards with something happening right now — they lead their group, in designed order. */
  timeSensitive: ReadonlySet<string>
}): HomeCardOrder {
  const order = {} as HomeCardOrder
  for (const group of Object.keys(HOME_CARD_GROUPS) as HomeCardGroup[]) {
    const designed = HOME_CARD_GROUPS[group] as readonly string[]
    const ranked = designed
      .map((card, index) => ({
        card,
        index,
        urgent: input.timeSensitive.has(card),
        taps: (input.usage[card] ?? 0) >= USAGE_MIN_TAPS ? (input.usage[card] ?? 0) : 0,
      }))
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.taps - a.taps || a.index - b.index)
      .map((entry) => entry.card)
    ;(order as Record<HomeCardGroup, string[]>)[group] = ranked
  }
  return order
}

/**
 * What is time-sensitive in THIS render. Each flag is a fact the page already read — the activity
 * snapshot's live slate and live drafts — so ordering costs no query.
 */
export function timeSensitiveCards(signals: { gameDayActive: boolean; draftLive: boolean }): Set<string> {
  const cards = new Set<string>()
  if (signals.gameDayActive) {
    cards.add('game-day')
    cards.add('matchups')
  }
  if (signals.draftLive) cards.add('drafts')
  return cards
}
