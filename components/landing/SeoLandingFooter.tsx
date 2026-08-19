'use client'

import Link from 'next/link'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { loginUrlWithIntent } from '@/lib/auth/auth-intent-resolver'

const FOOTER_SECTIONS = [
  {
    heading: 'Product',
    links: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/discover/leagues', label: 'Leagues' },
      { href: '/war-room', label: 'AF Legacy' },
      { href: '/ai/tools', label: 'AF Intelligence Hub' },
      { href: '/af-rankings', label: 'Rankings' },
      { href: '/find-league', label: 'Find a League' },
    ],
  },
  {
    heading: 'Sports',
    links: [
      { href: '/fantasy-football', label: 'Fantasy Football' },
      { href: '/fantasy-football/dynasty', label: 'Dynasty Football' },
      { href: '/fantasy-basketball', label: 'Fantasy Basketball' },
      { href: '/fantasy-baseball', label: 'Fantasy Baseball' },
      { href: '/fantasy-hockey', label: 'Fantasy Hockey' },
      { href: '/brackets', label: 'World Cup Pools' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/mission', label: 'Mission' },
      { href: '/no-gambling-policy', label: 'No Gambling Policy' },
      { href: '/ai-transparency', label: 'AI Transparency' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/contact', label: 'Contact' },
    ],
  },
]

export default function SeoLandingFooter() {
  const { t } = useLanguage()

  return (
    <footer
      className="border-t"
      style={{ borderColor: 'var(--border)', color: 'var(--muted2)' }}
    >
      {/* 3-column link grid */}
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.heading}>
              <h3
                className="mb-3 text-[11px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--muted)' }}
              >
                {section.heading}
              </h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors hover:opacity-100"
                      style={{ color: 'var(--muted2)', opacity: 0.85 }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Trust line + mission */}
      <div
        className="border-t px-4 py-6 sm:px-6 lg:px-8"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mx-auto max-w-6xl space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted2)', opacity: 0.75 }}>
            AllFantasy helps fantasy sports players manage leagues, analyze decisions, and build their fantasy legacy. We are not a sportsbook and do not offer gambling services.
          </p>
          <p className="text-xs leading-relaxed italic" style={{ color: 'var(--muted2)', opacity: 0.6 }}>
            "AllFantasy helps fantasy sports players draft smarter, manage better, and build a lasting legacy across every league, season, and sport — powered by AI, built for commissioners, and designed without gambling."
          </p>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className="border-t px-4 py-4 sm:px-6 lg:px-8"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 opacity-80 transition-opacity hover:opacity-100"
            aria-label="AllFantasy home"
          >
            <img
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy wordmark"
              className="nav-wordmark footer-logo h-[24px] w-auto object-contain"
            />
            <span className="text-xs">© {new Date().getFullYear()} AllFantasy.ai. All rights reserved.</span>
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/privacy" className="text-xs transition-colors hover:opacity-100" style={{ color: 'var(--muted)' }}>
              {t('landing.footer.privacy')}
            </Link>
            <Link href="/terms" className="text-xs transition-colors hover:opacity-100" style={{ color: 'var(--muted)' }}>
              {t('landing.footer.terms')}
            </Link>
            <Link href="/data-deletion" className="text-xs transition-colors hover:opacity-100" style={{ color: 'var(--muted)' }}>
              {t('landing.footer.dataDeletion')}
            </Link>
            <Link href={loginUrlWithIntent('/dashboard')} className="text-xs transition-colors hover:opacity-100" style={{ color: 'var(--muted)' }}>
              {t('common.signIn')}
            </Link>
            <LanguageToggle />
          </div>
        </div>
      </div>
    </footer>
  )
}
