import { csvRow } from '@/lib/commissioner-ui/utils/csv'
import type { WarehouseAnalytics } from '@/lib/commissioner-ui/analytics/warehouseReads'
import type { AnalyticsDataWindow } from '@/lib/commissioner-ui/analytics/decision-os-client/types'

/**
 * What Commissioner Reports can actually produce.
 *
 * ── TEMPLATES ARE CODE, NOT ROWS, AND THAT IS THE LOAD-BEARING DECISION ──────────────────────
 *
 * A template is a DESCRIPTION OF A GENERATOR THAT EXISTS a few lines below it. Putting the catalog
 * in a table would let the two disagree — a row for a report nothing can build, or a builder no row
 * offers — and the failure would be silent in the direction that matters: a commissioner clicking
 * Generate on a template with no generator. Every entry here ships with its `build` function, so
 * the catalog cannot advertise something the code cannot make.
 *
 * ⚠ FOUR TEMPLATES, AND EVERY ONE GENERATES. The demo fixture carries four, and it would have been
 * easy to mirror its names and wire only the first. Shipping one that works beats four that mostly
 * do not — so these four exist because each is a genuinely different, genuinely buildable cut of
 * the warehouse, not to match a fixture's count.
 *
 * 🛑 NEVER A SECOND COPY OF ANOTHER MODULE'S DATA — the module's own rule. These package
 * intelligence League Analytics already owns into a file someone can keep; nothing here recomputes
 * a figure, and nothing reads these artifacts back to answer a question about the league.
 */

export type ReportTemplateId =
  | 'weekly-commissioner-digest'
  | 'season-recap'
  | 'manager-engagement'
  | 'transaction-summary'

export interface ReportTemplateDefinition {
  id: ReportTemplateId
  name: string
  description: string
  category: 'season_recap' | 'engagement' | 'transactions' | 'commissioner_digest'
  /** Modules whose intelligence this packages — referenced, never embedded. */
  sourceModuleIds: string[]
  frequency: 'weekly' | 'monthly' | 'manual'
  /** Prose for the history row. Written from the artifact, so it can never overstate it. */
  summarise: (rows: number, data: WarehouseAnalytics) => string
  build: (data: WarehouseAnalytics, window: AnalyticsDataWindow | null) => string
}

function header(): string {
  return csvRow(['Section', 'Label', 'Value'])
}

/**
 * Provenance leads every artifact, for the reason `buildAnalyticsCsv` already records: a file
 * outlives the screen it came from. The on-screen banner explains that "Active Managers 0 of 7"
 * is a statement about data age rather than about the league; a CSV emailed to a league carries no
 * banner, so without these rows the export is the one artifact that presents a stale reading as
 * fact — and it is the artifact most likely to be quoted back later.
 */
function provenance(data: WarehouseAnalytics, w: AnalyticsDataWindow | null): string[] {
  const lines: string[] = []
  if (data.seasonLabel) lines.push(csvRow(['Data window', 'Scoring season', data.seasonLabel]))
  if (w) {
    lines.push(csvRow(['Data window', 'Lookback (days)', w.lookbackDays]))
    lines.push(csvRow(['Data window', 'Manager inactive after (days)', w.inactiveAfterDays]))
    lines.push(csvRow(['Data window', 'Newest league activity', w.lastActivityAt ?? 'none recorded']))
    lines.push(csvRow(['Data window', 'Days since newest activity', w.daysSinceLastActivity ?? 'n/a']))
  }
  return lines
}

function round(n: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export const REPORT_TEMPLATES: ReportTemplateDefinition[] = [
  {
    id: 'weekly-commissioner-digest',
    name: 'Weekly Commissioner Digest',
    description:
      'Everything a commissioner would check on a Monday, in one file: how current the data is, who has gone quiet, what the league has been doing, and how the season is scoring.',
    category: 'commissioner_digest',
    sourceModuleIds: ['mission-control', 'analytics', 'managers'],
    frequency: 'weekly',
    summarise: (rows, d) =>
      `Digest covering ${d.managerActivity.length} managers and ${d.transactionsByWeek.length} weeks of transactions, ${rows} rows.`,
    build: (d, w) => {
      const lines = [header(), ...provenance(d, w)]
      for (const m of d.managerActivity) {
        lines.push(csvRow(['Manager activity', m.managerName, `${m.actionsPerWeek} actions (prior ${m.priorActionsPerWeek})`]))
      }
      for (const t of d.transactionsByWeek) {
        lines.push(
          csvRow(['Transactions', t.weekLabel, `${t.tradeCount} trades, ${t.waiverClaimCount} waivers`]),
        )
      }
      for (const p of d.pointsForAgainst) {
        lines.push(csvRow(['Scoring', p.teamName, `${round(p.pointsFor)} for / ${round(p.pointsAgainst)} against`]))
      }
      return lines.join('\n')
    },
  },
  {
    id: 'season-recap',
    name: 'Season Recap',
    description:
      'The long view — every franchise’s all-time record and titles, and how the league has scored season over season.',
    category: 'season_recap',
    sourceModuleIds: ['analytics', 'league-health'],
    frequency: 'manual',
    summarise: (rows, d) => `Recap of ${d.allTimeRecords.length} franchises across ${d.seasonComparison.length} seasons, ${rows} rows.`,
    build: (d, w) => {
      const lines = [header(), ...provenance(d, w)]
      for (const r of d.allTimeRecords) {
        lines.push(
          csvRow([
            'All-time record',
            r.teamName,
            `${r.wins}-${r.losses} over ${r.seasons} season${r.seasons === 1 ? '' : 's'}, ${r.titles} title${r.titles === 1 ? '' : 's'}`,
          ]),
        )
      }
      for (const s of d.seasonComparison) {
        lines.push(csvRow(['Season scoring', s.seasonLabel, `${round(s.value)} avg points for`]))
      }
      return lines.join('\n')
    },
  },
  {
    id: 'manager-engagement',
    name: 'Manager Engagement Report',
    description:
      'Who is playing and how. Activity over the rolling window against the prior one, alongside each manager’s behavioural fingerprint.',
    category: 'engagement',
    sourceModuleIds: ['managers', 'analytics'],
    frequency: 'manual',
    summarise: (rows, d) =>
      `Engagement for ${d.managerActivity.length} managers and ${d.managerFingerprints.length} fingerprints, ${rows} rows.`,
    build: (d, w) => {
      const lines = [header(), ...provenance(d, w)]
      for (const m of d.managerActivity) {
        const delta = m.actionsPerWeek - m.priorActionsPerWeek
        const trend = delta > 0 ? `up ${delta}` : delta < 0 ? `down ${Math.abs(delta)}` : 'unchanged'
        lines.push(csvRow(['Engagement', m.managerName, `${m.actionsPerWeek} actions, ${trend} vs prior window`]))
      }
      for (const f of d.managerFingerprints) {
        lines.push(
          csvRow([
            'Fingerprint',
            f.managerName,
            `aggression ${f.aggression}, activity ${f.activity}, trading ${f.tradeFrequency}, risk ${f.riskTolerance}`,
          ]),
        )
      }
      return lines.join('\n')
    },
  },
  {
    id: 'transaction-summary',
    name: 'Trade & Transaction Summary',
    description: 'What the league actually did — trades and waivers by week, and the all-time mix of every kind of league action.',
    category: 'transactions',
    sourceModuleIds: ['analytics', 'workspace'],
    frequency: 'monthly',
    summarise: (rows, d) =>
      `${d.transactionsByWeek.length} weeks of transactions and ${d.activityMix.length} activity types, ${rows} rows.`,
    build: (d, w) => {
      const lines = [header(), ...provenance(d, w)]
      for (const t of d.transactionsByWeek) {
        lines.push(csvRow(['Trades', t.weekLabel, t.tradeCount]))
        lines.push(csvRow(['Waivers', t.weekLabel, t.waiverClaimCount]))
      }
      for (const a of d.activityMix) {
        lines.push(csvRow(['Activity mix (all-time)', a.label, a.count]))
      }
      return lines.join('\n')
    },
  },
]

export function findTemplate(id: string): ReportTemplateDefinition | null {
  return REPORT_TEMPLATES.find((t) => t.id === id) ?? null
}
