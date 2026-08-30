/**
 * The Chimmy aside the handoff places on every Importing and Done screen.
 *
 * ⚠ IT TAKES ITS LINE FROM THE CALLER, AND THE CALLER MUST HAVE DERIVED IT.
 * The design's examples are analytical claims — "you have Kincaid on three of
 * these four teams", "Kincaid is the fix, he's worth +15.4 in that slot". Nothing
 * in the import flow can compute either: the cross-roster read happens after the
 * leagues are written, and the projection delta is a different subsystem
 * entirely. Hardcoding those sentences would put a fabricated insight on the one
 * screen whose entire promise is that the numbers are real.
 *
 * So this component carries no copy of its own. Every caller passes a line it can
 * stand behind from state it actually holds — a count it just received, or a
 * property of the run in progress. If a surface has nothing true to say, it
 * renders no aside rather than an invented one.
 *
 * The avatar is the existing `/images/chimmy-avatar.png` already used by
 * LandingV4 and the assistant panel — not the copy bundled with the handoff,
 * which would have been a second file of the same image.
 */

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-progress.css'

export function ChimmyNote({ children }: { children: React.ReactNode }) {
  return (
    <aside className="af-chimmy-note">
      {/*
        A plain <img>, not next/image: this is a 32px avatar inside a component
        that renders in both a client screen and a server one, and the optimiser
        buys nothing at this size.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="af-chimmy-avatar" src="/images/chimmy-avatar.png" alt="" aria-hidden />
      <div className="af-chimmy-body">
        <span className="af-label af-chimmy-name">Chimmy</span>
        <p className="af-chimmy-text">{children}</p>
      </div>
    </aside>
  )
}

export default ChimmyNote
