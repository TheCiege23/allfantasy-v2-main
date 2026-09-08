import { csvRow, downloadTextFile } from '../utils/csv'
import type { LeagueAnalyticsSnapshot } from './decision-os-client/types'

/**
 * A real, working export — not a represented-but-unwired affordance —
 * because serializing already-fetched data to CSV client-side needs no
 * Decision OS backend at all. Pure and DOM-free so it's directly
 * unit-testable; `downloadAnalyticsCsv` below is the thin, impure
 * browser-only trigger. Row-building is this module's own — it knows
 * the shape of a `LeagueAnalyticsSnapshot` — but escaping and the
 * download mechanism are the shared `lib/commissioner-ui/utils/csv`
 * primitives Reports also builds on.
 */
export function buildAnalyticsCsv(snapshot: LeagueAnalyticsSnapshot): string {
  const lines: string[] = [csvRow(['Section', 'Label', 'Value'])]

  /*
   * Provenance leads, because a CSV outlives the screen it came from.
   *
   * The on-screen banner tells a commissioner that "Active Managers 0 of 7" is a statement about
   * data age rather than about their league. A file emailed to a league or handed to a client
   * carries no banner — so without these rows the export is the one artifact that still presents
   * the stale reading as fact, and it is the artifact most likely to be quoted back later.
   */
  /*
   * Which season the scoring rows describe. On screen this sits in the panel note; in a file the
   * "Points" rows would otherwise be undated, and in preseason they are LAST season's — a reader
   * opening this in December would reasonably assume the current one.
   */
  if (snapshot.seasonLabel) {
    lines.push(csvRow(['Data window', 'Scoring season', snapshot.seasonLabel]))
  }

  const w = snapshot.dataWindow
  if (w) {
    lines.push(csvRow(['Data window', 'Lookback (days)', w.lookbackDays]))
    lines.push(csvRow(['Data window', 'Manager inactive after (days)', w.inactiveAfterDays]))
    lines.push(csvRow(['Data window', 'Newest league activity', w.lastActivityAt ?? 'none recorded']))
    lines.push(csvRow(['Data window', 'Days since newest activity', w.daysSinceLastActivity ?? 'n/a']))
    lines.push(csvRow(['Data window', 'All-time trades', w.allTime.tradeCount]))
    lines.push(csvRow(['Data window', 'All-time waiver claims', w.allTime.waiverCount]))
    lines.push(csvRow(['Data window', 'All-time events', w.allTime.eventCount]))
  }

  for (const kpi of snapshot.kpis) {
    lines.push(csvRow(['KPI', kpi.label, kpi.value]))
  }
  for (const series of snapshot.trends) {
    for (const point of series.points) {
      lines.push(csvRow([`Trend: ${series.name}`, point.label, point.value]))
    }
  }
  for (const metric of snapshot.competitiveBalance) {
    lines.push(csvRow(['Competitive Balance', metric.label, metric.value]))
  }
  for (const bucket of snapshot.scoringDistribution) {
    lines.push(csvRow(['Scoring Distribution', bucket.rangeLabel, bucket.teamCount]))
  }
  for (const week of snapshot.transactionsByWeek) {
    lines.push(csvRow(['Transactions', `${week.weekLabel} — Trades`, week.tradeCount]))
    lines.push(csvRow(['Transactions', `${week.weekLabel} — Waiver Claims`, week.waiverClaimCount]))
  }
  for (const entry of snapshot.rosterUtilization) {
    lines.push(csvRow(['Roster Utilization', entry.teamName, `${entry.utilizationPercent}%`]))
  }
  for (const point of snapshot.seasonComparison) {
    lines.push(csvRow(['Season Comparison', point.seasonLabel, point.value]))
  }
  /*
   * 30a's sections. The caller passes the snapshot ALREADY filtered by the
   * on-screen time range (see lib/commissioner-ui/analytics/timeRange.ts), so
   * these rows cannot drift from what the commissioner is looking at.
   */
  for (const week of snapshot.healthByWeek) {
    lines.push(csvRow(['League Health', `${week.weekLabel} — This season`, week.thisSeason]))
    if (week.lastSeason !== null) {
      lines.push(csvRow(['League Health', `${week.weekLabel} — Last season`, week.lastSeason]))
    }
  }
  if (snapshot.healthTarget !== null) {
    lines.push(csvRow(['League Health', 'Target', snapshot.healthTarget]))
  }
  for (const entry of snapshot.managerActivity) {
    lines.push(csvRow(['Manager Activity', `${entry.managerName} — Actions/wk`, entry.actionsPerWeek]))
    lines.push(csvRow(['Manager Activity', `${entry.managerName} — Prior actions/wk`, entry.priorActionsPerWeek]))
  }
  for (const team of snapshot.pointsForAgainst) {
    lines.push(csvRow(['Points', `${team.teamName} — For`, team.pointsFor]))
    lines.push(csvRow(['Points', `${team.teamName} — Against`, team.pointsAgainst]))
  }
  /*
   * The all-time sections. A donut and a radar are the two forms hardest to read a number off, so
   * the export matters more for these than for the bar charts above — this is where someone goes
   * to get the actual figure behind a wedge or a spoke.
   *
   * ⚠ `?? []` ON A REQUIRED FIELD IS DELIBERATE HERE. `tsconfig.json` excludes every test pattern
   * repo-wide, so NO test file is typechecked — a fixture missing a required field compiles fine
   * and only explodes at runtime, which is exactly how this crashed. An export is the wrong place
   * to be strict: losing someone's whole CSV to one absent section is worse than emitting it
   * without that section.
   */
  for (const entry of snapshot.activityMix ?? []) {
    lines.push(csvRow(['Activity mix', entry.label, entry.count]))
  }
  for (const record of snapshot.allTimeRecords ?? []) {
    lines.push(csvRow(['All-time record', `${record.teamName} — Wins`, record.wins]))
    lines.push(csvRow(['All-time record', `${record.teamName} — Losses`, record.losses]))
    lines.push(csvRow(['All-time record', `${record.teamName} — Seasons`, record.seasons]))
    lines.push(csvRow(['All-time record', `${record.teamName} — Titles`, record.titles]))
  }
  for (const m of snapshot.managerFingerprints ?? []) {
    lines.push(csvRow(['Manager fingerprint', `${m.managerName} — Aggression`, m.aggression]))
    lines.push(csvRow(['Manager fingerprint', `${m.managerName} — Activity`, m.activity]))
    lines.push(csvRow(['Manager fingerprint', `${m.managerName} — Trading`, m.tradeFrequency]))
    lines.push(csvRow(['Manager fingerprint', `${m.managerName} — Risk`, m.riskTolerance]))
    if (m.labels.length) {
      lines.push(csvRow(['Manager fingerprint', `${m.managerName} — Labels`, m.labels.join(' | ')]))
    }
  }

  return lines.join('\n')
}

export function downloadAnalyticsCsv(snapshot: LeagueAnalyticsSnapshot, filename = 'league-analytics.csv'): void {
  downloadTextFile(buildAnalyticsCsv(snapshot), filename, 'text/csv;charset=utf-8;')
}
