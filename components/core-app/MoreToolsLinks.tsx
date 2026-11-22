import Link from 'next/link'
import { messagesFor } from '@/lib/i18n/messages'
import { moreToolsMessages } from '@/lib/core-app/messages/moreTools'
import { MORE_TOOLS, type MoreToolsScreen } from '@/lib/core-app/moreTools'
import '@/components/core-app/af-core-boards.css'

/**
 * "More tools" at the foot of Trades, Draft HQ, Rankings and Player Finder — the Tools hub links
 * that had no other home in /core (lib/core-app/moreTools.ts). After the screen, never above it:
 * these are for someone who came looking, and the screen's own work comes first.
 */
export function MoreToolsLinks({ screen, language }: { screen: MoreToolsScreen; language: string }) {
  const m = messagesFor(moreToolsMessages, language)
  const links = MORE_TOOLS[screen]
  if (links.length === 0) return null
  return (
    <section className="af-more-tools" aria-labelledby="af-more-tools-h" data-testid={`more-tools-${screen}`}>
      <h2 id="af-more-tools-h" className="af-more-tools-h">
        {m.heading}
      </h2>
      <ul className="af-more-tools-list">
        {links.map((l) => (
          <li key={l.key}>
            <Link href={l.href} className="af-more-tools-link" prefetch={false}>
              <span className="af-more-tools-title">
                {m[l.key]}
                {l.pro ? <span className="af-more-tools-pro">{m.pro}</span> : null}
                {l.leavesShell ? (
                  <span className="af-more-tools-out" aria-label={m.leavesShell} title={m.leavesShell}>
                    ↗
                  </span>
                ) : null}
              </span>
              <span className="af-more-tools-desc">{m[`${l.key}Desc` as const]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

