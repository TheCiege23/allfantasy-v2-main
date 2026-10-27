/**
 * Premium Create League v2 — visual design tokens.
 *
 * The spec asks for a dark cinematic base with glassmorphism panels and a
 * dynamic accent color that tints the whole page based on the selected
 * league type. Keeping this as a plain object (vs. CSS vars) so Tailwind
 * arbitrary-value classes can consume it inline.
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import {
  SPORT_VIDEO_PRIMARY,
  SPORT_VIDEO_FALLBACK,
  getSportPosterUrl,
} from '@/lib/create-league-v2/create-league-media-assets'

export type AccentTone = {
  /** Short label used in aria / tooltip. */
  label: string
  /** Tailwind color stop used for primary text / glow. */
  text: string
  /** Solid hex used in gradient stops. */
  hex: string
  /** Secondary hex for the gradient tail. */
  hexSoft: string
  /** Ring / border color for selected cards. */
  ring: string
  /** Glow shadow for selected cards (tailwind-compatible arbitrary shadow). */
  glow: string
}

export const ACCENTS: Record<LeagueTypeId, AccentTone> = {
  pirate: {
    label: 'Treasure Gold',
    text: 'text-amber-200',
    hex: '#F7C865',
    hexSoft: '#12384B',
    ring: 'ring-amber-300/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(247,200,101,0.55)]',
  },
  redraft: {
    label: 'Electric Blue',
    text: 'text-sky-300',
    hex: '#3B82F6',
    hexSoft: '#1E3A8A',
    ring: 'ring-sky-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(59,130,246,0.55)]',
  },
  dynasty: {
    label: 'Royal Violet',
    text: 'text-violet-300',
    hex: '#8B5CF6',
    hexSoft: '#4C1D95',
    ring: 'ring-violet-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(139,92,246,0.55)]',
  },
  keeper: {
    label: 'Amber Gold',
    text: 'text-amber-300',
    hex: '#F59E0B',
    hexSoft: '#78350F',
    ring: 'ring-amber-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(245,158,11,0.55)]',
  },
  best_ball: {
    label: 'Cyan',
    text: 'text-cyan-300',
    hex: '#06B6D4',
    hexSoft: '#164E63',
    ring: 'ring-cyan-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(6,182,212,0.55)]',
  },
  survivor: {
    label: 'Emerald',
    text: 'text-emerald-300',
    hex: '#10B981',
    hexSoft: '#064E3B',
    ring: 'ring-emerald-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(16,185,129,0.55)]',
  },
  guillotine: {
    label: 'Crimson',
    text: 'text-rose-300',
    hex: '#F43F5E',
    hexSoft: '#881337',
    ring: 'ring-rose-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(244,63,94,0.55)]',
  },
  salary_cap: {
    label: 'Emerald Gold',
    text: 'text-emerald-200',
    hex: '#34D399',
    hexSoft: '#065F46',
    ring: 'ring-emerald-300/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(52,211,153,0.55)]',
  },
  tournament: {
    label: 'Amber',
    text: 'text-orange-300',
    hex: '#F97316',
    hexSoft: '#7C2D12',
    ring: 'ring-orange-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(249,115,22,0.55)]',
  },
  devy: {
    label: 'Teal',
    text: 'text-teal-300',
    hex: '#14B8A6',
    hexSoft: '#134E4A',
    ring: 'ring-teal-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(20,184,166,0.55)]',
  },
  c2c: {
    label: 'Sky',
    text: 'text-sky-200',
    hex: '#0EA5E9',
    hexSoft: '#0C4A6E',
    ring: 'ring-sky-300/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(14,165,233,0.55)]',
  },
  zombie: {
    label: 'Toxic Green',
    text: 'text-lime-300',
    hex: '#84CC16',
    hexSoft: '#365314',
    ring: 'ring-lime-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(132,204,22,0.55)]',
  },
  big_brother: {
    label: 'Fuchsia',
    text: 'text-fuchsia-300',
    hex: '#D946EF',
    hexSoft: '#701A75',
    ring: 'ring-fuchsia-400/60',
    glow: 'shadow-[0_0_40px_-8px_rgba(217,70,239,0.55)]',
  },
}

export const DEFAULT_ACCENT: AccentTone = ACCENTS.redraft

export function getAccent(leagueType: LeagueTypeId | null | undefined): AccentTone {
  if (!leagueType) return DEFAULT_ACCENT
  return ACCENTS[leagueType] ?? DEFAULT_ACCENT
}

/** Page background — layered cinematic mesh with deep galaxy vignette. */
export const PAGE_BG_CLASS =
  'min-h-screen bg-[#060a18] bg-[radial-gradient(ellipse_120%_60%_at_50%_-15%,rgba(30,60,140,0.45),transparent_70%),radial-gradient(ellipse_80%_50%_at_80%_100%,rgba(15,25,80,0.3),transparent_60%),radial-gradient(ellipse_60%_40%_at_20%_80%,rgba(10,20,60,0.25),transparent_50%)] text-white'

/** Glass surface — frosted panel with layered depth and subtle inner shine. */
export const GLASS_SURFACE =
  'rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] backdrop-blur-2xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)]'

/** Softer surface for inner sub-panels with subtle depth. */
export const GLASS_INNER =
  'rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'

/** Ambient glow overlay — position behind content, tinted by accent hex. */
export function ambientGlowStyle(hex: string): React.CSSProperties {
  return {
    background: `radial-gradient(600px circle at 50% 0%, ${hex}12, transparent 70%)`,
    pointerEvents: 'none' as const,
  }
}

// ── Media registry for videos + posters ─────────────────────────────
// Every file path below resolves to /public/<file>. Missing files fall back gracefully via onError.

export type MediaAsset = {
  video: string
  poster?: string
  fallback?: string
}

/** Per-sport ambient loop — packaged `/media/create-league/sports/videos` first, legacy root mp4 as fallback. */
export const SPORT_MEDIA: Record<string, MediaAsset> = {
  NFL: {
    video: SPORT_VIDEO_PRIMARY.NFL,
    poster: getSportPosterUrl('NFL'),
    fallback: SPORT_VIDEO_FALLBACK.NFL,
  },
  NBA: {
    video: SPORT_VIDEO_PRIMARY.NBA,
    poster: getSportPosterUrl('NBA'),
    fallback: SPORT_VIDEO_FALLBACK.NBA,
  },
  MLB: {
    video: SPORT_VIDEO_PRIMARY.MLB,
    poster: getSportPosterUrl('MLB'),
    fallback: SPORT_VIDEO_FALLBACK.MLB,
  },
  NHL: {
    video: SPORT_VIDEO_PRIMARY.NHL,
    poster: getSportPosterUrl('NHL'),
    fallback: SPORT_VIDEO_FALLBACK.NHL,
  },
  NCAAF: {
    video: SPORT_VIDEO_PRIMARY.NCAAF,
    poster: getSportPosterUrl('NCAAF'),
    fallback: SPORT_VIDEO_FALLBACK.NCAAF,
  },
  NCAAB: {
    video: SPORT_VIDEO_PRIMARY.NCAAB,
    poster: getSportPosterUrl('NCAAB'),
    fallback: SPORT_VIDEO_FALLBACK.NCAAB,
  },
  SOCCER: {
    video: SPORT_VIDEO_PRIMARY.SOCCER,
    poster: getSportPosterUrl('SOCCER'),
    fallback: SPORT_VIDEO_FALLBACK.SOCCER,
  },
}

/**
 * Per-league-type hero — prefers `/media/create-league/concept/videos`, then legacy intros.
 */
export const LEAGUE_TYPE_MEDIA: Record<string, MediaAsset> = {
  redraft: {
    video: '/media/create-league/concept/videos/Redraft.mp4',
    poster: '/media/create-league/concept/thumbnails/Redraft.png',
    fallback: '/media/league-intros/redraft-league-intro.mp4',
  },
  dynasty: {
    video: '/media/create-league/concept/videos/Dynasty.mp4',
    poster: '/media/create-league/concept/thumbnails/Dynasty.png',
    fallback: '/league-type-dynasty-intro.mp4',
  },
  keeper: {
    video: '/media/create-league/concept/videos/Keeper.mp4',
    poster: '/media/create-league/concept/thumbnails/Keeper.png',
    fallback: '/league-type-keeper-intro.mp4',
  },
  best_ball: {
    video: '/media/create-league/concept/videos/BastBall.mp4',
    poster: '/media/create-league/concept/thumbnails/BastBall.png',
    fallback: '/league-type-best-ball-intro.mp4',
  },
  idp: {
    video: '/media/create-league/concept/videos/IDP.mp4',
    poster: '/media/create-league/concept/thumbnails/IDP.png',
    fallback: '/league-type-idp-intro.mp4',
  },
  salary_cap: {
    video: '/media/create-league/concept/videos/Salary%20Cap.mp4',
    poster: '/media/create-league/concept/thumbnails/Salary%20Cap.png',
    fallback: '/league-type-salary-cap-intro.mp4',
  },
  devy: {
    video: '/media/create-league/concept/videos/Devy.mp4',
    poster: '/media/create-league/concept/thumbnails/Devy.png',
    fallback: '/league-type-devy-intro.mp4',
  },
  c2c: {
    video: '/media/create-league/concept/videos/C2C.mp4',
    poster: '/media/create-league/concept/thumbnails/C2C.png',
    fallback: '/league-type-c2c-intro.mp4',
  },
  guillotine: {
    video: '/media/create-league/concept/videos/Guillotine.mp4',
    poster: '/media/create-league/concept/thumbnails/Guillotine.png',
    fallback: '/league-type-guillotine-intro.mp4',
  },
  zombie: {
    video: '/media/create-league/concept/videos/Zombie.mp4',
    poster: '/media/create-league/concept/thumbnails/Zombie.png',
    fallback: '/league-type-zombie-intro.mp4',
  },
  survivor: {
    video: '/media/create-league/concept/videos/Survivor.mp4',
    poster: '/media/create-league/concept/thumbnails/Survivor.png',
    fallback: '/league-type-survivor-intro.mp4',
  },
  tournament: {
    video: '/media/create-league/concept/videos/Tournament.mp4',
    poster: '/media/create-league/concept/thumbnails/Tournament.png',
    fallback: '/league-type-tournament.mp4',
  },
  big_brother: {
    video: '/media/create-league/concept/videos/Big%20Brother.mp4',
    poster: '/media/create-league/concept/thumbnails/Big%20Brother.png',
    fallback: '/league-type-big-brother-intro.mp4',
  },
}
