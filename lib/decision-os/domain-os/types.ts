import 'server-only'

/**
 * Domain OS kernel — the contract every per-domain feed shares.
 *
 * THE SHAPE OF THE SYSTEM
 * Decision OS should decide, not gather. Each domain (lineup, waiver, trade) runs its own feed that
 * maintains the facts its decisions need, and Decision OS reads them. This module is the part all
 * of those feeds have in common; the domains themselves only declare WHAT they gather.
 *
 * ⚠ DIRECTION. These feed INTO Decision OS. `lib/commissioner-ui/*` points the other way — its
 * `decision-os-client` modules call INTO Decision OS to render a surface. Same "OS" suffix,
 * opposite arrow.
 *
 * THREE LEVELS, BECAUSE THE REPO ALREADY HAS THREE
 * `AfAppLearningSnapshot` (by sport), `AfLeagueLearningSnapshot` (by league) and
 * `AfUserLearningProfile` (by user) already model app / league / user with one uniform shape:
 * features + explain + confidence + sampleSize + windowDays. The feeds use the same three levels
 * and carry the same confidence/sample fields rather than inventing a parallel scheme, so a fact
 * and a learned feature can be reasoned about together.
 *
 * WHY EVERY LEVEL CARRIES confidence AND sampleSize
 * A fact derived from 2 games and one from 200 are not the same fact. Without the sample attached,
 * a downstream decision cannot tell them apart, and the DCO's `data_completeness` becomes a guess.
 * Null means "not applicable to this fact", never zero.
 */

/**
 * App is the widest and slowest: league-type norms, positional baselines, scoring-format effects.
 * League narrows to one league's settings, structure and history. User narrows to one manager.
 *
 * Ordered widest → narrowest deliberately: a resolver falls back UP this list, so a missing user
 * fact degrades to a league fact and then to an app fact rather than to nothing.
 */
export const OS_SCOPE_LEVELS = ['app', 'league', 'user'] as const
export type OsScopeLevel = (typeof OS_SCOPE_LEVELS)[number]

/**
 * Which feed produced this. One row space, partitioned by domain.
 *
 * ⚠ `'league'` is not a decision domain like the other four — it carries the canonical league
 * ruleset, which several decision domains and four runtime resolvers all need. It is here rather
 * than inside one of them because `draft-os` already made the opposite choice and got it wrong:
 * it holds the same fact under the name "draft rules", cached for the one runtime resolver that
 * has no callers, while three that do have routes paid for it uncached. See `league-os/index.ts`.
 *
 * ⚠ `'value'` is the second non-decision domain, and it is the one where the LEVEL matters most.
 * Market prices are `app`-level (one answer per sport+format for everyone); IDP and kicker values
 * are `league`-level by construction, because they are derived from that league's own scoring.
 * Storing a league-derived value at app level would price a tackle-heavy league's linebackers for
 * everybody. See `lib/decision-os/value/contract.ts`.
 *
 * Widening this union needs no migration — `DomainOsFacts.domain` is a `VarChar(16)`.
 */
export type OsDomain =
  | 'lineup' | 'waiver' | 'trade' | 'draft'
  | 'league' | 'value' | 'projection' | 'import'
  /**
   * Manager Psychology OS, FACTS ONLY (2026-11-20): a league's manager records — trades, waiver claims and FAAB,
   * drafts — as the viewer sees them, held five minutes per viewer (`lib/decision-os/manager-records-os`).
   * ⚠ The label-and-score seam this name once described (`lib/psychological-profiles/`) was retired on 2026-11-17;
   * nothing here stores a label, a score or a prediction. USER level: the view leaves the viewer out and reads the
   * viewer's own FAAB through their roster, so it is never shared between viewers.
   */
  | 'psychology'
  /**
   * The commissioner's league-health snapshot (2026-11-20 re-score push) — the input to `commissioner.league.health`,
   * the one Decision OS domain that had no maintained facts and read its world live on every call. USER level, not
   * league: with dynasty signals on, the snapshot marks which team is the VIEWER's, so one co-commissioner's
   * snapshot is not another's. See `lib/decision-os/commissioner-os/index.ts`.
   */
  | 'commissioner'

export interface OsFactEnvelope<T> {
  facts: T
  level: OsScopeLevel
  /** Mirrors the learning trio. Null = the producer does not express confidence for this fact. */
  confidence: number | null
  /** How much observation the fact rests on. Null = not sample-based (e.g. a settings snapshot). */
  sampleSize: number | null
  capturedAt: Date
  ageMs: number
}

export const MINUTES = 60 * 1000
export const HOURS = 60 * MINUTES

