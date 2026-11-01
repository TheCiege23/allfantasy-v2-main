/**
 * The Survivor CHALLENGE BUILDER — the pure half (no I/O; safe on the client). The DB half is
 * `survivorChallengeBuilder.ts`.
 *
 * The owner's original league ran its weekly prop challenges by hand: "tribes guess the game total,
 * closest wins $50 FAAB per player, no two tribes may pick the same total", "anytime TD → 20 pts",
 * "More or Less: hit +50 / miss −20", "the prize is 50 pts next week", the finale's "closest to the
 * score without going over". This module lets a commissioner author exactly those:
 *
 *  - a KIND (what is asked and how it is scored — `CHALLENGE_BUILDER_KINDS`);
 *  - a SCOPE: each manager answers for themself, or ONE answer per tribe (the first submission
 *    stands, "no take backs");
 *  - OPEN and LOCK times, entered as US Eastern wall time and stored as UTC instants;
 *  - a PRIZE TABLE: per place, any number of rewards built from the reward API's types
 *    (`survivorRewardModel.ts`), plus an optional deferral ("pays next week");
 *  - an optional MISS PENALTY (choice kinds), an optional WAGER (stake points or FAAB, win or lose),
 *    "no two entrants may give the same answer", and a SEALED reveal (answers stay hidden until the
 *    result, not just until the lock).
 *
 * SETTLEMENT. Kinds tied to a stored game or a stored player week settle themselves from OUR DB
 * (`SportsGame` finals, `PlayerWeeklyScore`), never a provider. Every kind can also be settled by
 * hand (the commissioner enters the true answer, or names the winners) with a preview-then-confirm
 * step. Payouts are planned here (`planChallengePayouts`) with stable idempotency keys, so the
 * reward API can never pay one twice; a reversal bumps the settlement ROUND, so a re-settle after an
 * undo pays under fresh keys.
 */

import { settleClosestWithoutGoingOver, type ClosestAllOverRule } from './survivorClosestWithoutGoingOver'
import {
  SURVIVOR_REWARD_ADVANTAGE_POWERS,
  SURVIVOR_REWARD_LIMITS,
  type SurvivorRewardAdvantagePower,
  type SurvivorRewardSpec,
} from './survivorRewardModel'

export const CHALLENGE_BUILDER_TYPE = 'commissioner_challenge'
/** The challengeNumber range builder challenges use (1–5 belong to the system-run challenges). */
export const CHALLENGE_BUILDER_FIRST_NUMBER = 10
export const CHALLENGE_BUILDER_MAX_PER_WEEK = 12

export const CHALLENGE_BUILDER_KINDS = [
  'game_total_closest',
  'closest_without_going_over',
  'pick_winner',
  'game_total_over_under',
  'player_stat_over_under',
  'anytime_td',
  'custom_choice',
  'custom_number',
  // From the original league (added later). Settlement per kind — see `challengeSettlementSource`:
  // first TD scorer and last score type are settled by the commissioner (we store final scores, not
  // play-by-play); position leaders settle from PlayerWeeklyScore; a sweep is settled by hand; a
  // puzzle settles itself by exact match or is settled by hand.
  'first_td_scorer',
  'last_score_type',
  'position_leader',
  'sweep',
  'puzzle',
] as const
export type ChallengeBuilderKind = (typeof CHALLENGE_BUILDER_KINDS)[number]

export type ChallengeBuilderScope = 'individual' | 'tribe'
export type ChallengeBuilderStatus = 'scheduled' | 'open' | 'locked' | 'settling' | 'complete' | 'cancelled'
export type ChallengeInputKind = 'number' | 'choice' | 'text' | 'sweep'

/**
 * Number kinds rank answers by distance; choice kinds have right and wrong answers; a puzzle takes a
 * typed answer; a sweep takes one pick per prop.
 */
export function challengeInputKind(kind: ChallengeBuilderKind): ChallengeInputKind {
  if (kind === 'puzzle') return 'text'
  if (kind === 'sweep') return 'sweep'
  return kind === 'game_total_closest' || kind === 'closest_without_going_over' || kind === 'custom_number' ? 'number' : 'choice'
}

/** Kinds that are always settled by the commissioner: nothing we store answers them. */
const MANUAL_KINDS: ReadonlySet<string> = new Set(['custom_choice', 'custom_number', 'first_td_scorer', 'last_score_type', 'sweep'])

/** Where the true answer can come from without a person (kind-level; see `challengeSettlementSource`). */
export function challengeAutoSource(kind: ChallengeBuilderKind, hasGame: boolean): 'game' | 'player_stat' | 'manual' {
  if (kind === 'player_stat_over_under' || kind === 'anytime_td' || kind === 'position_leader') return 'player_stat'
  if (MANUAL_KINDS.has(kind) || kind === 'puzzle') return 'manual'
  return hasGame ? 'game' : 'manual'
}

export type ChallengeSettlementSource = 'game' | 'player_stat' | 'position_leader' | 'exact_answer' | 'manual'

/**
 * How THIS challenge settles: from a stored game final, a stored player week, the stored weekly
 * fantasy points at a position, an exact match against the commissioner's puzzle answer — or by the
 * commissioner. Sport-aware: a player prop whose stat we do not store for that sport is manual.
 */
export function challengeSettlementSource(config: Pick<ChallengeBuilderConfig, 'kind' | 'game' | 'player'> & Partial<Pick<ChallengeBuilderConfig, 'puzzle'>>): ChallengeSettlementSource {
  const kind = config.kind
  if (MANUAL_KINDS.has(kind)) return 'manual'
  if (kind === 'puzzle') return config.puzzle?.settle === 'exact' ? 'exact_answer' : 'manual'
  if (kind === 'position_leader') return 'position_leader'
  if (kind === 'anytime_td') return config.player && anytimeStatSupported(config.player.sport) ? 'player_stat' : 'manual'
  if (kind === 'player_stat_over_under') return config.player && playerStatSupported(config.player.sport, config.player.stat) ? 'player_stat' : 'manual'
  return config.game ? 'game' : 'manual'
}

/** Kinds that need a stored game (closest without going over may instead take a typed target). */
export function challengeNeedsGame(kind: ChallengeBuilderKind): boolean {
  return kind === 'game_total_closest' || kind === 'pick_winner' || kind === 'game_total_over_under'
}

/**
 * Player stats we can settle from `PlayerWeeklyScore.stats` (normalized NFL keys) or its
 * `fantasyPts`. Anytime TD reads rush_td + rec_td + fumble_td and is NFL-only: other sports do not
 * store a touchdown, so they get a manual settle instead.
 */
export const CHALLENGE_PLAYER_STATS = ['fantasy_points', 'pass_yds', 'rush_yds', 'rec_yds', 'rec', 'pass_td', 'total_td'] as const
/** A stat key: one of `CHALLENGE_PLAYER_STATS`, or one of the sport's own (`CHALLENGE_SPORT_STATS`). */
export type ChallengePlayerStat = string
export const NFL_ONLY_PLAYER_STATS: readonly ChallengePlayerStat[] = ['pass_yds', 'rush_yds', 'rec_yds', 'rec', 'pass_td', 'total_td']

/**
 * The per-player stats each sport STORES in `PlayerWeeklyScore.stats`, read from the ingestion code
 * (no provider was called to decide this — lib/redraft/playerWeeklyScoreService.ts writes them):
 *  - NFL: `normalizeNflWeeklyStats` keys (lib/scoring-runtime/nflStatNormalization.ts).
 *  - NCAAF: the CFBD aggregate (ncaafStatNormalization.ts: pass_yds, rush_td, rec, kr_td…).
 *  - NBA / NCAAB / NHL / MLB / SOCCER: the daily-sport aggregates (dailySportStatNormalization.ts,
 *    mlbStatNormalization.ts, soccerStatNormalization.ts), stored under the scoring config's keys.
 * A stat listed here settles itself; any other stat on that sport is settled by the commissioner.
 * `fantasy_points` (the row's `fantasyPts`) settles for every sport.
 */
export const CHALLENGE_SPORT_STATS: Readonly<Record<string, readonly string[]>> = {
  NFL: ['pass_yds', 'rush_yds', 'rec_yds', 'rec', 'pass_td', 'total_td'],
  NCAAF: ['pass_yds', 'rush_yds', 'rec_yds', 'rec', 'pass_td', 'total_td'],
  NBA: ['pts', 'reb', 'ast', 'threes', 'stl', 'blk'],
  NCAAB: ['pts', 'reb', 'ast', 'threes', 'stl', 'blk'],
  NHL: ['g', 'a', 'sog', 'ppp', 'blks', 'hits', 'g_sv'],
  MLB: ['h', 'hr', 'rbi', 'r', 'sb', 'so'],
  SOCCER: ['goals', 'assists', 'shots_on_target', 'saves'],
}

/**
 * "Anytime" scorer per sport, from the stored keys: a touchdown (NFL rush/rec/fumble TD; NCAAF
 * rush/rec/return TD), a goal (NHL, soccer), a home run (MLB). NBA and NCAAB store no such event:
 * an anytime prop there is settled by the commissioner.
 */
export const CHALLENGE_ANYTIME_KEYS: Readonly<Record<string, readonly string[]>> = {
  NFL: ['rush_td', 'rec_td', 'fumble_td'],
  NCAAF: ['rush_td', 'rec_td', 'kr_td', 'pr_td'],
  NHL: ['g'],
  SOCCER: ['goals'],
  MLB: ['hr'],
}

/** Our sport key for a stored sport spelling (`NCAAFB` → `NCAAF`, `NCAABB` → `NCAAB`). */
export function challengeSportKey(sport: string | null | undefined): string {
  const s = String(sport ?? '').trim().toUpperCase()
  if (s === 'NCAAFB') return 'NCAAF'
  if (s === 'NCAABB') return 'NCAAB'
  return s
}

/** The stats a commissioner can pick for a player in this sport (fantasy points first). */
export function challengeStatsForSport(sport: string | null | undefined): string[] {
  return ['fantasy_points', ...(CHALLENGE_SPORT_STATS[challengeSportKey(sport)] ?? [])]
}

/** True when that stat is stored for that sport, so the challenge settles itself. */
export function playerStatSupported(sport: string | null | undefined, stat: string): boolean {
  return stat === 'fantasy_points' || (CHALLENGE_SPORT_STATS[challengeSportKey(sport)] ?? []).includes(stat)
}

export function anytimeStatSupported(sport: string | null | undefined): boolean {
  return Boolean(CHALLENGE_ANYTIME_KEYS[challengeSportKey(sport)])
}

/** Every stat a player prop may name: the legacy list plus every sport's own. */
const ALL_PLAYER_STATS: ReadonlySet<string> = new Set([...CHALLENGE_PLAYER_STATS, ...Object.values(CHALLENGE_SPORT_STATS).flat()])

export type ChallengeOption = { id: string; label: string; /** Position leaders: the player this option is. */ playerId?: string }

/** One prop of a sweep: its own question and options. */
export type ChallengeSweepProp = { id: string; question: string; options: ChallengeOption[] }

/** A puzzle: the commissioner's answer (never shown to managers before the result). */
export type ChallengePuzzle = { answer: string; mode: 'first_correct' | 'fastest'; settle: 'exact' | 'manual' }

/** Position leaders: who scores the most fantasy points at `position` in that sport week. */
export type ChallengePositionRef = { sport: string; season: number; statWeek: number; position: string }

export const LAST_SCORE_TYPES = ['touchdown', 'field_goal', 'safety'] as const

export type ChallengeGameRef = {
  sport: string
  homeAbbr: string
  awayAbbr: string
  homeLabel: string
  awayLabel: string
  /** ISO; the earliest start any stored row reports. */
  kickoff: string
}

export type ChallengePlayerRef = {
  playerId: string
  playerName: string
  sport: string
  season: number
  /** The sport week whose stored stats settle it. */
  statWeek: number
  stat: ChallengePlayerStat
}

/** A prize line, before a recipient is known. Ids are filled in by `planChallengePayouts`. */
export type ChallengePrizeReward =
  | { type: 'score_bonus'; points: number }
  | { type: 'faab_grant'; amount: number }
  | { type: 'faab_transfer'; amount: number; basis: 'per_member' | 'total' }
  | { type: 'tribemate_points'; points: number }
  | { type: 'free_trade_token'; samePositionOnly: boolean }
  | { type: 'steal_blocker' }
  | { type: 'steal'; what: 'faab' | 'points'; amount: number }
  | { type: 'advantage'; powerType: SurvivorRewardAdvantagePower }
  /** Individual immunity for the week (the finale's "closest without going over"). */
  | { type: 'immunity' }

export type ChallengePenalty = { type: 'score_penalty'; points: number } | { type: 'faab_penalty'; amount: number }

export const CHALLENGE_PRIZE_TYPES = ['score_bonus', 'faab_grant', 'faab_transfer', 'tribemate_points', 'free_trade_token', 'steal_blocker', 'steal', 'advantage', 'immunity'] as const
export type ChallengePrizeType = (typeof CHALLENGE_PRIZE_TYPES)[number]

export type ChallengePrizePlace = { place: number; rewards: ChallengePrizeReward[] }

export type ChallengeWager = {
  currency: 'points' | 'faab'
  min: number
  max: number
  /** A correct answer pays stake × this (the original PPP paid 1.5×). */
  winMultiplier: number
  /** A wrong answer loses stake × this (PPP returned half: 0.5). */
  lossFraction: number
}

export type ChallengeBuilderConfig = {
  builder: 1
  kind: ChallengeBuilderKind
  scope: ChallengeBuilderScope
  question: string
  options: ChallengeOption[]
  game: ChallengeGameRef | null
  player: ChallengePlayerRef | null
  /** O/U line. */
  line: number | null
  prizes: ChallengePrizePlace[]
  /** 0 = pays the week it is won; N = pays N weeks later. */
  deferWeeks: number
  missPenalty: ChallengePenalty | null
  wager: ChallengeWager | null
  uniqueAnswers: boolean
  sealed: boolean
  allOverRule: ClosestAllOverRule
  opensAt: string
  locksAt: string
  /** Sweep: the props (all must hit). */
  props?: ChallengeSweepProp[]
  /** Sweep: place 2 pays one miss, place 3 two misses… (off: only a perfect card pays). */
  sweepTiered?: boolean
  puzzle?: ChallengePuzzle | null
  position?: ChallengePositionRef | null
}

export const CHALLENGE_BUILDER_LIMITS = {
  title: 120,
  question: 1000,
  options: 8,
  optionLabel: 80,
  places: 5,
  rewardsPerPlace: 4,
  deferWeeks: 4,
  wagerMax: { points: 200, faab: 200 },
  number: 100000,
  props: 8,
  textAnswer: 200,
} as const

export const DEFAULT_CHALLENGE_FAAB_WEEKLY_CAP = 40
export const CHALLENGE_FAAB_WEEKLY_CAP_RANGE = [1, 1000] as const
export const SURVIVOR_CHALLENGE_FAAB_CAP_KEY = 'survivorChallengeFaabWeeklyCap'

/** The commissioner's weekly cap on challenge FAAB per winner (`League.settings`). $40 by default. */
export function readChallengeFaabWeeklyCap(leagueSettings: unknown): number {
  const root = leagueSettings && typeof leagueSettings === 'object' && !Array.isArray(leagueSettings) ? (leagueSettings as Record<string, unknown>) : {}
  const v = root[SURVIVOR_CHALLENGE_FAAB_CAP_KEY]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < CHALLENGE_FAAB_WEEKLY_CAP_RANGE[0] || v > CHALLENGE_FAAB_WEEKLY_CAP_RANGE[1]) return DEFAULT_CHALLENGE_FAAB_WEEKLY_CAP
  return v
}

// ── Errors, in both languages ─────────────────────────────────────────────────────────────────────

export type ChallengeLang = 'en' | 'es'
export const challengeLang = (language: string | null | undefined): ChallengeLang => (String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en')

const ERRORS = {
  title: ['Give the challenge a title (up to 120 characters).', 'Ponle un título al reto (hasta 120 caracteres).'],
  question: ['Write the question or instructions (up to 1000 characters).', 'Escribe la pregunta o las instrucciones (hasta 1000 caracteres).'],
  kind: ['Choose a challenge type.', 'Elige un tipo de reto.'],
  scope: ['Choose individual or tribe.', 'Elige individual o por tribu.'],
  tribeAfterMerge: ['Tribe challenges are for before the merge.', 'Los retos por tribu son para antes de la fusión.'],
  week: ['Choose a week from this week on.', 'Elige una semana a partir de la actual.'],
  times: ['Set open and lock times; the lock must come after the open.', 'Fija la apertura y el cierre; el cierre debe ser después de la apertura.'],
  lockPast: ['The lock time has already passed.', 'La hora de cierre ya pasó.'],
  game: ['Pick a game from the schedule.', 'Elige un partido del calendario.'],
  gameLock: ['The lock must be no later than the game’s start.', 'El cierre no puede ser después del inicio del partido.'],
  player: ['Pick a player and a stat.', 'Elige un jugador y una estadística.'],
  statSport: ['That stat is only stored for NFL players; use fantasy points or a manual challenge.', 'Esa estadística solo se guarda para jugadores de NFL; usa puntos de fantasía o un reto manual.'],
  tdSport: ['Anytime TD is only stored for the NFL; use a custom question and settle it by hand.', 'El touchdown en cualquier momento solo se guarda para la NFL; usa una pregunta propia y resuélvela a mano.'],
  line: ['Set the line (a number, e.g. 44.5).', 'Fija la línea (un número, p. ej. 44.5).'],
  options: ['Give 2 to 8 distinct answer options.', 'Da de 2 a 8 opciones de respuesta distintas.'],
  prizes: ['Add at least one prize; places must be 1 to 5, each with 1 to 4 rewards.', 'Añade al menos un premio; los puestos van del 1 al 5, cada uno con 1 a 4 recompensas.'],
  choicePlaces: ['A right-or-wrong question has one prize place: everyone who is right.', 'Una pregunta de acierto o fallo tiene un solo puesto: todos los que aciertan.'],
  reward: ['One of the prizes is not valid.', 'Uno de los premios no es válido.'],
  transferScope: ['FAAB taken from another tribe needs a tribe challenge.', 'Quitar FAAB a otra tribu requiere un reto por tribu.'],
  immunityScope: ['Immunity is an individual prize.', 'La inmunidad es un premio individual.'],
  immunityDefer: ['Immunity cannot be deferred to a later week.', 'La inmunidad no se puede aplazar a otra semana.'],
  defer: ['Defer a prize by 0 to 4 weeks.', 'Aplaza un premio de 0 a 4 semanas.'],
  penalty: ['A miss penalty is points or FAAB taken, and only for right-or-wrong questions.', 'La penalización por fallo es en puntos o FAAB, y solo para preguntas de acierto o fallo.'],
  wager: ['A wager needs a currency, a minimum and maximum stake (up to 200), and sensible multipliers.', 'Una apuesta necesita moneda, apuesta mínima y máxima (hasta 200) y multiplicadores razonables.'],
  wagerKind: ['Wagers are for right-or-wrong questions.', 'Las apuestas son para preguntas de acierto o fallo.'],
  faabCap: (cap: number) => [`Challenge FAAB is capped at $${cap} per winner per week (league setting).`, `El FAAB de los retos tiene un tope de $${cap} por ganador y semana (ajuste de la liga).`],
  locked: ['This challenge can no longer be changed.', 'Este reto ya no se puede cambiar.'],
  sweep: ['A sweep needs 2 to 8 props, each with a question and 2 to 8 distinct options.', 'Un pleno necesita de 2 a 8 apuestas, cada una con su pregunta y de 2 a 8 opciones distintas.'],
  sweepPlaces: ['A sweep pays place 1 for a perfect card; with tiers on, place 2 is one miss, place 3 two misses, and so on.', 'Un pleno paga el puesto 1 por acertarlo todo; con niveles, el puesto 2 es un fallo, el 3 dos fallos, y así.'],
  puzzle: ['A puzzle needs its answer (up to 200 characters) and how it is won.', 'Un acertijo necesita su respuesta (hasta 200 caracteres) y cómo se gana.'],
  puzzlePlaces: ['“First correct” pays one place; “fastest” pays up to 5 places in the order they were solved.', '«El primero en acertar» paga un puesto; «el más rápido» paga hasta 5 puestos en el orden en que se resolvió.'],
  position: ['Pick a position, a stat week and 2 to 8 players at it.', 'Elige una posición, una semana de estadísticas y de 2 a 8 jugadores de esa posición.'],
  phaseType: ['That prize is not allowed in this phase of the season.', 'Ese premio no está permitido en esta fase de la temporada.'],
  phaseRules: ['Prize rules per phase: tribe FAAB transfers are pre-merge only, and each phase must name known prize types.', 'Reglas de premios por fase: las transferencias de FAAB entre tribus son solo antes de la fusión, y cada fase debe usar tipos de premio conocidos.'],
  answered: ['Answers are in: only the title, question, prizes and a later lock time can change now.', 'Ya hay respuestas: ahora solo se pueden cambiar el título, la pregunta, los premios y retrasar el cierre.'],
} as const

export type ChallengeErrorCode = keyof typeof ERRORS
export type ChallengeError = { code: ChallengeErrorCode; message: string }

export function challengeError(code: ChallengeErrorCode, lang: ChallengeLang, arg?: number): ChallengeError {
  const entry = ERRORS[code]
  const pair = typeof entry === 'function' ? entry(arg ?? 0) : entry
  return { code, message: lang === 'es' ? pair[1] : pair[0] }
}

// ── Prize types per phase ─────────────────────────────────────────────────────────────────────────

/**
 * Which prize types a challenge (or the Hub's "grant a reward") may hand out in each phase of the
 * season. The commissioner can narrow each phase (`League.settings.survivorPrizePhaseRules`).
 *
 * Two rules are STRUCTURAL and hold whatever the commissioner picks (they were implicit before):
 *  - tribe-scope prizes only before the merge — a tribe challenge, and so "FAAB from the other
 *    tribes" (`faab_transfer`), exists only while tribes do;
 *  - immunity is only ever an individual prize.
 * The defaults are exactly today's behaviour: every type before the merge; every type but the
 * tribe FAAB transfer after it and at the finale. Penalties (points or FAAB taken) are not prizes
 * and are never restricted.
 */
export const SURVIVOR_PRIZE_PHASES = ['pre_merge', 'post_merge', 'finale'] as const
export type SurvivorPrizePhase = (typeof SURVIVOR_PRIZE_PHASES)[number]
export type SurvivorPrizePhaseRules = Record<SurvivorPrizePhase, ChallengePrizeType[]>
export const SURVIVOR_PRIZE_PHASE_RULES_KEY = 'survivorPrizePhaseRules'

/** Prize types that need tribe scope (so only exist before the merge). */
export const TRIBE_ONLY_PRIZE_TYPES: readonly ChallengePrizeType[] = ['faab_transfer']
/** Prize types that need individual scope. */
export const INDIVIDUAL_ONLY_PRIZE_TYPES: readonly ChallengePrizeType[] = ['immunity']

export function defaultPrizePhaseRules(): SurvivorPrizePhaseRules {
  const all = [...CHALLENGE_PRIZE_TYPES]
  const merged = all.filter((t) => !TRIBE_ONLY_PRIZE_TYPES.includes(t))
  return { pre_merge: all, post_merge: merged, finale: [...merged] }
}

/** Survivor phase → prize phase. Unknown phases follow the merge flag. */
export function prizePhaseOf(phase: string | null | undefined, merged: boolean): SurvivorPrizePhase {
  if (phase === 'finale') return 'finale'
  if (phase === 'pre_merge' || phase === 'post_swap') return merged ? 'post_merge' : 'pre_merge'
  return merged || (phase != null && phase !== '') ? 'post_merge' : 'pre_merge'
}

/** The league's rules; junk, missing or structurally impossible entries read as the defaults. */
export function readPrizePhaseRules(leagueSettings: unknown): SurvivorPrizePhaseRules {
  const root = leagueSettings && typeof leagueSettings === 'object' && !Array.isArray(leagueSettings) ? (leagueSettings as Record<string, unknown>) : {}
  const checked = validatePrizePhaseRules(root[SURVIVOR_PRIZE_PHASE_RULES_KEY], 'en')
  return checked.ok ? checked.rules : defaultPrizePhaseRules()
}

/** Validate a commissioner's per-phase rules (an object of type lists). Missing phases = defaults. */
export function validatePrizePhaseRules(raw: unknown, lang: ChallengeLang): { ok: true; rules: SurvivorPrizePhaseRules } | { ok: false; error: ChallengeError } {
  const defaults = defaultPrizePhaseRules()
  if (raw == null) return { ok: true, rules: defaults }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: challengeError('phaseRules', lang) }
  const r = raw as Record<string, unknown>
  const out = { ...defaults }
  for (const phase of SURVIVOR_PRIZE_PHASES) {
    if (r[phase] == null) continue
    const list = r[phase]
    if (!Array.isArray(list) || list.some((t) => !(CHALLENGE_PRIZE_TYPES as readonly unknown[]).includes(t))) return { ok: false, error: challengeError('phaseRules', lang) }
    const types = CHALLENGE_PRIZE_TYPES.filter((t) => (list as unknown[]).includes(t))
    if (phase !== 'pre_merge' && types.some((t) => TRIBE_ONLY_PRIZE_TYPES.includes(t))) return { ok: false, error: challengeError('phaseRules', lang) }
    out[phase] = types
  }
  return { ok: true, rules: out }
}

const PRIZE_TYPE_LABEL: Record<ChallengeLang, Record<ChallengePrizeType, string>> = {
  en: { score_bonus: 'points', faab_grant: 'FAAB', faab_transfer: 'FAAB from the other tribes', tribemate_points: 'points on a tribemate', free_trade_token: 'a free trade', steal_blocker: 'a steal blocker', steal: 'a steal', advantage: 'an advantage', immunity: 'immunity' },
  es: { score_bonus: 'puntos', faab_grant: 'FAAB', faab_transfer: 'FAAB de las otras tribus', tribemate_points: 'puntos para un compañero', free_trade_token: 'un intercambio libre', steal_blocker: 'un bloqueador de robos', steal: 'un robo', advantage: 'una ventaja', immunity: 'inmunidad' },
}
const PRIZE_PHASE_LABEL: Record<ChallengeLang, Record<SurvivorPrizePhase, string>> = {
  en: { pre_merge: 'before the merge', post_merge: 'after the merge', finale: 'at the finale' },
  es: { pre_merge: 'antes de la fusión', post_merge: 'después de la fusión', finale: 'en la final' },
}

export function prizePhaseLabel(phase: SurvivorPrizePhase, lang: ChallengeLang): string {
  return PRIZE_PHASE_LABEL[lang][phase]
}

/** Null when that prize type may be handed out in that phase; otherwise a clear EN/ES refusal. */
export function prizePhaseError(type: ChallengePrizeType, phase: SurvivorPrizePhase, rules: SurvivorPrizePhaseRules, lang: ChallengeLang): ChallengeError | null {
  if (rules[phase].includes(type) && !(phase !== 'pre_merge' && TRIBE_ONLY_PRIZE_TYPES.includes(type))) return null
  const what = PRIZE_TYPE_LABEL[lang][type]
  const when = PRIZE_PHASE_LABEL[lang][phase]
  return {
    code: 'phaseType',
    message: lang === 'es'
      ? `${what.charAt(0).toUpperCase()}${what.slice(1)} no se puede dar como premio ${when} (reglas de premios de la liga).`
      : `${what.charAt(0).toUpperCase()}${what.slice(1)} cannot be given as a prize ${when} (league prize rules).`,
  }
}

/** The prize type a reward-API spec is, or null for a penalty (never restricted). */
export function prizeTypeOfRewardSpecType(type: string): ChallengePrizeType | null {
  return (CHALLENGE_PRIZE_TYPES as readonly string[]).includes(type) ? (type as ChallengePrizeType) : null
}

// ── Eastern wall time ─────────────────────────────────────────────────────────────────────────────

const EASTERN = 'America/New_York'

function easternOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60000)
}

/** `YYYY-MM-DDTHH:mm` in US Eastern → the UTC instant. Null when the text is not a wall time. */
export function easternWallTimeToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local ?? '').trim())
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // Two passes settle the DST edge: the offset at the guess, then at the corrected instant.
  let at = guess - easternOffsetMinutes(new Date(guess)) * 60000
  at = guess - easternOffsetMinutes(new Date(at)) * 60000
  return new Date(at)
}

/** A UTC instant → `YYYY-MM-DDTHH:mm` in US Eastern (the builder form's value). */
export function utcToEasternWallTime(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const at = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const local = new Date(at.getTime() + easternOffsetMinutes(at) * 60000)
  return local.toISOString().slice(0, 16)
}

// ── Validation ────────────────────────────────────────────────────────────────────────────────────

export type ChallengeDraftInput = {
  title?: unknown
  question?: unknown
  kind?: unknown
  scope?: unknown
  week?: unknown
  /** Eastern wall time `YYYY-MM-DDTHH:mm`, or an ISO instant. */
  opensAt?: unknown
  locksAt?: unknown
  options?: unknown
  game?: unknown
  player?: unknown
  line?: unknown
  prizes?: unknown
  deferWeeks?: unknown
  missPenalty?: unknown
  wager?: unknown
  uniqueAnswers?: unknown
  sealed?: unknown
  allOverRule?: unknown
  /** Sweep: `[{ question, options: [label…] }]`. */
  props?: unknown
  sweepTiered?: unknown
  /** Puzzle: `{ answer, mode, settle }`. */
  puzzle?: unknown
  /** Position leaders: `{ sport, season, statWeek, position }`; the options carry `playerId`s. */
  position?: unknown
}

export type ChallengeDraftContext = {
  now: Date
  currentWeek: number
  merged: boolean
  lang: ChallengeLang
  faabWeeklyCap: number
  /** FAAB per winner already promised by other challenges this week. */
  otherFaabThisWeek: number
  /** The season phase the prize is handed out in (default: from `merged`). */
  prizePhase?: SurvivorPrizePhase
  /** The commissioner's per-phase prize rules (default: today's rules). */
  prizePhaseRules?: SurvivorPrizePhaseRules
}

export type ValidChallengeDraft = { title: string; week: number; config: ChallengeBuilderConfig; faabPerWinner: number }

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const twoDp = (n: number) => Math.round(n * 100) === n * 100
const isPts = (v: unknown): v is number => isNum(v) && v > 0 && v <= SURVIVOR_REWARD_LIMITS.points && twoDp(v)
const isDollars = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0 && v <= SURVIVOR_REWARD_LIMITS.faab

function readInstant(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const wall = easternWallTimeToUtc(s)
  if (wall) return wall
  const d = new Date(s)
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(d.getTime()) ? d : null
}

function readPrizeReward(v: unknown): ChallengePrizeReward | null {
  const r = rec(v)
  switch (r.type) {
    case 'score_bonus': return isPts(r.points) ? { type: 'score_bonus', points: r.points } : null
    case 'tribemate_points': return isPts(r.points) ? { type: 'tribemate_points', points: r.points } : null
    case 'faab_grant': return isDollars(r.amount) ? { type: 'faab_grant', amount: r.amount } : null
    case 'faab_transfer': return isDollars(r.amount) ? { type: 'faab_transfer', amount: r.amount, basis: r.basis === 'total' ? 'total' : 'per_member' } : null
    case 'free_trade_token': return { type: 'free_trade_token', samePositionOnly: r.samePositionOnly !== false }
    case 'steal_blocker': return { type: 'steal_blocker' }
    case 'steal':
      if (r.what !== 'faab' && r.what !== 'points') return null
      return (r.what === 'faab' ? isDollars(r.amount) : isPts(r.amount)) ? { type: 'steal', what: r.what, amount: r.amount as number } : null
    case 'advantage':
      return (SURVIVOR_REWARD_ADVANTAGE_POWERS as readonly string[]).includes(String(r.powerType)) ? { type: 'advantage', powerType: r.powerType as SurvivorRewardAdvantagePower } : null
    case 'immunity': return { type: 'immunity' }
    default: return null
  }
}

function readPenalty(v: unknown): ChallengePenalty | null | 'invalid' {
  if (v == null || v === false) return null
  const r = rec(v)
  if (r.type === 'score_penalty') return isPts(r.points) ? { type: 'score_penalty', points: r.points } : 'invalid'
  if (r.type === 'faab_penalty') return isDollars(r.amount) ? { type: 'faab_penalty', amount: r.amount } : 'invalid'
  return 'invalid'
}

function readWager(v: unknown): ChallengeWager | null | 'invalid' {
  if (v == null || v === false) return null
  const r = rec(v)
  if (r.currency !== 'points' && r.currency !== 'faab') return 'invalid'
  const cap = CHALLENGE_BUILDER_LIMITS.wagerMax[r.currency]
  const min = r.min, max = r.max
  const whole = r.currency === 'faab'
  const ok = (n: unknown) => isNum(n) && n > 0 && n <= cap && (whole ? Number.isInteger(n) : twoDp(n))
  if (!ok(min) || !ok(max) || (min as number) > (max as number)) return 'invalid'
  const win = r.winMultiplier == null ? 1 : r.winMultiplier
  const loss = r.lossFraction == null ? 1 : r.lossFraction
  if (!isNum(win) || win <= 0 || win > 3 || !isNum(loss) || loss < 0 || loss > 1) return 'invalid'
  return { currency: r.currency, min: min as number, max: max as number, winMultiplier: win, lossFraction: loss }
}

function readOptions(v: unknown, withPlayers = false): ChallengeOption[] | null {
  if (!Array.isArray(v)) return null
  const out: ChallengeOption[] = []
  for (const [i, raw] of v.entries()) {
    const label = typeof raw === 'string' ? raw.trim() : str(rec(raw).label)
    if (!label || label.length > CHALLENGE_BUILDER_LIMITS.optionLabel) return null
    if (withPlayers) {
      const playerId = str(rec(raw).playerId)
      if (!playerId || playerId.length > 128) return null
      out.push({ id: `o${i + 1}`, label, playerId })
    } else out.push({ id: `o${i + 1}`, label })
  }
  if (withPlayers && new Set(out.map((o) => o.playerId)).size !== out.length) return null
  const labels = new Set(out.map((o) => o.label.toLowerCase()))
  if (out.length < 2 || out.length > CHALLENGE_BUILDER_LIMITS.options || labels.size !== out.length) return null
  return out
}

function readGame(v: unknown): ChallengeGameRef | null {
  const r = rec(v)
  const g = { sport: str(r.sport).toUpperCase(), homeAbbr: str(r.homeAbbr), awayAbbr: str(r.awayAbbr), homeLabel: str(r.homeLabel), awayLabel: str(r.awayLabel), kickoff: str(r.kickoff) }
  if (!g.sport || !g.homeAbbr || !g.awayAbbr || g.homeAbbr === g.awayAbbr || !g.homeLabel || !g.awayLabel || Number.isNaN(new Date(g.kickoff).getTime())) return null
  return { ...g, kickoff: new Date(g.kickoff).toISOString() }
}

function readPlayer(v: unknown): ChallengePlayerRef | null {
  const r = rec(v)
  const stat = str(r.stat) as ChallengePlayerStat
  const season = r.season, statWeek = r.statWeek
  if (!str(r.playerId) || !str(r.playerName) || !str(r.sport) || !ALL_PLAYER_STATS.has(stat)) return null
  if (!isNum(season) || !Number.isInteger(season) || season < 2000 || season > 2100 || !isNum(statWeek) || !Number.isInteger(statWeek) || statWeek < 0 || statWeek > 60) return null
  const sport = str(r.sport).toUpperCase()
  // A sport's own stat only on that sport; the legacy (football) list stays pickable everywhere,
  // settled by the commissioner where that sport does not store it.
  if (!(CHALLENGE_PLAYER_STATS as readonly string[]).includes(stat) && !playerStatSupported(sport, stat)) return null
  return { playerId: str(r.playerId), playerName: str(r.playerName).slice(0, 80), sport, season, statWeek, stat }
}

function readPosition(v: unknown): ChallengePositionRef | null {
  const r = rec(v)
  const position = str(r.position).toUpperCase()
  const season = r.season, statWeek = r.statWeek
  if (!str(r.sport) || !/^[A-Z0-9]{1,4}$/.test(position)) return null
  if (!isNum(season) || !Number.isInteger(season) || season < 2000 || season > 2100 || !isNum(statWeek) || !Number.isInteger(statWeek) || statWeek < 0 || statWeek > 60) return null
  return { sport: str(r.sport).toUpperCase(), season, statWeek, position }
}

function readProps(v: unknown): ChallengeSweepProp[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > CHALLENGE_BUILDER_LIMITS.props) return null
  const out: ChallengeSweepProp[] = []
  for (const [i, raw] of v.entries()) {
    const r = rec(raw)
    const question = str(r.question)
    const options = readOptions(r.options)
    if (!question || question.length > 300 || !options) return null
    out.push({ id: `p${i + 1}`, question, options })
  }
  return out
}

function readPuzzle(v: unknown): ChallengePuzzle | null {
  const r = rec(v)
  const answer = str(r.answer)
  if (!answer || answer.length > CHALLENGE_BUILDER_LIMITS.textAnswer || !normalizeAnswerText(answer)) return null
  return { answer, mode: r.mode === 'fastest' ? 'fastest' : 'first_correct', settle: r.settle === 'manual' ? 'manual' : 'exact' }
}

/**
 * The comparable form of a typed answer ("exact match"): case, accents, punctuation and extra
 * spaces do not count — "Tom Brady!" matches "tom   brady".
 */
export function normalizeAnswerText(text: string): string {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function lastScoreLabel(id: string, lang: ChallengeLang): string {
  const es = lang === 'es'
  if (id === 'touchdown') return es ? 'Touchdown' : 'Touchdown'
  if (id === 'field_goal') return es ? 'Gol de campo' : 'Field goal'
  if (id === 'safety') return es ? 'Safety' : 'Safety'
  return id
}

/** FAAB one winner can collect from this challenge: the richest place's FAAB grants. */
export function faabPerWinner(prizes: readonly ChallengePrizePlace[]): number {
  return Math.max(0, ...prizes.map((p) => p.rewards.reduce((sum, r) => sum + (r.type === 'faab_grant' ? r.amount : 0), 0)))
}

/**
 * Validate a commissioner's draft. Everything is checked on the server with this same function;
 * the screen calls it too, so its errors match. Returns the stored config on success.
 */
export function validateChallengeDraft(input: ChallengeDraftInput, ctx: ChallengeDraftContext): { ok: true; draft: ValidChallengeDraft } | { ok: false; error: ChallengeError } {
  const L = ctx.lang
  const bad = (code: ChallengeErrorCode, arg?: number) => ({ ok: false as const, error: challengeError(code, L, arg) })
  const prizePhase: SurvivorPrizePhase = ctx.prizePhase ?? (ctx.merged ? 'post_merge' : 'pre_merge')
  const phaseRules = ctx.prizePhaseRules ?? defaultPrizePhaseRules()
  const title = str(input.title)
  if (!title || title.length > CHALLENGE_BUILDER_LIMITS.title) return bad('title')
  const question = str(input.question)
  if (!question || question.length > CHALLENGE_BUILDER_LIMITS.question) return bad('question')
  const kind = str(input.kind) as ChallengeBuilderKind
  if (!(CHALLENGE_BUILDER_KINDS as readonly string[]).includes(kind)) return bad('kind')
  const scope = input.scope === 'tribe' ? 'tribe' : input.scope === 'individual' ? 'individual' : null
  if (!scope) return bad('scope')
  if (scope === 'tribe' && ctx.merged) return bad('tribeAfterMerge')
  const week = input.week == null ? ctx.currentWeek : input.week
  if (!isNum(week) || !Number.isInteger(week) || week < ctx.currentWeek || week > ctx.currentWeek + 20) return bad('week')
  const opens = input.opensAt == null || input.opensAt === '' ? ctx.now : readInstant(input.opensAt)
  const locks = readInstant(input.locksAt)
  if (!opens || !locks || locks.getTime() <= opens.getTime()) return bad('times')
  if (locks.getTime() <= ctx.now.getTime()) return bad('lockPast')

  const input_ = challengeInputKind(kind)
  let game: ChallengeGameRef | null = null
  // First TD scorer / last score type may name the game (its kickoff bounds the lock); optional.
  const optionalGame = kind === 'closest_without_going_over' || kind === 'first_td_scorer' || kind === 'last_score_type'
  if (challengeNeedsGame(kind) || (optionalGame && input.game)) {
    game = readGame(input.game)
    if (!game) return bad('game')
    if (locks.getTime() > new Date(game.kickoff).getTime()) return bad('gameLock')
  }
  let player: ChallengePlayerRef | null = null
  if (kind === 'player_stat_over_under' || kind === 'anytime_td') {
    // Every sport may run these; the ones we store stats for settle themselves (see
    // `challengeSettlementSource`), the rest are settled by the commissioner.
    player = readPlayer(kind === 'anytime_td' ? { ...rec(input.player), stat: 'total_td' } : input.player)
    if (!player) return bad('player')
  }
  let position: ChallengePositionRef | null = null
  let props: ChallengeSweepProp[] | undefined
  let puzzle: ChallengePuzzle | null = null
  if (kind === 'position_leader') {
    position = readPosition(input.position)
    if (!position) return bad('position')
  }
  if (kind === 'sweep') {
    const read = readProps(input.props)
    if (!read) return bad('sweep')
    props = read
  }
  if (kind === 'puzzle') {
    puzzle = readPuzzle(input.puzzle)
    if (!puzzle) return bad('puzzle')
  }
  let line: number | null = null
  if (kind === 'game_total_over_under' || kind === 'player_stat_over_under') {
    if (!isNum(input.line) || input.line < 0 || input.line > CHALLENGE_BUILDER_LIMITS.number || !twoDp(input.line)) return bad('line')
    line = input.line
  }
  let options: ChallengeOption[] = []
  if (kind === 'custom_choice' || kind === 'first_td_scorer') {
    const read = readOptions(input.options)
    if (!read) return bad('options')
    options = read
  } else if (kind === 'position_leader') {
    const read = readOptions(input.options, true)
    if (!read) return bad('position')
    options = read
  } else if (kind === 'last_score_type') {
    options = LAST_SCORE_TYPES.map((id) => ({ id, label: lastScoreLabel(id, L) }))
  } else if (kind === 'pick_winner' && game) {
    options = [{ id: game.awayAbbr, label: game.awayLabel }, { id: game.homeAbbr, label: game.homeLabel }]
  } else if (kind === 'game_total_over_under' || kind === 'player_stat_over_under') {
    options = [{ id: 'over', label: L === 'es' ? 'Más' : 'Over' }, { id: 'under', label: L === 'es' ? 'Menos' : 'Under' }]
  } else if (kind === 'anytime_td') {
    options = [{ id: 'yes', label: L === 'es' ? 'Sí, anota' : 'Yes, scores' }, { id: 'no', label: L === 'es' ? 'No anota' : 'No TD' }]
  }

  if (!Array.isArray(input.prizes) || input.prizes.length === 0 || input.prizes.length > CHALLENGE_BUILDER_LIMITS.places) return bad('prizes')
  const prizes: ChallengePrizePlace[] = []
  const seenPlaces = new Set<number>()
  for (const raw of input.prizes) {
    const r = rec(raw)
    const place = r.place
    if (!isNum(place) || !Number.isInteger(place) || place < 1 || place > CHALLENGE_BUILDER_LIMITS.places || seenPlaces.has(place)) return bad('prizes')
    if (!Array.isArray(r.rewards) || r.rewards.length === 0 || r.rewards.length > CHALLENGE_BUILDER_LIMITS.rewardsPerPlace) return bad('prizes')
    const rewards: ChallengePrizeReward[] = []
    for (const rr of r.rewards) {
      const reward = readPrizeReward(rr)
      if (!reward) return bad('reward')
      if (reward.type === 'faab_transfer' && scope !== 'tribe') return bad('transferScope')
      if (reward.type === 'immunity' && scope !== 'individual') return bad('immunityScope')
      const phaseError = prizePhaseError(reward.type, prizePhase, phaseRules, L)
      if (phaseError) return { ok: false as const, error: phaseError }
      rewards.push(reward)
    }
    seenPlaces.add(place)
    prizes.push({ place, rewards })
  }
  prizes.sort((a, b) => a.place - b.place)
  if (input_ === 'choice' && prizes.some((p) => p.place !== 1)) return bad('choicePlaces')
  const sweepTiered = kind === 'sweep' && input.sweepTiered === true
  if (kind === 'sweep' && prizes.some((p) => p.place > (sweepTiered ? Math.min(CHALLENGE_BUILDER_LIMITS.places, props!.length) : 1))) return bad('sweepPlaces')
  if (kind === 'puzzle' && puzzle!.mode === 'first_correct' && prizes.some((p) => p.place !== 1)) return bad('puzzlePlaces')

  const deferWeeks = input.deferWeeks == null ? 0 : input.deferWeeks
  if (!isNum(deferWeeks) || !Number.isInteger(deferWeeks) || deferWeeks < 0 || deferWeeks > CHALLENGE_BUILDER_LIMITS.deferWeeks) return bad('defer')
  if (deferWeeks > 0 && prizes.some((p) => p.rewards.some((r) => r.type === 'immunity'))) return bad('immunityDefer')

  // Right-or-wrong kinds (a choice, or a sweep card that hits or misses) may carry a penalty or a wager.
  const rightOrWrong = input_ === 'choice' || input_ === 'sweep'
  const missPenalty = readPenalty(input.missPenalty)
  if (missPenalty === 'invalid' || (missPenalty && !rightOrWrong)) return bad('penalty')
  const wager = readWager(input.wager)
  if (wager === 'invalid') return bad('wager')
  if (wager && !rightOrWrong) return bad('wagerKind')

  const perWinner = faabPerWinner(prizes)
  if (perWinner > 0 && ctx.otherFaabThisWeek + perWinner > ctx.faabWeeklyCap) return bad('faabCap', ctx.faabWeeklyCap)

  const allOverRule: ClosestAllOverRule = input.allOverRule === 'no_winner' ? 'no_winner' : 'closest_overall'
  return {
    ok: true,
    draft: {
      title,
      week,
      faabPerWinner: perWinner,
      config: {
        builder: 1, kind, scope, question, options, game, player, line, prizes, deferWeeks,
        missPenalty, wager, uniqueAnswers: input.uniqueAnswers === true, sealed: input.sealed === true, allOverRule,
        opensAt: opens.toISOString(), locksAt: locks.toISOString(),
        ...(props ? { props, sweepTiered } : {}),
        ...(puzzle ? { puzzle } : {}),
        ...(position ? { position } : {}),
      },
    },
  }
}

/** Read a stored config back (tolerant: null for anything that is not a builder challenge). */
export function readChallengeBuilderConfig(value: unknown): ChallengeBuilderConfig | null {
  const r = rec(value)
  if (r.builder !== 1 || !(CHALLENGE_BUILDER_KINDS as readonly string[]).includes(String(r.kind))) return null
  const c = r as unknown as ChallengeBuilderConfig
  return {
    builder: 1,
    kind: c.kind,
    scope: c.scope === 'tribe' ? 'tribe' : 'individual',
    question: typeof c.question === 'string' ? c.question : '',
    options: Array.isArray(c.options) ? c.options.filter((o) => typeof o?.id === 'string' && typeof o?.label === 'string') : [],
    game: c.game && typeof c.game === 'object' ? c.game : null,
    player: c.player && typeof c.player === 'object' ? c.player : null,
    line: isNum(c.line) ? c.line : null,
    prizes: Array.isArray(c.prizes) ? c.prizes : [],
    deferWeeks: isNum(c.deferWeeks) ? c.deferWeeks : 0,
    missPenalty: c.missPenalty ?? null,
    wager: c.wager ?? null,
    uniqueAnswers: c.uniqueAnswers === true,
    sealed: c.sealed === true,
    allOverRule: c.allOverRule === 'no_winner' ? 'no_winner' : 'closest_overall',
    opensAt: String(c.opensAt ?? ''),
    locksAt: String(c.locksAt ?? ''),
    ...(Array.isArray(c.props) ? { props: c.props.filter((p) => typeof p?.id === 'string' && Array.isArray(p?.options)), sweepTiered: c.sweepTiered === true } : {}),
    ...(c.puzzle && typeof c.puzzle === 'object' && typeof c.puzzle.answer === 'string' ? { puzzle: { answer: c.puzzle.answer, mode: c.puzzle.mode === 'fastest' ? 'fastest' as const : 'first_correct' as const, settle: c.puzzle.settle === 'manual' ? 'manual' as const : 'exact' as const } } : {}),
    ...(c.position && typeof c.position === 'object' ? { position: c.position } : {}),
  }
}

/** What may change on an edit once answers are in: words, prizes, and a LATER lock. */
export const CHALLENGE_EDITABLE_WITH_ANSWERS = ['title', 'question', 'prizes', 'deferWeeks', 'locksAt'] as const

/** Null when `next` only changes what `CHALLENGE_EDITABLE_WITH_ANSWERS` allows. */
export function editAfterAnswersError(prev: ChallengeBuilderConfig, next: ChallengeBuilderConfig, lang: ChallengeLang): ChallengeError | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const fixed: (keyof ChallengeBuilderConfig)[] = ['kind', 'scope', 'options', 'game', 'player', 'line', 'missPenalty', 'wager', 'uniqueAnswers', 'sealed', 'allOverRule', 'opensAt', 'props', 'sweepTiered', 'puzzle', 'position']
  if (fixed.some((k) => !same(prev[k], next[k]))) return challengeError('answered', lang)
  if (new Date(next.locksAt).getTime() < new Date(prev.locksAt).getTime()) return challengeError('answered', lang)
  return null
}

// ── Answers ───────────────────────────────────────────────────────────────────────────────────────

export type ChallengeAnswer = { optionId: string } | { value: number } | { text: string } | { picks: Record<string, string> }
export type ChallengeSubmission = { answer: ChallengeAnswer; wager: number | null }

/** Validate a manager's answer (and stake). */
export function validateChallengeAnswer(config: ChallengeBuilderConfig, raw: unknown, lang: ChallengeLang): { ok: true; submission: ChallengeSubmission } | { ok: false; error: string } {
  const r = rec(raw)
  const es = lang === 'es'
  let answer: ChallengeAnswer
  const inputKind = challengeInputKind(config.kind)
  if (inputKind === 'text') {
    const text = str(r.text)
    if (!text || text.length > CHALLENGE_BUILDER_LIMITS.textAnswer || !normalizeAnswerText(text)) return { ok: false, error: es ? 'Escribe tu respuesta (hasta 200 caracteres).' : 'Type your answer (up to 200 characters).' }
    answer = { text }
  } else if (inputKind === 'sweep') {
    const raw = rec(r.picks)
    const picks: Record<string, string> = {}
    for (const prop of config.props ?? []) {
      const id = str(raw[prop.id])
      if (!prop.options.some((o) => o.id === id)) return { ok: false, error: es ? 'Elige una opción en cada apuesta.' : 'Make a pick on every prop.' }
      picks[prop.id] = id
    }
    if (!Object.keys(picks).length) return { ok: false, error: es ? 'Elige una opción en cada apuesta.' : 'Make a pick on every prop.' }
    answer = { picks }
  } else if (inputKind === 'number') {
    const v = typeof r.value === 'string' && r.value.trim() ? Number(r.value) : r.value
    if (!isNum(v) || v < 0 || v > CHALLENGE_BUILDER_LIMITS.number || !twoDp(v)) return { ok: false, error: es ? 'Escribe un número (hasta dos decimales).' : 'Enter a number (up to two decimals).' }
    answer = { value: v }
  } else {
    const id = str(r.optionId)
    if (!config.options.some((o) => o.id === id)) return { ok: false, error: es ? 'Elige una de las opciones.' : 'Choose one of the options.' }
    answer = { optionId: id }
  }
  let wager: number | null = null
  if (config.wager) {
    const w = r.wager
    const whole = config.wager.currency === 'faab'
    if (!isNum(w) || w < config.wager.min || w > config.wager.max || (whole ? !Number.isInteger(w) : !twoDp(w))) {
      return { ok: false, error: es ? `Apuesta entre ${config.wager.min} y ${config.wager.max}.` : `Stake between ${config.wager.min} and ${config.wager.max}.` }
    }
    wager = w
  }
  return { ok: true, submission: { answer, wager } }
}

/** The comparable form of an answer, for "no two entrants may give the same answer". */
export function answerKey(answer: ChallengeAnswer): string {
  if ('optionId' in answer) return `o:${answer.optionId}`
  if ('text' in answer) return `t:${normalizeAnswerText(answer.text)}`
  if ('picks' in answer) return `s:${Object.keys(answer.picks).sort().map((k) => `${k}=${answer.picks[k]}`).join(',')}`
  return `n:${answer.value}`
}

export function readSubmission(value: unknown): ChallengeSubmission | null {
  const r = rec(value)
  const a = rec(r.answer)
  const picks = rec(a.picks)
  const answer: ChallengeAnswer | null = typeof a.optionId === 'string' ? { optionId: a.optionId }
    : isNum(a.value) ? { value: a.value }
      : typeof a.text === 'string' ? { text: a.text }
        : a.picks && Object.values(picks).every((x) => typeof x === 'string') ? { picks: picks as Record<string, string> }
          : null
  return answer ? { answer, wager: isNum(r.wager) ? r.wager : null } : null
}

// ── Scoring ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The true answer. A choice may carry ties (`tiedOptionIds`: position leaders tied on points — every
 * tied option is right); a puzzle's truth is its answer text; a sweep's is one option per prop.
 */
export type ChallengeTruth = { optionId: string; tiedOptionIds?: string[] } | { value: number } | { text: string } | { picks: Record<string, string> }
export type ChallengeEntry = { entrantId: string; submission: ChallengeSubmission; submittedAt: Date | string }

export type ChallengeScore = {
  /** Dense places: place 1 is every entrant tied for the best answer. */
  places: { place: number; entrantIds: string[] }[]
  correctIds: string[]
  wrongIds: string[]
  /** Number kinds: every entrant, best first. */
  ranked: { entrantId: string; value: number; distance: number; over: boolean }[]
}

/** Who placed. Ties share a place (the island blesses both). */
export function scoreChallenge(config: ChallengeBuilderConfig, entries: readonly ChallengeEntry[], truth: ChallengeTruth): ChallengeScore {
  const inputKind = challengeInputKind(config.kind)
  if (inputKind === 'sweep') return scoreSweep(config, entries, truth)
  if (inputKind === 'text') return scorePuzzle(config, entries, truth)
  if (inputKind === 'choice') {
    const right = new Set('optionId' in truth ? [truth.optionId, ...(truth.tiedOptionIds ?? [])] : [])
    const correctIds = entries.filter((e) => 'optionId' in e.submission.answer && right.has(e.submission.answer.optionId)).map((e) => e.entrantId).sort()
    const correct = new Set(correctIds)
    const wrongIds = entries.map((e) => e.entrantId).filter((x) => !correct.has(x)).sort()
    return { places: correctIds.length ? [{ place: 1, entrantIds: correctIds }] : [], correctIds, wrongIds, ranked: [] }
  }
  const target = 'value' in truth ? truth.value : NaN
  const numeric = entries.flatMap((e) => ('value' in e.submission.answer ? [{ e, v: e.submission.answer.value }] : []))
  if (!Number.isFinite(target)) return { places: [], correctIds: [], wrongIds: [], ranked: [] }
  if (config.kind === 'closest_without_going_over') {
    const result = settleClosestWithoutGoingOver(numeric.map(({ e, v }) => ({ userId: e.entrantId, guess: v, submittedAt: e.submittedAt })), target, { allOverRule: config.allOverRule })
    const ranked = result.ranked.map((r) => ({ entrantId: r.userId, value: r.guess, distance: Math.abs(r.margin), over: r.over }))
    // A guess over the target is out whenever anyone stayed under. Everyone over: the all-over rule
    // (closest overall, or no winner). Equal guesses keep the module's order — the earliest
    // submission wins, as in the original league — so there is one winner per place.
    const anyUnder = ranked.some((r) => !r.over)
    const eligible = anyUnder ? ranked.filter((r) => !r.over) : result.winnerUserId ? ranked : []
    const places = eligible.map((r, i) => ({ place: i + 1, entrantIds: [r.entrantId] }))
    return { places, correctIds: places[0]?.entrantIds ?? [], wrongIds: [], ranked }
  }
  const ranked = numeric
    .map(({ e, v }) => ({ entrantId: e.entrantId, value: v, distance: Math.round(Math.abs(v - target) * 100) / 100, over: v > target }))
    .sort((a, b) => a.distance - b.distance || a.entrantId.localeCompare(b.entrantId))
  const places: ChallengeScore['places'] = []
  let lastDistance: number | null = null
  for (const r of ranked) {
    if (lastDistance !== null && r.distance === lastDistance) places[places.length - 1]!.entrantIds.push(r.entrantId)
    else places.push({ place: places.length + 1, entrantIds: [r.entrantId] })
    lastDistance = r.distance
  }
  return { places, correctIds: places[0]?.entrantIds ?? [], wrongIds: [], ranked }
}

/**
 * A sweep: every prop must hit for place 1. With tiers, place 2 is one miss, place 3 two misses…
 * (up to 5 places, never down to zero right). Everyone short of a perfect card is "wrong" (a miss
 * penalty or a lost wager).
 */
function scoreSweep(config: ChallengeBuilderConfig, entries: readonly ChallengeEntry[], truth: ChallengeTruth): ChallengeScore {
  const props = config.props ?? []
  const picks = 'picks' in truth ? truth.picks : null
  if (!picks || !props.length) return { places: [], correctIds: [], wrongIds: [], ranked: [] }
  const n = props.length
  const hits = new Map<string, number>()
  for (const e of entries) {
    const a = e.submission.answer
    if (!('picks' in a)) continue
    hits.set(e.entrantId, props.filter((p) => picks[p.id] != null && a.picks[p.id] === picks[p.id]).length)
  }
  const maxPlaces = config.sweepTiered ? Math.min(CHALLENGE_BUILDER_LIMITS.places, n) : 1
  const places: ChallengeScore['places'] = []
  for (let k = 0; k < maxPlaces; k++) {
    const ids = [...hits].filter(([, h]) => h === n - k && h > 0).map(([id]) => id).sort()
    if (ids.length) places.push({ place: k + 1, entrantIds: ids })
  }
  const correctIds = [...hits].filter(([, h]) => h === n).map(([id]) => id).sort()
  const perfect = new Set(correctIds)
  const wrongIds = entries.map((e) => e.entrantId).filter((id) => !perfect.has(id)).sort()
  return { places, correctIds, wrongIds, ranked: [] }
}

/**
 * A puzzle: correct = the typed answer matches the commissioner's (normalized: case, accents,
 * punctuation and spacing do not count). "First correct" pays the earliest correct entry; "fastest"
 * pays places 1–5 in the order they were solved. Ties on the instant break on entrant id.
 */
function scorePuzzle(config: ChallengeBuilderConfig, entries: readonly ChallengeEntry[], truth: ChallengeTruth): ChallengeScore {
  const want = 'text' in truth ? normalizeAnswerText(truth.text) : ''
  if (!want) return { places: [], correctIds: [], wrongIds: [], ranked: [] }
  const at = (d: Date | string) => new Date(d).getTime()
  const correct = entries
    .filter((e) => 'text' in e.submission.answer && normalizeAnswerText(e.submission.answer.text) === want)
    .sort((a, b) => at(a.submittedAt) - at(b.submittedAt) || a.entrantId.localeCompare(b.entrantId))
  const paid = config.puzzle?.mode === 'fastest' ? correct.slice(0, CHALLENGE_BUILDER_LIMITS.places) : correct.slice(0, 1)
  const correctSet = new Set(correct.map((e) => e.entrantId))
  return {
    places: paid.map((e, i) => ({ place: i + 1, entrantIds: [e.entrantId] })),
    correctIds: correct.map((e) => e.entrantId),
    wrongIds: entries.map((e) => e.entrantId).filter((id) => !correctSet.has(id)).sort(),
    ranked: [],
  }
}

/**
 * Position leaders: the option whose player scored the most stored fantasy points that week. Every
 * option tied on the top score is right. Null when no option has a number at all.
 */
export function positionLeaderTruth(options: readonly ChallengeOption[], pointsByPlayer: ReadonlyMap<string, number>): ChallengeTruth | null {
  const scored = options.filter((o) => o.playerId && Number.isFinite(pointsByPlayer.get(o.playerId)))
  if (!scored.length) return null
  const best = Math.max(...scored.map((o) => pointsByPlayer.get(o.playerId!)!))
  const top = scored.filter((o) => pointsByPlayer.get(o.playerId!) === best).map((o) => o.id)
  return { optionId: top[0]!, ...(top.length > 1 ? { tiedOptionIds: top.slice(1) } : {}) }
}

/** O/U and anytime-TD truths from a stored number. A push (exactly on the line) is void. */
export function choiceTruthFromNumber(kind: ChallengeBuilderKind, value: number, line: number | null): ChallengeTruth | 'void' {
  if (kind === 'anytime_td') return { optionId: value > 0 ? 'yes' : 'no' }
  if (line == null) return 'void'
  if (value === line) return 'void'
  return { optionId: value > line ? 'over' : 'under' }
}

// ── Payouts ───────────────────────────────────────────────────────────────────────────────────────

export type PlannedPayout =
  | { key: string; kind: 'reward'; entrantId: string; place: number | null; reason: 'prize' | 'wager_win' | 'wager_loss' | 'miss'; spec: SurvivorRewardSpec; deferToWeek: number | null }
  | { key: string; kind: 'immunity'; entrantId: string; place: number; reason: 'prize'; rosterId: string }

export type PayoutContext = {
  challengeId: string
  week: number
  /** Bumped on every reversal, so a re-settle pays under fresh keys. */
  round: number
  /** Entrant → the roster ids that receive its prize (one for an individual; active members for a tribe). */
  recipients: ReadonlyMap<string, readonly string[]>
  /** Tribe scope: every active tribe that can give FAAB (for faab_transfer). */
  activeTribeIds?: readonly string[]
}

function prizeSpec(reward: Exclude<ChallengePrizeReward, { type: 'immunity' | 'faab_transfer' }>, rosterId: string): SurvivorRewardSpec {
  switch (reward.type) {
    case 'score_bonus': return { type: 'score_bonus', rosterId, points: reward.points }
    case 'faab_grant': return { type: 'faab_grant', rosterId, amount: reward.amount }
    case 'tribemate_points': return { type: 'tribemate_points', chooserRosterId: rosterId, points: reward.points }
    case 'free_trade_token': return { type: 'free_trade_token', rosterId, samePositionOnly: reward.samePositionOnly }
    case 'steal_blocker': return { type: 'steal_blocker', rosterId }
    case 'steal': return { type: 'steal', thiefRosterId: rosterId, what: reward.what, amount: reward.amount }
    case 'advantage': return { type: 'advantage', rosterId, powerType: reward.powerType }
  }
}

const roundPts = (n: number) => Math.round(n * 100) / 100

/**
 * Every reward a settlement pays, with its idempotency key. Deterministic: the same score and
 * context always give the same list, in the same order.
 */
export function planChallengePayouts(config: ChallengeBuilderConfig, score: ChallengeScore, entries: readonly ChallengeEntry[], ctx: PayoutContext): PlannedPayout[] {
  const out: PlannedPayout[] = []
  const base = `cb:${ctx.challengeId}:r${ctx.round}`
  const defer = config.deferWeeks > 0 ? ctx.week + config.deferWeeks : null
  const prizeByPlace = new Map(config.prizes.map((p) => [p.place, p.rewards]))
  const winners = new Set(score.places.flatMap((p) => p.entrantIds))

  for (const { place, entrantIds } of score.places) {
    const rewards = prizeByPlace.get(place)
    if (!rewards) continue
    for (const entrantId of entrantIds) {
      const recipients = [...(ctx.recipients.get(entrantId) ?? [])].sort()
      rewards.forEach((reward, idx) => {
        if (reward.type === 'immunity') {
          for (const rosterId of recipients) out.push({ key: `${base}:p${place}:${idx}:${rosterId}:imm`, kind: 'immunity', entrantId, place, reason: 'prize', rosterId })
          return
        }
        if (reward.type === 'faab_transfer') {
          // From every active tribe that did not place, to this tribe.
          for (const fromTribeId of [...(ctx.activeTribeIds ?? [])].sort()) {
            if (fromTribeId === entrantId || winners.has(fromTribeId)) continue
            out.push({ key: `${base}:p${place}:${idx}:${fromTribeId}>${entrantId}`, kind: 'reward', entrantId, place, reason: 'prize', deferToWeek: defer, spec: { type: 'faab_transfer', fromTribeId, toTribeId: entrantId, amount: reward.amount, basis: reward.basis } })
          }
          return
        }
        for (const rosterId of recipients) out.push({ key: `${base}:p${place}:${idx}:${rosterId}`, kind: 'reward', entrantId, place, reason: 'prize', deferToWeek: defer, spec: prizeSpec(reward, rosterId) })
      })
    }
  }

  const correct = new Set(score.correctIds)
  if (config.wager) {
    const w = config.wager
    for (const e of entries) {
      const stake = e.submission.wager
      if (stake == null || stake <= 0) continue
      const won = correct.has(e.entrantId)
      const amount = won ? stake * w.winMultiplier : stake * w.lossFraction
      const value = w.currency === 'faab' ? Math.floor(amount) : roundPts(amount)
      if (value <= 0) continue
      for (const rosterId of [...(ctx.recipients.get(e.entrantId) ?? [])].sort()) {
        const spec: SurvivorRewardSpec = w.currency === 'faab'
          ? (won ? { type: 'faab_grant', rosterId, amount: value } : { type: 'faab_penalty', rosterId, amount: value })
          : (won ? { type: 'score_bonus', rosterId, points: value } : { type: 'score_penalty', rosterId, points: value })
        out.push({ key: `${base}:w:${rosterId}`, kind: 'reward', entrantId: e.entrantId, place: won ? 1 : null, reason: won ? 'wager_win' : 'wager_loss', deferToWeek: null, spec })
      }
    }
  }
  if (config.missPenalty) {
    const p = config.missPenalty
    for (const entrantId of score.wrongIds) {
      for (const rosterId of [...(ctx.recipients.get(entrantId) ?? [])].sort()) {
        const spec: SurvivorRewardSpec = p.type === 'score_penalty' ? { type: 'score_penalty', rosterId, points: p.points } : { type: 'faab_penalty', rosterId, amount: p.amount }
        out.push({ key: `${base}:m:${rosterId}`, kind: 'reward', entrantId, place: null, reason: 'miss', deferToWeek: null, spec })
      }
    }
  }
  return out
}

// ── Words (English and Spanish) ───────────────────────────────────────────────────────────────────

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

export function describePrizeReward(r: ChallengePrizeReward, lang: ChallengeLang, scope: ChallengeBuilderScope): string {
  const es = lang === 'es'
  const each = scope === 'tribe' ? (es ? ' por jugador' : ' per player') : ''
  switch (r.type) {
    case 'score_bonus': return es ? `+${pts(r.points)} puntos${each}` : `+${pts(r.points)} points${each}`
    case 'faab_grant': return es ? `$${r.amount} de FAAB${each}` : `$${r.amount} FAAB${each}`
    case 'faab_transfer': return es ? `$${r.amount} de FAAB${r.basis === 'total' ? ' en total' : ' por jugador'} tomado de las otras tribus` : `$${r.amount} FAAB${r.basis === 'total' ? ' total' : ' per player'} taken from the other tribes`
    case 'tribemate_points': return es ? `${pts(r.points)} puntos para un compañero de tribu` : `${pts(r.points)} points to place on a tribemate`
    case 'free_trade_token': return es ? `un intercambio libre${r.samePositionOnly ? ' de la misma posición' : ''}` : `a free${r.samePositionOnly ? ' same-position' : ''} trade`
    case 'steal_blocker': return es ? 'un bloqueador de robos' : 'a steal blocker'
    case 'steal': return es ? `robar ${r.what === 'faab' ? `$${r.amount} de FAAB` : `${pts(r.amount)} puntos`}` : `a steal of ${r.what === 'faab' ? `$${r.amount} FAAB` : `${pts(r.amount)} points`}`
    case 'advantage': return es ? `ventaja: ${r.powerType.replace(/_/g, ' ')}` : `advantage: ${r.powerType.replace(/_/g, ' ')}`
    case 'immunity': return es ? 'inmunidad individual' : 'individual immunity'
  }
}

/** "1st: $50 FAAB per player · 2nd: +10 points (pays in week 7)". */
export function describeChallengePrizes(config: Pick<ChallengeBuilderConfig, 'prizes' | 'scope' | 'deferWeeks' | 'missPenalty' | 'wager'> & Partial<Pick<ChallengeBuilderConfig, 'kind' | 'props' | 'sweepTiered'>>, lang: ChallengeLang, week?: number): string {
  const es = lang === 'es'
  const sweepN = config.kind === 'sweep' ? config.props?.length ?? 0 : 0
  // A tiered sweep's places are "number right": 1st = all N, 2nd = N−1…
  const ord = (n: number) => (sweepN && config.sweepTiered
    ? (es ? `${sweepN - n + 1}/${sweepN} aciertos` : `${sweepN - n + 1}/${sweepN} right`)
    : es ? `${n}.º` : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
  const single = config.prizes.length === 1 && config.prizes[0]!.place === 1
  const parts = config.prizes.map((p) => `${single ? '' : `${ord(p.place)}: `}${p.rewards.map((r) => describePrizeReward(r, lang, config.scope)).join(' + ')}`)
  let line = parts.join(' · ')
  if (config.deferWeeks > 0) line += week != null ? (es ? ` (se paga en la semana ${week + config.deferWeeks})` : ` (pays in week ${week + config.deferWeeks})`) : (es ? ` (se paga ${config.deferWeeks} semana(s) después)` : ` (pays ${config.deferWeeks} week(s) later)`)
  if (config.missPenalty) line += es ? ` · fallo: −${config.missPenalty.type === 'score_penalty' ? `${pts(config.missPenalty.points)} puntos` : `$${config.missPenalty.amount} de FAAB`}` : ` · miss: −${config.missPenalty.type === 'score_penalty' ? `${pts(config.missPenalty.points)} points` : `$${config.missPenalty.amount} FAAB`}`
  if (config.wager) line += es ? ` · apuesta ${config.wager.min}–${config.wager.max} ${config.wager.currency === 'faab' ? 'de FAAB' : 'puntos'}` : ` · wager ${config.wager.min}–${config.wager.max} ${config.wager.currency === 'faab' ? 'FAAB' : 'points'}`
  return line
}

/** "Mon, Nov 3, 8:15 PM ET" — the host's lines always speak Eastern, the league's clock. */
export function easternLabel(iso: string, lang: ChallengeLang): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', { timeZone: EASTERN, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

export function challengeOpenLine(input: { title: string; config: ChallengeBuilderConfig; week: number; lang: ChallengeLang }): string {
  const es = input.lang === 'es'
  const who = input.config.scope === 'tribe' ? (es ? 'Una respuesta por tribu; la primera cuenta.' : 'One answer per tribe; the first one stands.') : (es ? 'Una respuesta por náufrago; la primera cuenta.' : 'One answer per castaway; the first one stands.')
  const prize = describeChallengePrizes(input.config, input.lang, input.week)
  return es
    ? `🔥 Nuevo reto: ${input.title}. ${who} Se cierra el ${easternLabel(input.config.locksAt, 'es')}. Premio: ${prize}.`
    : `🔥 New challenge: ${input.title}. ${who} Locks ${easternLabel(input.config.locksAt, 'en')}. Prize: ${prize}.`
}

export function challengeLockLine(input: { title: string; answers: number; lang: ChallengeLang }): string {
  return input.lang === 'es'
    ? `🔒 ${input.title}: respuestas cerradas (${input.answers}). El resultado llega cuando termine el partido.`
    : `🔒 ${input.title}: answers are locked (${input.answers} in). The result comes once it is final.`
}

export function challengeResultLine(input: { title: string; truthLabel: string | null; winnerNames: string[]; voided: boolean; sealedImmunity: boolean; lang: ChallengeLang }): string {
  const es = input.lang === 'es'
  if (input.voided) return es ? `⚖️ ${input.title}: se anula; nadie gana ni pierde.` : `⚖️ ${input.title}: void — nobody wins or loses.`
  const answer = input.truthLabel ? (es ? ` Respuesta: ${input.truthLabel}.` : ` Answer: ${input.truthLabel}.`) : ''
  // Sealed immunity: who won stays hidden until every vote is in (the council close announces it).
  if (input.sealedImmunity) return es ? `🏆 ${input.title}: resuelto.${answer} La inmunidad queda sellada hasta que se cierren los votos.` : `🏆 ${input.title}: settled.${answer} Immunity stays sealed until the votes close.`
  if (!input.winnerNames.length) return es ? `🏆 ${input.title}: resuelto.${answer} Nadie gana esta vez.` : `🏆 ${input.title}: settled.${answer} No winner this time.`
  return es ? `🏆 ${input.title}: resuelto.${answer} Ganan: ${input.winnerNames.join(', ')}.` : `🏆 ${input.title}: settled.${answer} Winners: ${input.winnerNames.join(', ')}.`
}

// ── Status ────────────────────────────────────────────────────────────────────────────────────────

/** The status a challenge should be in right now (scheduled → open → locked by the clock). */
export function clockStatus(stored: string, opensAt: string, locksAt: string, now: Date): ChallengeBuilderStatus {
  if (stored === 'complete' || stored === 'cancelled' || stored === 'settling') return stored
  if (new Date(locksAt).getTime() <= now.getTime()) return 'locked'
  if (stored === 'locked') return 'locked'
  return new Date(opensAt).getTime() <= now.getTime() ? 'open' : 'scheduled'
}
