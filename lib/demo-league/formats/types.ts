/**
 * Shapes for the per-format sample demos. Client-safe: types only.
 *
 * A format's distinctive screens (Chopping Block, Tribal Council, HOH, contracts…) are
 * described with a handful of generic panel kinds and drawn by ONE renderer
 * (components/demo-league/formats/FormatPanels.tsx), so adding a format is data, not a new
 * component.
 */
import type { DemoLeagueView } from '../types'
import type { RequestableFormat } from '@/lib/create-league-v2/requestedFormat'

export type Tone = 'danger' | 'success' | 'warning' | 'info' | 'muted'

export type PanelItem = {
  /** Demo team seat, when the row is about a team; rendered as that team's badge. */
  slot?: number
  label: string
  detail?: string
  tone?: Tone
  badge?: string
}

export type FormatPanel =
  | { kind: 'list'; title: string; subtitle?: string; items: PanelItem[] }
  | { kind: 'groups'; title: string; subtitle?: string; groups: Array<{ name: string; tone?: Tone; members: PanelItem[] }> }
  | { kind: 'timeline'; title: string; subtitle?: string; entries: Array<{ when: string; item: PanelItem }> }
  | { kind: 'table'; title: string; subtitle?: string; columns: string[]; rows: Array<{ slot?: number; cells: string[] }> }
  | { kind: 'callout'; title: string; body: string; tone?: Tone }

export type FormatDemoMeta = {
  /** URL slug: /demo/formats/<id>. */
  id: string
  /** What `/create-league?type=` receives. */
  wizardType: RequestableFormat
  title: string
  subtitle: string
  poster: string
  pitch: string
  /** How the format works, in the product's own terms. */
  rules: string[]
}

export type FormatDemo = FormatDemoMeta & {
  view: DemoLeagueView
  panels: FormatPanel[]
  standingsNote?: string
  /** 'points' for formats with no head-to-head record (Guilly, Survivor, Survivor Guilly). */
  standingsMode?: 'record' | 'points'
  standingsTitle?: string
}
