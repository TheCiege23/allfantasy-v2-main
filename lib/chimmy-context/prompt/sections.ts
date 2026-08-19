/**
 * Phase 2B — section renderers
 *
 * Pure functions that turn `ChimmyContextBundle` slices into compact markdown
 * sections. Each renderer returns "" when the slice is missing/empty so the
 * composer/budget layer can drop them cleanly.
 */

import type {
  ChimmyContextBundle,
  ImportedHistorySlice,
  LeagueDifficultyContextSlice,
  LeagueSummary,
  MatchupContextSlice,
  RankingContextSlice,
  ReplayInsightSlice,
  RosterContextSlice,
  SportsScheduleSlice,
  StandingsContextSlice,
  SubscriptionContextSlice,
  UserContextSlice,
} from "@/lib/chimmy-context/types"
import {
  buildIntelligenceBundle,
  isEmptyIntelligence,
} from "@/lib/chimmy-context/intel/intelligenceBundle"

function line(label: string, value: string | number | boolean | null | undefined): string | null {
  if (value == null || value === "") return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  return `- ${label}: ${value}`
}

function joinLines(header: string, items: Array<string | null>): string {
  const body = items.filter((s): s is string => Boolean(s))
  if (body.length === 0) return ""
  return [header, ...body].join("\n")
}

export function renderUserSection(user: UserContextSlice | null): string {
  if (!user) return ""
  return joinLines("## USER", [
    line("Display name", user.displayName),
    line("Timezone", user.timezone),
    line("Preferred language", user.preferredLanguage),
  ])
}

export function renderAIAccessSection(ai: SubscriptionContextSlice | null): string {
  if (!ai) return ""
  const planLabel = ai.planLabel ?? (ai.hasSubscription ? "Premium" : "Free")
  return joinLines("## AI ACCESS", [
    line("Plan", planLabel),
    line("In trial", ai.inTrial ? "yes" : "no"),
    line("Trial days remaining", ai.inTrial ? ai.trialDaysRemaining : null),
    line("Token balance", ai.tokenBalance),
  ])
}

export function renderActiveLeagueSection(lg: LeagueSummary | null): string {
  if (!lg) return ""
  return joinLines("## ACTIVE LEAGUE", [
    line("Name", lg.name),
    line("Platform", lg.platform),
    line("Sport", lg.sport),
    line("Season", lg.season),
    line("Format", lg.format),
    line("Scoring", lg.scoring),
    line("Teams", lg.numTeams),
    line("Your role", lg.role),
  ])
}

export function renderImportedHistorySection(h: ImportedHistorySlice | null): string {
  if (!h || h.totalLeagues === 0) return ""
  const recent = h.recentLeagues
    .slice(0, 3)
    .map((r) => `  - ${r.name} (${r.season}): ${r.record ?? "N/A"}${r.champion ? " — CHAMP" : ""}`)
    .join("\n")
  return joinLines("## IMPORTED HISTORY", [
    line("Source", h.source),
    line("Total leagues", h.totalLeagues),
    line("Total seasons", h.totalSeasons),
    line("Career record", h.careerRecord),
    line("Win %", h.winPercentage),
    line("Championships", h.championships),
    line("Archetype", h.archetype),
    recent ? `- Recent:\n${recent}` : null,
  ])
}

export function renderMatchupSection(m: MatchupContextSlice | null): string {
  if (!m) return ""
  const margin =
    m.yourProjectedPoints != null && m.opponentProjectedPoints != null
      ? Number((m.yourProjectedPoints - m.opponentProjectedPoints).toFixed(2))
      : null
  return joinLines("## MATCHUP", [
    line("Week", m.week),
    line("Your projected points", m.yourProjectedPoints),
    line("Opponent projected points", m.opponentProjectedPoints),
    line("Projected margin", margin),
    line(
      "Projected leader",
      m.projectedLeader && m.projectedLeader !== "unknown" ? m.projectedLeader : null
    ),
    line(
      "Urgency",
      m.urgencySignals && m.urgencySignals.length > 0
        ? m.urgencySignals.join(",")
        : null
    ),
    line(
      "Priority",
      m.recommendationPriority && m.recommendationPriority !== "unknown"
        ? m.recommendationPriority
        : null
    ),
    line("Status", m.status),
  ])
}

export function renderRosterSection(r: RosterContextSlice | null): string {
  if (!r) return ""
  const starters = r.starters
    .slice(0, 12)
    .map((p) => `  - ${p.slot ?? "?"}: ${p.name}${p.position ? ` (${p.position})` : ""}${p.team ? ` — ${p.team}` : ""}`)
    .join("\n")
  const bench = r.bench
    .slice(0, 8)
    .map((p) => `  - ${p.name}${p.position ? ` (${p.position})` : ""}${p.team ? ` — ${p.team}` : ""}`)
    .join("\n")
  const byPos =
    r.byPosition && Object.keys(r.byPosition).length > 0
      ? Object.keys(r.byPosition)
          .sort()
          .map((k) => `${k}:${r.byPosition![k]}`)
          .join(" ")
      : null
  return joinLines("## ROSTER", [
    starters ? `- Starters:\n${starters}` : null,
    bench ? `- Bench:\n${bench}` : null,
    line(
      "Starter projection",
      r.starterProjectedTotal != null ? r.starterProjectedTotal : null
    ),
    line("By position", byPos),
    line(
      "Weakness",
      r.weaknessSignals && r.weaknessSignals.length > 0
        ? r.weaknessSignals.join(",")
        : null
    ),
    line(
      "Strength",
      r.strengthSignals && r.strengthSignals.length > 0
        ? r.strengthSignals.join(",")
        : null
    ),
    line(
      "Identity",
      r.teamIdentityHint && r.teamIdentityHint !== "unknown"
        ? r.teamIdentityHint
        : null
    ),
  ])
}

export function renderStandingsSection(s: StandingsContextSlice | null): string {
  if (!s) return ""
  const rows = s.rows
    .slice(0, 12)
    .map(
      (row) =>
        `  - #${row.rank ?? "?"} ${row.teamName ?? row.teamId}: ${row.wins ?? 0}-${row.losses ?? 0}${row.ties ? `-${row.ties}` : ""}`
    )
    .join("\n")
  if (!rows) return ""
  return joinLines("## STANDINGS", [`- Rows:\n${rows}`])
}

export function renderRankingsSection(r: RankingContextSlice | null): string {
  if (!r || !r.snapshot) return ""
  // Snapshot shape is owned by `lib/ranking/types`; render only the high-signal fields.
  const snap = r.snapshot as unknown as Record<string, unknown>
  return joinLines("## RANKINGS", [
    line("Source", typeof snap.source === "string" ? snap.source : null),
    line("Format", typeof snap.format === "string" ? snap.format : null),
    line("As of", typeof snap.asOf === "string" ? snap.asOf : null),
  ])
}

export function renderLeagueDifficultySection(d: LeagueDifficultyContextSlice | null): string {
  if (!d || !d.rating) return ""
  const r = d.rating as unknown as Record<string, unknown>
  return joinLines("## LEAGUE DIFFICULTY", [
    line("Score", typeof r.score === "number" ? r.score : null),
    line("Tier", typeof r.tier === "string" ? r.tier : null),
    line("Opponent strength", typeof r.opponentStrength === "number" ? r.opponentStrength : null),
    line("Scoring complexity", typeof r.scoringComplexity === "number" ? r.scoringComplexity : null),
  ])
}

export function renderSportsScheduleSection(s: SportsScheduleSlice | null): string {
  if (!s) return ""
  if (!s.hasRealData) {
    return [
      "## SPORTS SCHEDULE",
      `- Date: ${s.date}`,
      "- STATUS: No live schedule data available.",
      "- GUARDRAIL: Do NOT guess or infer today's games, scores, or start times from",
      "  model training data. Only answer using provided schedule context.",
      "  If asked, say: \"I need live schedule data connected before I can answer",
      "  today's games accurately.\"",
    ].join("\n")
  }
  const gameLines = s.games.slice(0, 20).map((g) => {
    const score =
      g.status === "in_progress" || g.status === "final"
        ? ` (${g.awayScore ?? "?"}-${g.homeScore ?? "?"})`
        : ""
    const time = g.startTime ? ` @ ${g.startTime}` : ""
    return `  - [${g.sport}] ${g.awayTeam} vs ${g.homeTeam}${time} — ${g.status}${score}`
  })
  return joinLines("## SPORTS SCHEDULE", [
    `- Date: ${s.date}`,
    `- Games (${s.games.length} total):\n${gameLines.join("\n")}`,
  ])
}

/**
 * Phase 2C Batch 4 Sub-batch E — unified intelligence section.
 * Phase 3A.1 — also surfaces top 3 strategic risk dimensions + adaptive
 * coaching hint ordering (with relevance scores). Concise + token-safe:
 * adaptive output replaces the raw `Coaching` line when present.
 * Suppressed when the derived slice is fully empty.
 */
export function renderIntelligenceSection(bundle: ChimmyContextBundle): string {
  const i = buildIntelligenceBundle(bundle)
  if (isEmptyIntelligence(i)) return ""

  const topRisks = (i.topRisks ?? []).slice(0, 3)
  const topRisksLine =
    topRisks.length > 0
      ? topRisks.map((r) => `${r.dimension}:${r.score}`).join(",")
      : null

  const adaptive = i.adaptiveCoachingHints ?? []
  // Prefer adaptive (scored, ordered) hints; fall back to raw slug list.
  const coachingLine =
    adaptive.length > 0
      ? adaptive
          .slice(0, 6)
          .map((h) => `${h.slug}(${h.score})`)
          .join(",")
      : i.coachingHints.length > 0
        ? i.coachingHints.join(",")
        : null

  const composite =
    i.strategicRiskScores && typeof i.strategicRiskScores.composite === "number"
      ? i.strategicRiskScores.composite
      : null

  return joinLines("## INTELLIGENCE", [
    line(
      "Urgency",
      i.urgencyLevel !== "unknown"
        ? i.urgencyScore != null
          ? `${i.urgencyLevel}(${i.urgencyScore})`
          : i.urgencyLevel
        : null
    ),
    line("Severity", i.recommendationSeverity),
    line(
      "Identity",
      i.teamIdentity !== "unknown" ? i.teamIdentity : null
    ),
    line("Playoff outlook", i.playoffOutlook),
    line("Roster outlook", i.rosterOutlook),
    line("Competitive", i.competitiveContextSummary),
    line("Risk composite", composite),
    line("Top risks", topRisksLine),
    line(
      "Risks",
      i.strategicRisks.length > 0 ? i.strategicRisks.join(",") : null
    ),
    line("Coaching", coachingLine),
  ])
}

/**
 * Static personality + guardrail block. Kept short — the main system prompt
 * still holds the bulk of expert-knowledge content.
 */
export function renderChimmyPersonalitySection(): string {
  return [
    "## CHIMMY PERSONALITY",
    "- Tone: direct, friendly, evidence-led.",
    "- Cite specific numbers from the context above when available.",
    "- Never fabricate stats. If a slice is missing, say so briefly.",
    "- Recommendations only — never claim to execute trades, lineup moves, or waivers.",
  ].join("\n")
}

/** The exact disclaimer shown on the dashboard (Phase 20/21) — reused verbatim so the surfaces agree. */
const REPLAY_DISCLAIMER =
  "Historical replay observations summarize past outcomes and are not recommendations for future decisions."

/**
 * Historical Replay Summary (Phase 22) — OBSERVATIONAL ONLY.
 *
 * Renders the user-safe replay insight set as an explicitly-labelled, disclaimer-
 * carrying section. It emits ONLY the section header, the fixed disclaimer, the
 * contract's own descriptive insight strings (headline + displayValue +
 * confidence + sample size), and a trades-analyzed line — never any imperative
 * / recommendation language, and never a raw ID (the contract carries none).
 * `disabled` → "" (no section); `empty` → an honest "no data yet" section so
 * Chimmy can say so plainly; `ready` → the observational summary.
 */
export function renderReplayInsightSection(slice: ReplayInsightSlice | null): string {
  if (!slice || slice.status === "disabled") return ""

  const header = "## HISTORICAL REPLAY SUMMARY (observational only)"

  if (slice.status === "empty" || !slice.insightSet || slice.insightSet.insights.length === 0) {
    return [
      header,
      REPLAY_DISCLAIMER,
      "- No completed historical replay data is available for this league yet.",
    ].join("\n")
  }

  const set = slice.insightSet
  const confidenceWord: Record<string, string> = {
    high: "high confidence",
    moderate: "moderate confidence",
    low: "low confidence",
    insufficient: "very limited data",
  }
  const insightLines = set.insights.map((i) => {
    const conf = confidenceWord[i.confidence] ?? i.confidence
    return `- ${i.headline} (${i.displayValue}, ${conf}, ${i.sampleSize} trade${i.sampleSize === 1 ? "" : "s"})`
  })
  const meta =
    set.tradesWithLineupData > 0
      ? `Based on ${set.tradesAnalyzed} completed trades (${set.tradesWithLineupData} with lineup data).`
      : `Based on ${set.tradesAnalyzed} completed trades.`

  return [header, REPLAY_DISCLAIMER, ...insightLines, meta].join("\n")
}

/** Convenience: every renderer keyed by section id. */
export function renderAllSections(bundle: ChimmyContextBundle): Record<string, string> {
  return {
    user: renderUserSection(bundle.user),
    aiAccess: renderAIAccessSection(bundle.aiAccess),
    activeLeague: renderActiveLeagueSection(bundle.activeLeague),
    matchup: renderMatchupSection(bundle.matchup),
    intelligence: renderIntelligenceSection(bundle),
    roster: renderRosterSection(bundle.roster),
    standings: renderStandingsSection(bundle.standings),
    rankings: renderRankingsSection(bundle.rankings),
    leagueDifficulty: renderLeagueDifficultySection(bundle.leagueDifficulty),
    importedHistory: renderImportedHistorySection(bundle.importedHistory),
    sportsSchedule: renderSportsScheduleSection(bundle.sportsSchedule),
    replayInsights: renderReplayInsightSection(bundle.replayInsights),
    personality: renderChimmyPersonalitySection(),
  }
}
