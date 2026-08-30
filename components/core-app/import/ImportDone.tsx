'use client'

/**
 * 6d — Done.
 *
 * ⚠ EVERY STAT HERE IS A REAL COUNT OR IT IS NOT SHOWN. Handoff rule 4 says the
 * cards are "exactly the counts from this specific import — never rounded or
 * approximated". Taken seriously that rule cuts both ways: a number this screen
 * cannot source is not allowed to appear as a plausible-looking figure either.
 *
 * What the import actually returns, and what each card is therefore bound to:
 *
 *   leagues imported     ← how many commits succeeded in THIS run. Real.
 *   teams in your league ← preview's `teamCount` / discovery's `totalTeams`. Real.
 *   seasons of history   ← readBackfillOutcome(...).seasonsImported. Real, and
 *                          NULLABLE by design — that helper exists precisely
 *                          because `.then()` resolving does not mean seasons were
 *                          written. Null ⇒ the card is omitted, not shown as 0.
 *   needs you            ← leagues from this run that came back needing your
 *                          confirmation or that failed. Real.
 *
 * ⚠ "PLAYERS ON YOUR ROSTERS" IS THE ONE THE HANDOFF ASKS FOR THAT IS NOT HERE.
 * The commit response carries no player count, and the preview's per-manager
 * `players[]` is every manager in the league, not the viewer's own team — summing
 * it would print the league's total roster spots under the words "your rosters".
 * Team count is the honest neighbouring fact and is shown instead.
 *
 * ⚠ AND THE PRIMARY BUTTON GOES TO /core, NOT A DASHBOARD. The handoff says "Go to
 * my dashboard" and leads to 3a. In this repo /core is the canonical home and
 * /dashboard is the surface it replaces, so sending someone who just finished an
 * import to /dashboard would land them on the retired screen.
 */

import Link from 'next/link'

import { ChimmyNote } from '@/components/core-app/import/ChimmyNote'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-progress.css'

export type ImportDoneStat = {
  key: string
  value: number
  label: string
  tone?: 'accent' | 'bad' | 'good'
}

export type ImportDoneProps = {
  providerLabel: string
  /** Where "open what I just imported" goes. Null when the run wrote nothing new. */
  leagueHref: string | null
  stats: ImportDoneStat[]
  /** The one thing that still needs the user, when this run produced one. */
  issue?: {
    title: string
    meta: string
    actionLabel: string
    onAction: () => void
  } | null
  /** Footnote for an idempotent replay, a partial run, etc. */
  noteText?: string | null
  /** "Import another" — stays available without derailing the primary path. */
  onImportAnother: () => void
  /*
   * Extra ghost actions that only exist in some outcomes — "Re-import and refresh"
   * after an idempotent replay, "Back to your leagues" when a discovered list is
   * still in hand. They belong in the SAME row as the primary pair: rendered as a
   * second `.af-done-actions` block underneath, they read as a stray third tier of
   * button with no heading.
   */
  extraActions?: React.ReactNode
  /** The Chimmy aside — omitted entirely when the caller has nothing true to say. */
  note?: React.ReactNode
  /** 6d's "Open in {Platform}" deep link, resolved through the league-links gate. */
  sourceLink?: { href: string; label: string } | null
}

export function ImportDone({
  providerLabel,
  leagueHref,
  stats,
  issue,
  noteText,
  onImportAnother,
  extraActions,
  note,
  sourceLink,
}: ImportDoneProps) {
  return (
    <div className="af-done">
      <div className="af-done-eyebrow">
        <span className="af-done-check" aria-hidden>
          ✓
        </span>
        <span className="af-label">{providerLabel} connected</span>
      </div>

      <h2 className="af-done-title">You&rsquo;re in. Here&rsquo;s what I found.</h2>

      {stats.length > 0 ? (
        <div className="af-done-stats">
          {stats.map((stat) => (
            <div key={stat.key} className="af-done-stat" data-tone={stat.tone ?? 'accent'}>
              <span className="af-done-num af-num">{stat.value}</span>
              <span className="af-done-stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {issue ? (
        <div className="af-done-issue">
          <span className="af-done-issue-mark" aria-hidden>
            !
          </span>
          <span className="af-done-issue-body">
            <span className="af-done-issue-title">{issue.title}</span>
            <span className="af-done-issue-meta">{issue.meta}</span>
          </span>
          <button type="button" className="af-btn af-done-alt" onClick={issue.onAction}>
            {issue.actionLabel}
          </button>
        </div>
      ) : null}

      {noteText ? <p className="af-done-note">{noteText}</p> : null}

      {note ? <ChimmyNote>{note}</ChimmyNote> : null}

      <div className="af-done-actions">
        {leagueHref ? (
          <Link href={leagueHref} className="af-btn af-done-go">
            Open your league
          </Link>
        ) : (
          <Link href="/core" className="af-btn af-done-go">
            Go to AllFantasy
          </Link>
        )}
        {/*
          Handoff rule 3: the secondary path stays available without derailing the
          primary one. "Add ESPN or Yahoo" in the capture is this same affordance —
          it returns you to the platform picker, which is what this does.
        */}
        <button type="button" className="af-btn af-btn--ghost af-done-alt" onClick={onImportAnother}>
          Add another platform
        </button>
        {/*
          6d: "Open in {Platform}" — always leaves for the native app, never attempts
          the fix in-product, and every href has passed that provider's exact-host
          HTTPS allowlist inside resolveSourceLink.

          ⚠ GHOST, NOT ACCENT. The handoff gives this the accent fill because there it
          is the CTA of the alert card — the one thing needing attention. Rendered
          standalone it became a SECOND full-width accent button stacked above
          "Open your league", so the screen had two competing primaries and the actual
          next step was the lower of the two. It belongs with the other secondary
          exits.
        */}
        {sourceLink ? (
          <a
            className="af-btn af-btn--ghost af-done-alt"
            href={sourceLink.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {sourceLink.label} &#8599;
          </a>
        ) : null}
        {extraActions}
      </div>
    </div>
  )
}

export default ImportDone
