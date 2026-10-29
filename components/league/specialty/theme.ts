/**
 * Theme tokens for every specialty format, copied from each handoff mockup's root `style`
 * (design-refs/native-league-handoff/specialty-leagues/<format>/source/*Home.dc.html).
 * Pure data — safe to import from server or client code.
 */
export type SpecialtyFormat =
  | 'guillotine'
  | 'bigbrother'
  | 'survguil'
  | 'zombie'
  | 'salary'
  | 'devy'
  | 'c2c'
  | 'koth'
  | 'pirate'
  | 'tournament'

export interface SpecialtyTheme {
  acc: string
  acc2: string
  accInk: string
  /** Display font family (must be loaded by app/layout.tsx's Google Fonts link). */
  disp: string
  /** Title uses the display face (true) or Archivo 800 (false). */
  displayTitle: boolean
  /**
   * CSS `object-position` for the hero banner. Omitted = centred (the CSS default), which is right
   * for every format except one whose art package asks otherwise. Pirate's 1600×600 banner puts its
   * ship right of centre, and the package says crop it at `80% 50%`.
   */
  bannerPosition?: string
}

export const SPECIALTY_THEMES: Record<SpecialtyFormat, SpecialtyTheme> = {
  guillotine: { acc: '#e0402e', acc2: '#ff9a8a', accInk: '#fff', disp: 'Bebas Neue', displayTitle: true },
  bigbrother: { acc: '#3b82f6', acc2: '#9fd0ff', accInk: '#fff', disp: 'Archivo', displayTitle: false },
  survguil: { acc: '#e2672a', acc2: '#ffc08a', accInk: '#1a0a04', disp: 'Cinzel', displayTitle: true },
  zombie: { acc: '#8be03a', acc2: '#c8f08a', accInk: '#0a1a04', disp: 'Creepster', displayTitle: true },
  salary: { acc: '#3aa86a', acc2: '#9be3b8', accInk: '#04100a', disp: 'Archivo', displayTitle: false },
  devy: { acc: '#e8701e', acc2: '#ffb36a', accInk: '#1a0a04', disp: 'Archivo', displayTitle: false },
  c2c: { acc: '#c9a24a', acc2: '#f1d58a', accInk: '#1a1204', disp: 'Archivo', displayTitle: false },
  koth: { acc: '#8b5cf6', acc2: '#f2c94c', accInk: '#fff', disp: 'Cinzel', displayTitle: true },
  pirate: { acc: '#d4a017', acc2: '#ffe08a', accInk: '#1a1204', disp: 'Pirata One', displayTitle: true, bannerPosition: '80% 50%' },
  tournament: { acc: '#e8b84a', acc2: '#ffd98a', accInk: '#1a1204', disp: 'Archivo', displayTitle: false },
}

/** Public art root for a format: `/specialty/<format>/` (banner.svg, emblem.svg, icon-*.svg). */
export function specialtyAsset(format: SpecialtyFormat, file: string): string {
  return `/specialty/${format}/${file}`
}

/**
 * "1d 06:40" (days, hours:minutes) — the countdown format every specialty hero uses.
 * Under a day it is "06:40:12" (hours:minutes:seconds). Past or missing → null.
 */
export function formatSpecialtyCountdown(msRemaining: number | null | undefined): string | null {
  if (msRemaining == null || !Number.isFinite(msRemaining) || msRemaining <= 0) return null
  const totalSec = Math.floor(msRemaining / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return d > 0 ? `${d}d ${p(h)}:${p(m)}` : `${p(h)}:${p(m)}:${p(s)}`
}
