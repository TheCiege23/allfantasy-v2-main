'use client'

import Link from 'next/link'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { loginUrlWithIntent } from '@/lib/auth/auth-intent-resolver'

export default function SeoLandingFooter() {
  const { t } = useLanguage()

  return (
    <footer
      className="border-t py-6 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--muted2)' }}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3 opacity-80 transition-opacity hover:opacity-100"
          aria-label="AllFantasy home"
        >
          <img
            src="/af-logo-text.png"
            alt="AllFantasy"
            className="nav-wordmark footer-logo h-[28px] w-auto object-contain"
          />
          <span>© {new Date().getFullYear()} AllFantasy.ai. All rights reserved.</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer navigation">
          <Link
            href="/privacy"
            className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
          >
            Terms
          </Link>
          <Link
            href="/data-deletion"
            className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
          >
            {t('landing.footer.dataDeletion')}
          </Link>
          <Link
            href={loginUrlWithIntent('/dashboard')}
            className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
          >
            {t('common.signIn')}
          </Link>
          <Link
            href="/admin"
            className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
          >
            Admin
          </Link>
        </nav>
      </div>
    </footer>
  )
}
