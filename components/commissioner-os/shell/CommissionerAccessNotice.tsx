'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { shellText } from '@/lib/commissioner-os/i18n/shellCopy'

/**
 * What a signed-in non-commissioner sees instead of Commissioner OS.
 *
 * Deliberately a rendered notice rather than a `redirect()`. A redirect is right for an
 * unauthenticated visitor — there is a place to send them and a thing for them to do. This person
 * is legitimately signed in and has simply opened a tool that is not for their role; bouncing them
 * to another page with no explanation reads as a broken link, and the most likely next thing they
 * do is try again.
 *
 * ⚠ IT DESCRIBES THE RULE WITHOUT DESCRIBING THE LEAGUE. No league name, no count, no "you are a
 * member of X but not its commissioner" — the whole reason this gate exists is that Commissioner
 * OS carries commissioner-grade intelligence about other people, and an access-denied screen is a
 * poor place to start leaking a smaller version of it.
 *
 * Renders no shell chrome on purpose: the sidebar and header are part of the tool, and framing a
 * refusal inside the product's own navigation invites the reader to go looking for a way in.
 *
 * A client component only to read the reader's language (2026-10-06); it takes no data.
 */
export function CommissionerAccessNotice() {
  const { language } = useOptionalLanguage()
  const t = (english: string) => shellText(english, language)
  return (
    <main
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-standard)] p-6"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
      >
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          {t('Commissioner OS is for league commissioners')}
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t(
            'This workspace manages a league you run — its health, its managers, and the decisions that keep it going. Your account does not currently commission a league, so there is nothing here for it to manage.',
          )}
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('If you have just imported or created a league and expected to see it, it may still be syncing.')}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/core"
            className="focus-ring rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
            style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)' }}
          >
            {t('Back to my leagues')}
          </Link>
          <Link
            href="/import"
            className="focus-ring rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
            style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            {t('Import a league')}
          </Link>
        </div>
      </div>
    </main>
  )
}
