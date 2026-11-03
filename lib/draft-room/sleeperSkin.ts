/**
 * The draft room's lower half (player pool, queue, dock tabs) in the same flat, Sleeper-style
 * palette as the board above it: a dark navy surface, slate controls, white text, and position
 * colour as the only accent. The board went flat in 2026-10; these were still cyan glow and
 * gradient, so the two halves looked like different apps.
 *
 * Kept as plain class strings so a component opts in with one constant rather than repeating
 * hex codes that drift.
 */

/** Surface behind the pool and the dock - the board container's own colour. */
export const SKIN_PANEL = 'border border-white/[0.06] bg-[#0d1424]'
/** A toolbar strip inside a panel. */
export const SKIN_TOOLBAR = 'border-white/[0.06] bg-[#0d1424]'
/** Inputs, selects and idle pills - the board's empty-tile slate. */
export const SKIN_CONTROL = 'border-transparent bg-[#1d2236] text-white/85'
/** An idle toggle or pill. */
export const SKIN_PILL_IDLE = 'border-transparent bg-[#1d2236] text-white/60 hover:bg-[#2a2f45] hover:text-white'
/** A selected toggle or pill. */
export const SKIN_PILL_ACTIVE = 'border-transparent bg-white text-[#14172a]'
/** Card inside the dock (intel, queue). */
export const SKIN_CARD = 'border border-white/[0.06] bg-[#151b2e]'
/** Small caps section label. */
export const SKIN_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8b91a7]'
/** Focus ring shared by every control. */
export const SKIN_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30'
/** The primary Draft action, in Sleeper's teal. */
export const SKIN_DRAFT_BUTTON = 'border-transparent bg-[#00ceb8] text-[#0b1220] hover:brightness-110'
/** Text on a position-coloured fill. */
export const SKIN_ON_FILL = '#14172a'
