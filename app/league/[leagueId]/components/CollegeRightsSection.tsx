'use client'

import type { CollegeRightsViewModel } from '@/lib/devy/collegeRightsBucket'

/**
 * Owned college (devy) rights on the roster tab. Rendered only when rights rows
 * exist - zero rows means the section is absent entirely. No links to /devy
 * pages (they are excluded from the prod build) and no value or points column:
 * college rights have no in-season scoring yet, and the label says so.
 */
export function CollegeRightsSection({ rights }: { rights: CollegeRightsViewModel }) {
  if (rights.entries.length === 0) return null
  return (
    <section
      className="rounded-xl border border-subtle bg-surface-muted p-4"
      data-testid="team-tab-college-rights-section"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">{rights.heading}</p>
        <span className="rounded-full border border-subtle px-2 py-0.5 text-[10px] text-muted">
          {rights.scoringNote}
        </span>
        <div className="h-px flex-1 bg-subtle" />
      </div>
      <ul className="space-y-1.5">
        {rights.entries.map((entry) => (
          <li
            key={entry.rightsId}
            className="flex items-center justify-between gap-3 rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-xs"
            data-testid={`college-rights-row-${entry.rightsId}`}
          >
            <div className="min-w-0">
              {entry.player ? (
                <>
                  <p className="truncate font-semibold text-primary">{entry.player.name}</p>
                  <p className="text-[11px] text-muted">
                    {entry.player.position} · {entry.player.school}
                  </p>
                </>
              ) : (
                <p className="italic text-muted">College player record unavailable</p>
              )}
            </div>
            <span className="shrink-0 rounded-full border border-subtle px-2 py-0.5 text-[10px] text-secondary">
              {entry.stateLabel}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
