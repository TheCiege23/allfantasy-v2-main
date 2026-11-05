'use client'

import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { findLeagueHeroMessages } from '@/lib/core-app/messages/findLeagueHero'
import './find-league-hero.css'

/**
 * The Find a League header, restyled to the Find a League board (2026-11-05): a mono eyebrow over a
 * 30px title, translated. A client component because the page itself is a server component with
 * no language context. It reads the page's own theme variables (--text, --muted), the same ones the
 * filters and cards below it use, so it follows the site mode with them.
 */
export function FindLeagueHero() {
  const m = useMessages(findLeagueHeroMessages)
  return (
    <header className="fl-hero" data-testid="find-league-hero">
      <Link href="/" className="fl-hero-home">
        {m.home}
      </Link>
      <p className="fl-hero-eyebrow">{m.eyebrow}</p>
      <h1 className="fl-hero-title">{m.title}</h1>
      <p className="fl-hero-intro">{m.intro}</p>
    </header>
  )
}
