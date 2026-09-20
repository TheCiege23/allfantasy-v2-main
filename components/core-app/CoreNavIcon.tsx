import type { ReactNode } from 'react'

import type { CoreNavKey } from '@/components/core-app/AfCoreShell'

/**
 * One drawn icon per /core destination.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The nav carried a single unicode character per item (`NavItem.glyph`) and the
 * phone's More sheet was the only surface that rendered them at size: the
 * desktop column sets `.af-core .af-nav-glyph { display: none }` above 1081px,
 * and the tab bar shows six. So the glyphs were doing their most visible work in
 * the one place nobody had looked at them together — and together they do not
 * distinguish anything. Six of the nineteen are the same mark at different
 * fills:
 *
 *     ●  Player Finder      ◉  Live scores        ◎  Season Outlook
 *     ◆  War Room           ◇  Devy               ◈  My team / Devy (league) / Portfolio
 *
 * `◈` alone is THREE different destinations. A reader scanning the sheet for
 * "My team" has to read every label anyway, which is what an icon column is
 * supposed to save them from. Reported as "the more tab needs to have icons for
 * what they are".
 *
 * ── WHY DRAWN RATHER THAN `lucide-react` ────────────────────────────────────
 *
 * `lucide-react` is a dependency here and three comms components import from it,
 * so it was the obvious reach. It is the wrong one for this: nineteen named
 * imports land in the SHELL's bundle, which every /core screen pays for on first
 * paint, to draw a list that only opens on a tap. These are two paths each and
 * cost nothing to inline — the same argument `AfCrest` already makes for the
 * crest, in its own header.
 *
 * ⚠ EVERY ICON IS STROKE-ONLY ON `currentColor`, WITH NO FILL. The sheet's rows
 * change colour on `[data-active='true']` (`--accent` on `--accent-soft`), and a
 * hardcoded fill would leave the active row's icon sitting in the old colour —
 * the one thing on the row that did not respond to being selected.
 *
 * The `glyph` field is untouched: the tab bar and the ≤1080px nav strip still
 * render it, and this is additive rather than a migration.
 */

/** Shared geometry, so nineteen icons cannot drift into nineteen weights. */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/*
 * ⚠ A `Partial<Record<...>>`, NOT A `Record<...>`, AND THAT IS DELIBERATE.
 * A total record would force every future `CoreNavKey` to ship an icon in the
 * same commit that adds the key — a typecheck failure in a file nobody touched.
 * The fallback below is a real mark rather than a blank, so a missing entry
 * degrades to "a destination" instead of to a hole in the column.
 */
const PATHS: Partial<Record<CoreNavKey, ReactNode>> = {
  /* House. */
  home: (
    <>
      <path d="M3.5 10.2 12 3.5l8.5 6.7V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  /* A shirt — the roster, not a person: "my team" is eleven of them. */
  'my-team': (
    <>
      <path d="M8.5 3.5 5 5.2 3.5 9l2.8 1.2V20a1 1 0 0 0 1 1h9.4a1 1 0 0 0 1-1v-9.8L20.5 9 19 5.2l-3.5-1.7" />
      <path d="M8.5 3.5a3.5 3.5 0 0 0 7 0" />
    </>
  ),
  /* Two shields, nose to nose — head to head. */
  matchup: (
    <>
      <path d="M10 4 4 6.2v4.9c0 3.4 2.4 6.4 6 7.4Z" />
      <path d="M14 4l6 2.2v4.9c0 3.4-2.4 6.4-6 7.4Z" />
      <path d="M12 2.5v19" />
    </>
  ),
  /* Two arrows swapping — the ⇄ the nav already used, drawn. */
  trades: (
    <>
      <path d="M4 8.5h13" />
      <path d="M13.5 5 17 8.5 13.5 12" />
      <path d="M20 15.5H7" />
      <path d="M10.5 12 7 15.5 10.5 19" />
    </>
  ),
  /* Clock — a waiver is a deadline before it is anything else. */
  waivers: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.3 2" />
    </>
  ),
  /* Magnifying glass. The screen is called Player Finder. */
  players: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.4 15.4 20.5 20.5" />
    </>
  ),
  /* Crosshair — scouting a room. */
  'war-room': (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  /* A board with a marked cell. */
  'draft-hq': (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M9.5 9.5V20M15 9.5V20" />
      <path d="M5.2 12.4h2.6" />
    </>
  ),
  /* Briefcase — every league you hold. */
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.2a1.2 1.2 0 0 1 1.2-1.2h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M3 12.5h18" />
    </>
  ),
  /* Trophy. */
  career: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0Z" />
      <path d="M8 5.5H5.2v1.6A3.2 3.2 0 0 0 8.4 10.3M16 5.5h2.8v1.6a3.2 3.2 0 0 1-3.2 3.2" />
      <path d="M12 13v3.5M9 20h6M10 16.5h4v3.5h-4Z" />
    </>
  ),
  /* Bars, ascending. */
  rankings: (
    <>
      <path d="M4 20V13M9.3 20V8.5M14.7 20v-8M20 20V4.5" />
    </>
  ),
  /* Flag. */
  commissioner: (
    <>
      <path d="M6 21V3.8" />
      <path d="M6 4.6h11.8l-2.2 4 2.2 4H6Z" />
    </>
  ),
  /* Sliders — settings that belong to a league rather than an account. */
  tools: (
    <>
      <path d="M5 6.5h14M5 12h14M5 17.5h14" />
      <circle cx="9.2" cy="6.5" r="2" />
      <circle cx="15.4" cy="12" r="2" />
      <circle cx="8" cy="17.5" r="2" />
    </>
  ),
  /* Mortarboard — college prospects. */
  devy: (
    <>
      <path d="M2.8 9 12 5l9.2 4-9.2 4Z" />
      <path d="M6.6 10.6V15c0 1.5 2.4 2.8 5.4 2.8s5.4-1.3 5.4-2.8v-4.4" />
      <path d="M21.2 9v4.6" />
    </>
  ),
  /* The same cap, inside a league. */
  'devy-league': (
    <>
      <path d="M2.8 8 12 4.2 21.2 8 12 11.8Z" />
      <path d="M6.6 9.6V13c0 1.4 2.4 2.6 5.4 2.6s5.4-1.2 5.4-2.6V9.6" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  /* Calendar. */
  week: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8.5 3v4M15.5 3v4" />
    </>
  ),
  /* A line trending across a frame — the rest of the season. */
  'season-outlook': (
    <>
      <path d="M3.5 4.5v15h16" />
      <path d="M6.5 15.5 10.5 11l3 2.6 4.8-5.6" />
      <path d="M18.3 8h-3.2M18.3 8v3.2" />
    </>
  ),
  /* Share nodes. */
  share: (
    <>
      <circle cx="17.5" cy="5.8" r="2.6" />
      <circle cx="6.5" cy="12" r="2.6" />
      <circle cx="17.5" cy="18.2" r="2.6" />
      <path d="M8.9 10.7 15.1 7.1M8.9 13.3l6.2 3.6" />
    </>
  ),
  /* Bell. */
  notifications: (
    <>
      <path d="M6.2 10a5.8 5.8 0 0 1 11.6 0c0 3.3.9 5.2 1.7 6.2H4.5c.8-1 1.7-2.9 1.7-6.2Z" />
      <path d="M10 19.3a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  /* Broadcast — a dot with two arcs. */
  live: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </>
  ),
  'live-scores': (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </>
  ),
  /* Stacked cards. */
  'my-leagues': (
    <>
      <rect x="3.5" y="3.5" width="12" height="12" rx="2" />
      <path d="M8.5 20.5h10a2 2 0 0 0 2-2v-10" />
    </>
  ),
  /* A podium — points for, not record. */
  standings: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M9 20.5V8h6v12.5" />
      <path d="M3.5 20.5V13H9M15 20.5V16h5.5v4.5" />
    </>
  ),
  /* Refresh. */
  sync: (
    <>
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.4" />
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.6" />
      <path d="M20 4.5v4.1h-4.1M4 19.5v-4.1h4.1" />
    </>
  ),
  /* Shield — the Defense Hub. */
  'defense-hub': (
    <>
      <path d="M12 3.2 19.5 6v5.6c0 4.3-3 7.8-7.5 9.2-4.5-1.4-7.5-4.9-7.5-9.2V6Z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </>
  ),
  /* Hexagon with a key hole — the admin door. */
  admin: (
    <>
      <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z" />
      <circle cx="12" cy="10.8" r="2" />
      <path d="M12 12.8v3.4" />
    </>
  ),
}

/** A destination we hold no drawing for — a mark, never a blank column. */
const FALLBACK = (
  <>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.4" />
  </>
)

/**
 * ⚠ `aria-hidden`, ALWAYS. Every caller renders this beside the destination's
 * own text label, so an accessible name here is the label read twice.
 */
export function CoreNavIcon({ navKey, size = 18 }: { navKey: CoreNavKey; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      style={{ display: 'block' }}
      {...STROKE}
    >
      {PATHS[navKey] ?? FALLBACK}
    </svg>
  )
}

export default CoreNavIcon
