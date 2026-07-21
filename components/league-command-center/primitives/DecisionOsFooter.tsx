'use client'

import type { AIContextSource } from '@/lib/chimmy-chat/types'
import { KeyValueList, type KeyValueRow } from './Panel'

/**
 * The Decision OS summary + Chimmy prompt chips that close every section.
 *
 * Two halves, deliberately:
 *
 *  - **Summary rows** — a few key/value facts, role-aware. These are read from
 *    real resolved data by the calling section; this component never computes
 *    or invents them. A row with a `null` value renders an em dash, so "we do
 *    not know" is visibly different from "zero".
 *
 *  - **Chimmy chips** — suggested prompts. Selecting one opens the assistant
 *    with that prompt already in the box.
 *
 * On the Chimmy wiring: this calls `onAskChimmy`, which the Command Center
 * shell implements by mounting `ChimmyChatShell` **in place** with
 * `initialPrompt`. It deliberately does not dispatch `af-chimmy-prefill`
 * (no component in the app listens for that event) and does not deep-link to
 * `/ai-chat?prompt=` (that page renders `<ChimmyChatShell />` with no props and
 * never reads the query param). Both of those paths look correct and silently
 * drop the prompt.
 */
export interface ChimmyChip {
  id: string
  label: string
  prompt: string
  /** Routes the assistant to the right domain reasoning. */
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
}

export interface DecisionOsFooterProps {
  /** Section-scoped title, e.g. "Decision OS — Matchups". */
  title?: string
  rows: readonly KeyValueRow[]
  chips: readonly ChimmyChip[]
  source: AIContextSource
  onAskChimmy: (chip: ChimmyChip, source: AIContextSource) => void
  /**
   * Rendered when the underlying intelligence could not be resolved. Shown
   * instead of the rows, never alongside a fabricated summary.
   */
  unavailableNote?: string | null
}

export function DecisionOsFooter({
  title = 'Decision OS',
  rows,
  chips,
  source,
  onAskChimmy,
  unavailableNote,
}: DecisionOsFooterProps) {
  return (
    <section className="af-cc-dos" aria-label={title}>
      <div className="af-cc-dos__head">
        <i className="ph ph-compass-tool" style={{ color: 'var(--cc-brand-bright)' }} aria-hidden="true" />
        <span className="af-cc-dos__title">{title}</span>
      </div>

      {unavailableNote ? (
        <p style={{ fontSize: 12, color: 'var(--cc-text-4)', margin: 0, lineHeight: 1.55 }}>
          {unavailableNote}
        </p>
      ) : rows.length > 0 ? (
        <KeyValueList rows={rows} />
      ) : null}

      {chips.length > 0 ? (
        <div className="af-cc-dos__chips">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="af-cc-chip"
              data-testid={`cc-chimmy-chip-${chip.id}`}
              onClick={() => onAskChimmy(chip, source)}
            >
              <i className="ph ph-sparkle" aria-hidden="true" />
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default DecisionOsFooter
