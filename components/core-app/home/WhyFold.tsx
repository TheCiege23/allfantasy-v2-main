import type { ReactNode } from 'react'
import '@/components/core-app/home/af-home-guide.css'

/**
 * "Why it matters", closed until tapped (2026-11-24, the home's simplify pass).
 *
 * The /core home taught on every card: a paragraph under each decision kind, the season, the leagues
 * you run and the waiver calendar. Read once, they are useful; read on every visit, they were most of
 * the page's height on a phone. The lesson stays one tap away under the same words.
 */
export function WhyFold({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <details className={`af-hg-whyfold${className ? ` ${className}` : ''}`} data-testid="home-why">
      <summary>{label}</summary>
      <p>{children}</p>
    </details>
  )
}
