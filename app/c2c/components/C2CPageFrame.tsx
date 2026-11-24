import Link from 'next/link'
import type { ReactNode } from 'react'

const TONE = {
  neutral: 'border-[var(--line)] bg-[var(--surface)] text-[var(--text)]',
  campus: 'border-[var(--campus-line)] bg-[var(--campus-soft)] text-[var(--campus)]',
  canton: 'border-[var(--canton-line)] bg-[var(--canton-soft)] text-[var(--canton)]',
} as const

/**
 * The page frame every Campus to Canton screen draws: a back link to the league and the screen's title, over a body
 * up to 1152px wide (it was 768px, so a desktop showed half its width empty). One component for the five pages and
 * the harness, so they cannot drift apart again.
 */
export function C2CPageFrame({
  leagueId,
  title,
  tone = 'neutral',
  backTestId,
  children,
}: {
  leagueId: string
  title: string
  tone?: keyof typeof TONE
  backTestId?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className={`sticky top-0 z-20 border-b px-4 py-3 backdrop-blur ${TONE[tone]}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[13px] font-semibold text-[var(--accent)] hover:underline" data-testid={backTestId}>
            ← League
          </Link>
          <h1 className="truncate text-[14px] font-bold">{title}</h1>
          <span className="w-12" />
        </div>
      </header>
      {children}
    </div>
  )
}
