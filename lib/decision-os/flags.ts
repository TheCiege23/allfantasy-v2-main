import { prisma } from '@/lib/prisma'

/**
 * Per-feed kill switches for the Decision OS grounding packet (5.3).
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────
 * Today there is exactly one switch, `DECISION_OS_GROUNDING_ENABLED`, and it is all-or-nothing:
 * one melting feed means turning off grounding entirely, losing the other eight. These are the
 * per-feed switches, so a bad producer can be taken out without taking the packet with it.
 *
 * ── 🛑 POLARITY: A KILL SWITCH, NOT AN ENABLE SWITCH ────────────────────────────────────────
 * Only an explicit off value kills a feed. Unset means on. This is the opposite of
 * `lib/commissioner-ui/liveReadiness.ts`, whose flags default to `false` because they answer "has
 * anyone written this integration yet" — a question where absence genuinely means no.
 *
 * The polarity matters more than it looks. `getBoolean` returns its default on a DB READ ERROR as
 * well as on unset (`getValue` swallows the error and returns null), so a flag read through it
 * would treat a transient database blip as a kill order for every feed at once. That is §2.20's
 * silence failure rebuilt in the control plane: facts vanish from answers and nothing says why.
 * **Absence of a kill order is not a kill order.**
 *
 * ⚠ THE COST OF THAT CHOICE, STATED PLAINLY: a kill does not survive a database outage. If the
 * store cannot be read, every feed reverts to on. That is why the env layer exists — it is the
 * only switch that works when nothing else does.
 *
 * ── EITHER SOURCE CAN KILL. NEITHER CAN REVIVE. ─────────────────────────────────────────────
 * `off` in the environment OR `false` in `platformConfig` kills the feed. It is an OR rather than
 * a precedence rule on purpose: with precedence, an emergency kill in one layer is silently undone
 * by a stale value in the other, and you cannot tell which layer you are fighting.
 *
 *   env  `DECISION_OS_FEED_MARKET_VALUES=off`   needs a deploy, works with no database
 *   db   `decision_os_feed_marketValues=false`  no deploy, needs a database
 *
 * ── ⚠ WHY THIS DOES NOT REUSE `getBoolean` PER FEED, WHICH THE PLAN ASKED FOR ────────────────
 * `liveReadiness.ts` is one uncached `prisma.platformConfig.findUnique` per call, and it has
 * **zero callers** — its own header says so. It has therefore never run on a hot path. Nine of
 * those inside `/api/chat/chimmy`'s 3-second packet ceiling, on the highest-traffic route, would
 * be nine round-trips per chat turn to read nine booleans that change perhaps monthly.
 *
 * So the shape is kept — one key per namespace, `platformConfig` as the store — and the read is
 * batched into a single prefix query behind a 30s cache, mirroring `PlatformConfigResolver`'s own
 * `CACHE_MS`. Steady state is zero queries per turn.
 */

/**
 * The feeds a packet assembles. Each is independently killable.
 *
 * ⚠ `managerPsychology`, `lineupDecision` and `psychologyConsistency` were removed 2026-11-17 with
 * the slices themselves. A leftover `decision_os_feed_*` row or `DECISION_OS_FEED_*` env var for
 * one of them is inert: kills resolve only against this list.
 */
export type DecisionOsFeed =
  | 'importAssertions'
  | 'leagueRules'
  | 'marketValues'
  | 'devyValues'
  | 'projections'
  | 'contextFacts'
  | 'commissionerIntelligence'
  | 'leagueIntelligence'
  | 'portfolio'
  /**
   * The commissioner health decision bridged from Pipeline A (R2.3).
   *
   * ⚠ ITS OWN SWITCH, SEPARATE FROM `waiverDecision`, BECAUSE THEY COST DIFFERENT THINGS. This
   * one runs TEN parallel queries through `getCommissionerHubHealthForUser`. An operator shedding
   * load needs to drop one engine without losing the other, which a single "decisions" switch
   * would make impossible.
   */
  | 'commissionerHealthDecision'
  /**
   * IDP + kicker roster values (R3.1).
   *
   * ⚠ Its own switch because it is the one slice that SERIALISES behind the context engine — it
   * needs the roster, so it cannot start with the others. If the packet ever runs hot, this is the
   * first thing an operator should be able to shed without losing the concurrent producers.
   */
  | 'idpKickerValues'
  /**
   * Roster value grade — this roster's positional strengths/weaknesses ranked against the rest of
   * the league by market value (R3.3, 2.2). Bridges `lib/core-app/rosterGrade.ts`, joins the
   * concurrent wave like the decision bridges (own DB reads, no roster dependency).
   */
  | 'rosterValueGrade'
  /**
   * The waiver claim decision (R2.6) — a LIVE run of the waiver recommender over the league's available pool, on
   * waiver questions only. 🛑 It had no switch (re-score item 9, 2026-11-16): the one slice that runs a real
   * decision engine per turn could not be shed without a deploy. Kill it and waiver questions answer from the
   * rest of the packet, with a stated gap.
   */
  | 'waiverDecision'
  /*
   * THE FIVE SLICES THE 2026-11-20 +10% PUSH ADDED, each with its own switch (hub re-score, operability). Each one
   * does real work per turn — a My Team load, a value board, up to three trade grades, a draft decision, a league's
   * manager records — so an operator must be able to shed any one of them without a deploy and without losing
   * the others. Killed, the slice is a `disabled` gap and the matching Chimmy tool still answers.
   */
  /** My Team's best lineup on lineup questions (`lib/chimmy/myTeamLineupGrounding.ts`). */
  | 'myTeamLineup'
  /** NBA/MLB/NHL roster values on the league's board. Also off whenever `marketValues` is. */
  | 'rosterBoardValues'
  /** The graded trades waiting on the asker, on trade questions. */
  | 'pendingTrades'
  /** The draft board and Draft OS's pick, on draft questions. */
  | 'draftBoard'
  /** Leaguemates' records (Competitive Edge), on manager questions. */
  | 'managerRecords'
  /*
   * 🛑 TWO SLICES WITH NO SWITCH OF THEIR OWN (2026-11-20 re-score). Both stopped only when the whole `projections`
   * feed was killed, so "every packet slice has its own kill switch" was false for them. Each does its own reads —
   * the roster priced under the league's own rules, and AllFantasy's league player metrics — so each is sheddable
   * alone now. Both still stop with `projections`, which they are built on.
   */
  /** The asker's roster priced under this league's scoring (`grounding/rosterLeagueProjections.ts`). */
  | 'rosterProjections'
  /** AllFantasy's league player metrics (`lib/af-projections/leaguePlayerMetrics.ts`). */
  | 'leaguePlayerMetrics'

export const DECISION_OS_FEEDS: readonly DecisionOsFeed[] = [
  'importAssertions',
  'leagueRules',
  'marketValues',
  'devyValues',
  'projections',
  'contextFacts',
  'commissionerIntelligence',
  'leagueIntelligence',
  'portfolio',
  'commissionerHealthDecision',
  'idpKickerValues',
  'rosterValueGrade',
  'waiverDecision',
  'myTeamLineup',
  'rosterBoardValues',
  'pendingTrades',
  'draftBoard',
  'managerRecords',
  'rosterProjections',
  'leaguePlayerMetrics',
] as const

const KEY_PREFIX = 'decision_os_feed_'
const CACHE_MS = 30_000

/** `marketValues` → `DECISION_OS_FEED_MARKET_VALUES`. */
function envNameFor(feed: DecisionOsFeed): string {
  return `DECISION_OS_FEED_${feed.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`
}

const OFF_VALUES = new Set(['0', 'false', 'no', 'off'])

/** True only for an explicit off. Anything else — including unset and garbage — is not a kill. */
function readsAsOff(raw: string | null | undefined): boolean {
  if (raw == null) return false
  return OFF_VALUES.has(raw.trim().toLowerCase())
}

let cache: { killed: Set<string>; at: number } | null = null

/**
 * Every feed killed in the DATABASE, as one query.
 *
 * ⚠ ON A READ FAILURE THIS RETURNS AN EMPTY SET, AND THE COMMENT IS THE POINT: an empty set means
 * "no kill orders", which is the safe direction for a kill switch. It must never be allowed to
 * mean "kill everything" — see the polarity note in the header.
 */
async function killedInStore(): Promise<Set<string>> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.killed

  const killed = new Set<string>()
  try {
    const rows = await prisma.platformConfig.findMany({
      where: { key: { startsWith: KEY_PREFIX } },
      select: { key: true, value: true },
    })
    for (const r of rows) {
      if (readsAsOff(r.value)) killed.add(r.key.slice(KEY_PREFIX.length))
    }
  } catch (error) {
    // Warn rather than throw: a control plane that can take the data plane down is worse than one
    // that fails open. The env layer is still in force and needs no database.
    console.warn('[decision-os/flags] kill-switch read failed; treating every feed as enabled', error)
    // ⚠ Cached anyway, so a database that is down does not get one query per chat turn on top of
    // whatever is already wrong with it.
  }
  cache = { killed, at: now }
  return killed
}

/** Drop the cache. Call after flipping a switch so an operator sees the effect immediately. */
export function invalidateDecisionOsFlagCache(): void {
  cache = null
}

export interface DecisionOsFeedFlags {
  enabled: (feed: DecisionOsFeed) => boolean
  /** The killed feeds, for the proof surface — an operator has to be able to SEE a kill. */
  killed: DecisionOsFeed[]
}

/**
 * Resolve every feed's state once per packet build.
 *
 * ⚠ RESOLVED ONCE AND PASSED DOWN, NOT QUERIED PER SLICE. A flag that can change midway through
 * assembling one packet would produce a packet that is internally inconsistent — market values
 * gathered under one policy and projections under another, with nothing recording that it
 * happened.
 */
export async function resolveDecisionOsFeedFlags(): Promise<DecisionOsFeedFlags> {
  const store = await killedInStore()
  const killed = DECISION_OS_FEEDS.filter(
    (f) => store.has(f) || readsAsOff(process.env[envNameFor(f)]),
  )
  const killedSet = new Set<DecisionOsFeed>(killed)
  return { enabled: (feed) => !killedSet.has(feed), killed }
}

/** Flip a feed in the database. The env layer is deploy-time and cannot be set from here. */
export async function setDecisionOsFeedEnabled(feed: DecisionOsFeed, enabled: boolean): Promise<void> {
  const key = `${KEY_PREFIX}${feed}`
  const value = enabled ? 'true' : 'false'
  await prisma.platformConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
  invalidateDecisionOsFlagCache()
}

/** Exported for tests and for the proof surface, so the env name is never guessed at a call site. */
export { envNameFor as decisionOsFeedEnvName, readsAsOff as decisionOsFlagReadsAsOff }
