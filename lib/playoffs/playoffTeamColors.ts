/**
 * Badge colours for a club, without shipping a logo.
 *
 * ⚠ NO LOGO FILES ON PURPOSE. Club marks are licensed; coloured initials are
 * legible at 52px, need no rights clearance, and cannot 404. The design handoff
 * makes the same call.
 *
 * ⚠ AND NO CLUB MAY RENDER UNSTYLED. The named map covers the clubs the design
 * specified, but a bracket is filled from live standings — a club that is not
 * in it (a relocation, a rebrand, another sport) must still get a stable,
 * readable pair rather than a default grey that reads as "missing data". The
 * fallback hashes the name into a fixed palette, so the same club is the same
 * colour on every render and every device.
 */

export type TeamColors = { bg: string; fg: string }

/** Keyed by the abbreviation the badge shows, from the design's palette. */
const NAMED: Record<string, TeamColors> = {
  NYY: { bg: "#10213b", fg: "#9fd4ff" },
  HOU: { bg: "#1a2e52", fg: "#ffb877" },
  CLE: { bg: "#123244", fg: "#ff6b6b" },
  BAL: { bg: "#3a1f0a", fg: "#ff9d4d" },
  SEA: { bg: "#0d2b2b", fg: "#7fd8d8" },
  KC: { bg: "#0d2347", fg: "#d4b877" },
  LAD: { bg: "#0d2740", fg: "#7fc4ff" },
  PHI: { bg: "#3a0f13", fg: "#ff8a94" },
  ATL: { bg: "#14213a", fg: "#ff9daf" },
  MIL: { bg: "#0d1f3d", fg: "#ffd166" },
  SD: { bg: "#2a2118", fg: "#ffcc4d" },
  NYM: { bg: "#0d1f42", fg: "#ff9d5c" },
  // Clubs outside the handoff's twelve, so a real 2026 field is never grey.
  TB: { bg: "#0d2136", fg: "#8fc7ff" },
  BOS: { bg: "#2d1114", fg: "#ff8a8a" },
  CHW: { bg: "#1a1d24", fg: "#cfd6e6" },
  TEX: { bg: "#0d1c3d", fg: "#9db9ff" },
  TOR: { bg: "#0d2547", fg: "#8ec5ff" },
  DET: { bg: "#0d2038", fg: "#9fd0ff" },
  MIN: { bg: "#0d2033", fg: "#8fd4b0" },
  CHC: { bg: "#0d1f44", fg: "#9db4ff" },
  ARI: { bg: "#2d1420", fg: "#ff9db4" },
  SF: { bg: "#301a0d", fg: "#ffb073" },
  STL: { bg: "#2d1116", fg: "#ff9aa5" },
  CIN: { bg: "#2d1114", fg: "#ff8f8f" },
}

/*
 * Neutral-dark backgrounds with light foregrounds — every pair here clears
 * readable contrast on the bracket's dark surface, so the hash cannot land on
 * an unreadable combination.
 */
const FALLBACK: TeamColors[] = [
  { bg: "#14213a", fg: "#9fd4ff" },
  { bg: "#1a2e52", fg: "#ffb877" },
  { bg: "#123244", fg: "#7fd8d8" },
  { bg: "#2a2118", fg: "#ffcc4d" },
  { bg: "#0d2347", fg: "#d4b877" },
  { bg: "#2d1116", fg: "#ff9aa5" },
  { bg: "#0d2b2b", fg: "#8fd4b0" },
  { bg: "#1e2450", fg: "#b4c8ff" },
]

/** A placeholder slot (`AL1`, `Winner S5`) is chrome, not a club. */
const PLACEHOLDER = /^(AL|NL|EAST|WEST)\d+$|^Winner\s+S\d+$|Champion$/i

export function isPlaceholderName(name: string | null | undefined): boolean {
  const text = String(name ?? "").trim()
  return !text || PLACEHOLDER.test(text)
}

export function teamColors(key: string | null | undefined): TeamColors {
  const text = String(key ?? "").trim()
  if (!text) return { bg: "rgba(255,255,255,.05)", fg: "#8f97bd" }
  if (isPlaceholderName(text)) return { bg: "rgba(255,255,255,.05)", fg: "#8f97bd" }

  const upper = text.toUpperCase()
  if (NAMED[upper]) return NAMED[upper]

  // Deterministic: same name → same colour, on every device and render.
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return FALLBACK[hash % FALLBACK.length]
}
