'use client'

import type { RulebookSection } from '@/lib/league-rules/buildLeagueRulebook'

/**
 * "Rules explained": every rule the commissioner chose, with what it means. Presentational — the
 * sections come from lib/league-rules/buildLeagueRulebook.ts. Drawn inside the League Settings page
 * (`.af-core`), so it uses that page's list styles.
 */
export function LeagueRulebook({ sections }: { sections: readonly RulebookSection[] }) {
  return (
    <div data-testid="league-rulebook">
      <p className="lsh-help">These are the rules your commissioner chose. If one changes, this page changes with it.</p>
      {sections.map((section) => (
        <section key={section.id} className="lsh-section" aria-labelledby={`rulebook-${section.id}`} data-testid={`rulebook-section-${section.id}`}>
          <h2 id={`rulebook-${section.id}`}>{section.title}</h2>
          <ul className="lsh-list">
            {section.entries.map((entry) => (
              <li key={entry.id}>
                <div className="lsh-rule" data-testid={`rulebook-entry-${entry.id}`}>
                  <div className="lsh-rule-head">
                    <span className="lsh-rule-label">{entry.label}</span>
                    <span className="lsh-rule-value" data-pending={entry.pending ? 'true' : undefined}>
                      {entry.value}
                    </span>
                  </div>
                  <p className="lsh-rule-meaning">{entry.meaning}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
