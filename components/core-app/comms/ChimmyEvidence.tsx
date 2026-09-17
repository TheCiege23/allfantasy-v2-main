'use client'

import { useState } from 'react'

/**
 * WHAT AN ANSWER WAS BUILT FROM, RENDERED WHERE THE ANSWER IS.
 *
 * 🛑 THE ROUTE HAS ALWAYS SENT THIS AND THIS DRAWER HAS ALWAYS THROWN IT AWAY.
 * `/api/chat/chimmy` returns `meta.confidencePct`, `meta.dataSources`,
 * `meta.staleness`, `meta.syncFreshness`, `meta.sourceLinks` and a full
 * `contract.confidence` block carrying level, rationale, and — the valuable
 * half — the list of inputs it did NOT have. The drawer read four fields of it
 * and rendered one line ("Read from <league>"). Everything else arrived over
 * the wire and was discarded at the `JSON.parse`.
 *
 * ⚠ NOT `components/chimmy/ChimmyTrustPanel`. That component renders the same
 * contract, and reusing it here was the first instinct — but it is written in
 * Tailwind utility classes against a dark glass surface, and this drawer is 101
 * `af-cm-*` classNames with zero Tailwind. Dropping it in would have produced a
 * panel styled by whichever rules happened to win, which is the failure mode
 * this repo has already paid for more than once. Same contract, this drawer's
 * idiom.
 *
 * ⚠ AND NOT A `<details>` ELEMENT, though it is the obvious fit for "collapsed
 * until asked". A closed `<details>` hides its content from visibility
 * assertions, so a test asserting the evidence renders would pass with the
 * whole block broken. Explicit state and an `aria-expanded` button cost two
 * lines and stay visible to anything that looks.
 */

export type ChimmyEvidence = {
  /** 0-100. The route sends 100 for deterministic answers, 0 for non-answers. */
  confidencePct: number | null
  level: 'high' | 'medium' | 'low' | null
  rationale: string | null
  freshness: 'fresh' | 'partial' | 'stale' | 'unknown' | null
  leagueContext: 'available' | 'partial' | 'missing' | null
  /** Rubric signals that RAISED the score. Slugs; labelled below. */
  basedOn: string[]
  /** Inputs the answer did not have. Already human-readable from the rubric. */
  missing: string[]
  /** Everything consulted, in the order the route pushed it. */
  dataSources: string[]
  /** Internal routes only. Re-checked here anyway — see below. */
  sourceLinks: { label: string; href: string }[]
  /** Overall sports-digest sync time, ISO. */
  syncedAt: string | null
  /** Minutes since the relevant sync, when the route reported staleness. */
  staleMinutes: number | null
}

/**
 * Slug → what a person would call it.
 *
 * ⚠ THE EXISTING TRUST PANEL PRINTS THESE RAW, so a user is told their answer
 * was based on "league_sports_grounding_packet". A source list nobody can read
 * is not evidence, it is reassurance — the thing this block exists to replace.
 * Unknown slugs fall through to a de-underscored form rather than being
 * dropped: an unlabelled source is still a source, and silently hiding one
 * would understate what the answer touched.
 */
const SOURCE_LABELS: Record<string, string> = {
  deterministic: 'Stored data (no AI call)',
  live_web_search: 'Live web search',
  league_sports_grounding_packet: 'Your league settings and rosters',
  league_source_references: 'Your league pages',
  decision_os_grounding_packet: 'Decision engine',
  screenshot_vision: 'The screenshot you sent',
  ai_memory: 'What Chimmy remembers about you',
  chat_history: 'Earlier in this conversation',
  working_memory: 'This conversation',
  core_home_signals: 'What your home screen is showing',
  core_surface_context: 'The screen you asked from',
  sports_digest_db: 'Stored sports data (scores, injuries, news)',
  trade_scenario: "This trade, run against your league's rosters",
  waiver_scenario: 'This add/drop, run against your roster',
  start_sit_scenario: 'This start/sit choice, run against your roster',
  chimmy_personalization: 'Your saved preferences',
  chimmy_orchestration: 'Answer routing',
  stale_data_warning: 'A staleness warning',
  simulation: 'Season simulation',
  warehouse: 'Historical league data',
  league_settings: 'League settings',
  league_graph: 'Cross-league comparison',
  global_meta: 'League-wide trends',
  dynasty: 'Dynasty outlook',

  /*
   * The tool loop reports `dataSources: loop.toolsUsed`, so on that path this
   * list is literally the lookups the model chose to make — the most precise
   * sourcing anything in this drawer can show. Labelled because the raw names
   * are function identifiers.
   */
  find_league_by_name: 'Found the league you named',
  get_my_roster: 'Your roster, scoring and waiver budget',
  get_available_players: 'Who is actually available',
  get_player_value: 'Player trade values',
  get_player_projection: 'Player projections',
  explain_value: 'Why a player is valued that way',
  get_league_standings: 'League standings',
  get_head_to_head: 'Head-to-head record',
  get_trade_block: 'Trade block (marked in AllFantasy)',
  get_upcoming_games: 'Upcoming games',
  get_stat_leaders: 'Stat leaders',
}

/** Rubric signal slugs. These are a fixed, small set — see confidence-rubric.ts. */
const SIGNAL_LABELS: Record<string, string> = {
  league_context: 'your league was loaded',
  data_sources: 'multiple data sources agreed',
  source_links: 'it could cite league pages',
  response_structure: 'the answer was fully structured',
  model_confidence: 'the model reported high confidence',
  base_policy: 'the default for this question type',
  fallback_policy: 'a fallback — the answer was not fully structured',
}

/**
 * Slug FAMILIES the route builds by string concatenation.
 *
 * 🛑 THESE CANNOT BE LISTED AS LITERALS, WHICH IS WHY THEY GET THEIR OWN BRANCH.
 * `dataSources.push(`agent_prompt_${specialistAgent}`)` and
 * `dataSources.push(`decision_os_grounding_${grounding.outcome}`)` mint a new slug per
 * specialist and per outcome, so any literal map of them is stale the moment somebody adds a
 * specialist — and stale in the quiet way, where the entry simply stops matching and the
 * fallback takes over without telling anyone.
 *
 * ⚠ CHECKED AFTER THE LITERAL MAP, NEVER BEFORE IT. `decision_os_grounding_packet` is a real
 * literal meaning the packet arrived, not an outcome named "packet"; if this ran first it
 * would render "Decision engine (packet)" and quietly outrank a correct label. There is a test
 * pinning that order.
 */
const SLUG_FAMILIES: Array<{ prefix: string; render: (suffix: string) => string }> = [
  { prefix: 'agent_prompt_', render: (s) => `Specialist: ${s.replace(/_/g, ' ')}` },
  { prefix: 'decision_os_grounding_', render: (s) => `Decision engine (${s.replace(/_/g, ' ')})` },
]

function label(slug: string, map: Record<string, string>): string {
  const known = map[slug]
  if (known) return known

  for (const family of SLUG_FAMILIES) {
    if (slug.startsWith(family.prefix) && slug.length > family.prefix.length) {
      return family.render(slug.slice(family.prefix.length))
    }
  }

  /*
   * ⚠ STILL RENDERS. An unlabelled slug is de-underscored rather than dropped: hiding a source
   * would understate what the answer touched, which is the opposite of what this block is for.
   * The label map is a readability improvement, never a filter.
   */
  return slug.replace(/_/g, ' ')
}

/**
 * ⚠ INTERNAL ROUTES ONLY, RE-CHECKED AT THE RENDER.
 *
 * `buildChimmySourceReferences` emits only `/league/...` paths today, so this
 * is belt and braces — but these links reach the DOM from a JSON payload on a
 * path that also carries model output, and an external URL rendered as a
 * clickable source is an open-redirect with a trust badge next to it. `//host`
 * and `/\host` are protocol-relative and must not pass a bare `startsWith('/')`.
 */
function isInternalHref(href: string): boolean {
  return (
    typeof href === 'string' &&
    href.startsWith('/') &&
    !href.startsWith('//') &&
    !href.startsWith('/\\')
  )
}

function freshnessWord(
  freshness: ChimmyEvidence['freshness'],
  staleMinutes: number | null,
): string | null {
  if (!freshness || freshness === 'unknown') return null
  if (freshness === 'fresh') return 'Fresh'
  if (staleMinutes != null && staleMinutes > 0) {
    const hours = Math.floor(staleMinutes / 60)
    if (hours >= 1) return `${hours}h behind`
    return `${staleMinutes}m behind`
  }
  return freshness === 'partial' ? 'Partly stale' : 'Stale'
}

export function ChimmyEvidenceBlock({ evidence }: { evidence: ChimmyEvidence }) {
  const [expanded, setExpanded] = useState(false)

  const {
    confidencePct,
    level,
    rationale,
    leagueContext,
    basedOn,
    missing,
    dataSources,
    sourceLinks,
    syncedAt,
    staleMinutes,
  } = evidence

  const fresh = freshnessWord(evidence.freshness, staleMinutes)
  const links = sourceLinks.filter((l) => isInternalHref(l.href))

  /*
   * ⚠ A BADGE WITH NOTHING BEHIND IT IS WORSE THAN NO BADGE. Several paths in
   * the route answer without a contract at all — the off-topic deflection sends
   * `confidencePct: 0` precisely because nothing was evaluated. Rendering "0%"
   * under it would read as a confidence judgement about the answer rather than
   * as "no answer was attempted". So a block with no sources, no level and no
   * missing inputs does not render.
   */
  const hasAnything =
    level != null || dataSources.length > 0 || missing.length > 0 || links.length > 0
  if (!hasAnything) return null

  const canExpand =
    Boolean(rationale) ||
    basedOn.length > 0 ||
    missing.length > 0 ||
    dataSources.length > 0 ||
    links.length > 0 ||
    Boolean(syncedAt)

  return (
    <div className="af-cm-evidence" data-testid="chimmy-evidence">
      <div className="af-cm-ev-row">
        {level ? (
          <span className="af-cm-ev-level af-num" data-level={level}>
            {level} confidence
            {confidencePct != null ? ` · ${confidencePct}%` : ''}
          </span>
        ) : null}

        {fresh ? (
          <span className="af-cm-ev-fresh" data-freshness={evidence.freshness ?? 'unknown'}>
            {fresh}
          </span>
        ) : null}

        {dataSources.length > 0 ? (
          <span className="af-cm-ev-count af-num">
            {dataSources.length} {dataSources.length === 1 ? 'source' : 'sources'}
          </span>
        ) : null}

        {/*
          The missing count is in the COLLAPSED row on purpose. "What it could
          not see" is the half of this contract that changes what a person does
          with the answer, and putting it behind a click makes the reassuring
          half the default reading.
        */}
        {missing.length > 0 ? (
          <span className="af-cm-ev-missing af-num" data-testid="chimmy-evidence-missing-count">
            {missing.length} missing
          </span>
        ) : null}

        {canExpand ? (
          <button
            type="button"
            className="af-cm-ev-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="af-cm-ev-detail"
          >
            {expanded ? 'Hide' : 'What is this based on?'}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="af-cm-ev-detail" id="af-cm-ev-detail" data-testid="chimmy-evidence-detail">
          {rationale ? <p className="af-cm-ev-why">{rationale}</p> : null}

          {dataSources.length > 0 ? (
            <div className="af-cm-ev-group">
              <span className="af-cm-ev-head">Read</span>
              <ul className="af-cm-ev-list">
                {dataSources.map((s) => (
                  <li key={s}>{label(s, SOURCE_LABELS)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {missing.length > 0 ? (
            <div className="af-cm-ev-group" data-missing="true">
              <span className="af-cm-ev-head">Could not read</span>
              <ul className="af-cm-ev-list">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {basedOn.length > 0 ? (
            <p className="af-cm-ev-signals">
              Confidence came from: {basedOn.map((s) => label(s, SIGNAL_LABELS)).join(', ')}.
            </p>
          ) : null}

          {leagueContext ? (
            <p className="af-cm-ev-signals">
              League context: <span data-league-context={leagueContext}>{leagueContext}</span>.
            </p>
          ) : null}

          {syncedAt ? (
            <p className="af-cm-ev-signals">
              Sports data synced {new Date(syncedAt).toLocaleString()}.
            </p>
          ) : null}

          {links.length > 0 ? (
            <div className="af-cm-ev-links">
              {links.map((l) => (
                <a key={l.href} className="af-cm-ev-link" href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default ChimmyEvidenceBlock
