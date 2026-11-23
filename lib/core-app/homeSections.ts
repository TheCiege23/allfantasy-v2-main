/**
 * The /core home sections a person can switch off from Settings → Home page (2026-10-24).
 *
 * A user loved the app and said the home was "way too much information". Each switch here hides ONE
 * visual on the home. It does NOT touch notifications.
 *
 * 🛑 IT USED TO, AND THAT SILENTLY COST PEOPLE THEIR GAME-DAY ALERTS (reversed 2026-11-22, owner).
 * From 2026-10-24 to 2026-11-22 a hidden section also muted its notification categories at send time —
 * "off means the whole topic goes quiet". In practice people hid cards to declutter the page and lost the
 * alerts behind them without noticing: the owner's own account had hidden Matchups and Live games and
 * received ZERO scoring alerts in seven days, while the Notifications tab showed those categories ON.
 * Two switches for one alert is the trap. Notifications are now decided ONLY in Settings → Notifications;
 * this list is the home's layout and nothing else. Do not add a `categories` link back to it.
 *
 * WHERE IT IS STORED. `UserProfile.notificationPreferences.hiddenHomeSections`, an array of the ids
 * below (kept where it always was, so existing choices still hide the same cards).
 */

export type HomeSectionId =
  | 'streak'
  | 'decisions'
  | 'since-last-visit'
  | 'live-games'
  | 'drafts'
  | 'injuries'
  | 'league-trades'
  | 'lock-brief'
  | 'league-focus'
  | 'commish'
  | 'season-pulse'
  | 'calendar'
  | 'formats'
  | 'schedule'
  | 'trade-evaluator'
  | 'routine'
  | 'matchups'
  | 'chimmy'
  | 'career'
  | 'rivals'
  | 'following'
  | 'insights'

type HomeSectionGroup = 'top' | 'week' | 'side' | 'more'

type HomeSectionDef = {
  id: HomeSectionId
  group: HomeSectionGroup
  /** The `HomeCardName`s (components/core-app/home/HomeCards.tsx) this switch hides. */
  cards: readonly string[]
}

/** In the order the home draws them, so the Settings list reads top to bottom like the page. */
export const HOME_SECTIONS: readonly HomeSectionDef[] = [
  { id: 'streak', group: 'top', cards: ['streak'] },
  { id: 'decisions', group: 'top', cards: ['issues'] },
  { id: 'since-last-visit', group: 'top', cards: ['since-last-visit'] },
  { id: 'live-games', group: 'top', cards: ['game-day'] },
  { id: 'drafts', group: 'top', cards: ['drafts'] },
  { id: 'injuries', group: 'top', cards: ['triage'] },
  {
    id: 'league-trades',
    group: 'top',
    cards: ['trade-band'],
  },
  { id: 'lock-brief', group: 'top', cards: ['carryover'] },
  { id: 'league-focus', group: 'top', cards: ['user-os'] },
  { id: 'schedule', group: 'top', cards: ['schedule'] },
  /*
   * The two guide cards (2026-11-12, owner: the home is "a teaching tool and a notification system").
   * `commish` draws only for someone who runs a league. Drawn after the bands,
   * so they sit after `schedule` here to keep the Settings list in page order.
   */
  { id: 'commish', group: 'top', cards: ['commish'] },
  { id: 'season-pulse', group: 'top', cards: ['season-pulse'] },
  /* The teaching cards (2026-11-12): when waivers run per platform, and what each format means. */
  { id: 'calendar', group: 'top', cards: ['calendar'] },
  { id: 'formats', group: 'top', cards: ['formats'] },
  /* The folded "Evaluate a trade" row (owner, 2026-11-06) — a switch since 2026-11-12; see the defaults. */
  { id: 'trade-evaluator', group: 'top', cards: ['trade-evaluator'] },
  { id: 'routine', group: 'week', cards: ['routine'] },
  { id: 'matchups', group: 'week', cards: ['matchups'] },
  { id: 'chimmy', group: 'side', cards: ['chimmy'] },
  { id: 'career', group: 'side', cards: ['career'] },
  { id: 'rivals', group: 'side', cards: ['rivals'] },
  {
    id: 'following',
    group: 'more',
    cards: ['following'],
  },
  { id: 'insights', group: 'more', cards: ['portfolio-chart', 'exposure', 'receipts'] },
]

export const HOME_SECTION_GROUPS: readonly HomeSectionGroup[] = ['top', 'week', 'side', 'more']

/** The stored key inside `notificationPreferences`. */
export const HIDDEN_HOME_SECTIONS_KEY = 'hiddenHomeSections'

/** The default layout's own key, kept apart from a person's saved choices. Layout only — no section mutes alerts. */
export const HOME_LAYOUT_HIDDEN_KEY = 'homeLayoutHiddenSections'
/*
 * ⚠ THE HOME TRIM, 2026-11-12 (owner's call after a no-league audit of /core). Four more sections
 * start hidden, each because another screen already carries it:
 *   trade-evaluator  the same LeagueTradeEvaluator + market movers the Trades hub opens with
 *   chimmy           the Chimmy button sits on every screen, with the same flagged count
 *   career, rivals   Your career and Your week → Rivalry Radar
 * The daily streak STAYS on (owner, same day): it was proposed for this list and kept, so do not
 * add it back here on the overlap argument. What a default home leads with now: the streak,
 * decisions, injuries, league trades, the league that needs you, and the league list. Every one is a switch in Settings → Home page, and a person who has
 * saved their own layout keeps it — defaults only apply to a profile with no saved list
 * (`resolveHiddenHomeSections`). Hiding is layout only: no section, default or saved, mutes an alert.
 *
 * ⚠ AND `league-focus` JOINED THEM LATER THE SAME DAY (owner, the "simplify /core" pass). Its card,
 * "Your team · <one league>", showed one league picked out of many with no reason given, and its
 * figures (waiver claims, an activity trend) did not answer "am I winning". The season pulse card
 * (`season-pulse`) answers that for every league at once. The streak still stays on — it now
 * renders as a pill inside the home's headline rather than a strip of its own.
 */
export const DEFAULT_HIDDEN_HOME_SECTIONS: readonly HomeSectionId[] = [
  'since-last-visit', 'live-games', 'drafts', 'lock-brief', 'league-focus', 'schedule', 'trade-evaluator',
  'routine', 'matchups', 'chimmy', 'career', 'rivals', 'insights',
]

/** An explicit empty list means show everything; existing personalized layouts take precedence. */
export function resolveHiddenHomeSections(saved: unknown): Set<HomeSectionId> {
  const prefs = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {}
  for (const key of [HOME_LAYOUT_HIDDEN_KEY, HIDDEN_HOME_SECTIONS_KEY]) {
    if (Array.isArray(prefs[key])) return readHiddenHomeSections({ [HIDDEN_HOME_SECTIONS_KEY]: prefs[key] })
  }
  return new Set(DEFAULT_HIDDEN_HOME_SECTIONS)
}

const KNOWN = new Set<string>(HOME_SECTIONS.map((s) => s.id))

/**
 * The hidden section ids from a stored `notificationPreferences` value. Unknown ids are dropped, so a
 * section renamed or removed later can never hide something it no longer names.
 */
export function readHiddenHomeSections(saved: unknown): Set<HomeSectionId> {
  const out = new Set<HomeSectionId>()
  if (!saved || typeof saved !== 'object') return out
  const raw = (saved as Record<string, unknown>)[HIDDEN_HOME_SECTIONS_KEY]
  if (!Array.isArray(raw)) return out
  for (const id of raw) if (typeof id === 'string' && KNOWN.has(id)) out.add(id as HomeSectionId)
  return out
}

/** Every home card hidden by those sections. */
export function hiddenHomeCards(hidden: ReadonlySet<HomeSectionId>): Set<string> {
  const cards = new Set<string>()
  for (const section of HOME_SECTIONS) if (hidden.has(section.id)) for (const c of section.cards) cards.add(c)
  return cards
}

/** The next stored list after one switch flips. Kept in `HOME_SECTIONS` order so saves are stable. */
export function toggleHomeSection(
  hidden: ReadonlySet<HomeSectionId>,
  id: HomeSectionId,
  visible: boolean,
): HomeSectionId[] {
  const next = new Set(hidden)
  if (visible) next.delete(id)
  else next.add(id)
  return HOME_SECTIONS.map((s) => s.id).filter((s) => next.has(s))
}
