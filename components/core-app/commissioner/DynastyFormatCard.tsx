import Link from 'next/link'
import { ArrowRight, Landmark } from 'lucide-react'
import type { CommissionerFormatCard } from '@/lib/core-app/commissioner/formatCards'
import './dynasty-format-card.css'

const MAX_CHIPS = 7

/**
 * The dynasty format card on the Commissioner Hub. Every string arrives already in the reader's
 * language from `dynastyFormatCard` (lib/core-app/commissioner/formatCards.ts), and every row is a
 * saved setting — a setting the league never saved is absent, not defaulted.
 */
export function DynastyFormatCard({ card }: { card: CommissionerFormatCard }) {
  const facts = card.facts ?? []
  const links = card.links ?? []
  const rounds = card.rookieRounds ?? 0
  const chips = Array.from({ length: Math.min(rounds, MAX_CHIPS) }, (_, i) => i + 1)
  return (
    <li className="af-dyn-format" data-testid="dynasty-format-card">
      <div className="af-dyn-format-head">
        <span className="af-dyn-format-icon" aria-hidden>
          <Landmark size={16} strokeWidth={2} />
        </span>
        <strong className="af-dyn-format-title">{card.title}</strong>
      </div>
      <p className="af-dyn-format-detail">{card.detail}</p>
      {facts.length ? (
        <dl className="af-dyn-format-facts">
          {facts.map((fact) => (
            <div key={fact.key} className="af-dyn-format-fact" data-fact={fact.key}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {chips.length ? (
        <ul className="af-dyn-format-chips" aria-label={card.picksLabel}>
          {chips.map((round) => (
            <li key={round} className="af-dyn-chip" data-round={round === 1 ? 'first' : 'later'} aria-hidden>
              R{round}
            </li>
          ))}
          {rounds > MAX_CHIPS ? (
            <li className="af-dyn-chip" data-round="later" aria-hidden>
              +{rounds - MAX_CHIPS}
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="af-dyn-format-links">
        <Link className="af-dyn-format-primary" href={card.href}>
          {card.action}
          <ArrowRight size={14} strokeWidth={2.2} aria-hidden />
        </Link>
        {links.map((link) =>
          link.href.startsWith('#') ? (
            <a key={link.key} className="af-dyn-format-link" href={link.href}>
              {link.label}
            </a>
          ) : (
            <Link key={link.key} className="af-dyn-format-link" href={link.href}>
              {link.label}
            </Link>
          ),
        )}
      </div>
    </li>
  )
}
