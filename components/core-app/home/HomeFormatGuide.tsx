'use client'

import { useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import type { FormatCount, FormatKey } from '@/lib/core-app/homeFormats'
import { homeLearnMessages } from '@/lib/core-app/messages/homeLearn'
import '@/components/core-app/home/af-home-guide.css'

/**
 * "Your league formats" (2026-11-12): one chip per format the reader plays, with how many leagues
 * use it. Tapping a chip opens how the format works and what to watch this week — the teaching the
 * owner asked for, at the moment someone is wondering why a guillotine league behaves the way it does.
 *
 * One chip open at a time, and none by default: the card is a glossary, not a wall of text.
 */
export function HomeFormatGuide({ formats }: { formats: FormatCount[] }) {
  const t = useMessages(homeLearnMessages)
  const [open, setOpen] = useState<FormatKey | null>(null)
  // A fixed id, not useId(): the server's and the browser's generated ids disagreed (a hydration
  // mismatch seen on the dev server, 2026-11-12), and the card is drawn at most once per page.
  const panelId = 'af-formats-panel'
  if (formats.length === 0) return null
  return (
    <section className="af3a-card af-hg-card" aria-labelledby="af-formats-title">
      <header className="af-hg-cardhead">
        <h2 id="af-formats-title">{t.formatsTitle}</h2>
        <span>{t.formatsSub}</span>
      </header>
      <ul className="af-format-chips">
        {formats.map(({ key, count }) => (
          <li key={key}>
            <button
              type="button"
              className="af-format-chip"
              aria-expanded={open === key}
              aria-controls={panelId}
              onClick={() => setOpen(open === key ? null : key)}
            >
              <span>{t.formatName(key)}</span>
              <b>{count}</b>
            </button>
          </li>
        ))}
      </ul>
      <div id={panelId} className="af-format-panel" hidden={open == null} aria-live="polite">
        {open ? (
          <>
            <p className="af-format-panel-name">
              {t.formatName(open)} <span>· {t.formatLeagues(formats.find((f) => f.key === open)?.count ?? 0)}</span>
            </p>
            <p>
              <b>{t.formatHowItWorks}</b> {t.formatRule(open)}
            </p>
            <p>
              <b>{t.formatWatch}</b> {t.formatWatchLine(open)}
            </p>
            <p className="af-hg-note">{t.formatSettingsNote}</p>
          </>
        ) : null}
      </div>
    </section>
  )
}

export default HomeFormatGuide
