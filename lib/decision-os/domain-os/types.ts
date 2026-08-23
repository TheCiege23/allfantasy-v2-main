import 'server-only'

/**
 * Domain OS kernel — the contract every per-domain feed shares.
 *
 * THE SHAPE OF THE SYSTEM
 * Decision OS should decide, not gather. Each domain (lineup, waiver, trade) runs its own feed that
 * maintains the facts its decisions need, and Decision OS reads them. This module is the part all
 * of those feeds have in common; the domains themselves only declare WHAT they gather.
 *
 * ⚠ DIRECTION. These feed INTO Decision OS. `lib/commissioner-os/*` points the other way — its
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

/** Which feed produced this. One row space, partitioned by domain. */
export type OsDomain = 'lineup' | 'waiver' | 'trade'

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

/**
 * How long a captured fact stays servable, per domain and kind.
 *
 * Deliberately per-kind rather than one global number. Injury and bye decide whether a player can
 * be started at all and decay in minutes; league scoring settings change a few times a season.
 * A single TTL would have to be tuned to the fastest-moving input and would throw away nearly all
 * of the benefit for the slowest.
 */
export type OsTtlTable = Record<string, number>

export const MINUTES = 60 * 1000
export const HOURS = 60 * MINUTES

/**
 * A fact family a domain gathers. Domains declare these; the kernel stores and serves them.
 *
 * `scopeKey` is how a fact is addressed WITHIN its level — a sport at app level, a league id at
 * league level, a user id at user level (optionally compounded, e.g. a week). Producer and consumer
 * must derive it the same way, so each domain exports its own builders rather than formatting
 * strings at call sites.
 */
export interface OsFactKindSpec {
  kind: string
  level: OsScopeLevel
  ttlMs: number
}
