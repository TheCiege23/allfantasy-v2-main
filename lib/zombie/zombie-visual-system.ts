/**
 * Zombie flagship homepage — sport-aware atmosphere, universe tiers, roles, and item accents.
 * Uses `normalizeToSupportedSport` for safe fallbacks (see `lib/sport-scope.ts`).
 */
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

type ZombieUniverseTier = 'gamma' | 'beta' | 'alpha' | 'unknown'

export type ZombieItemKind = 'serum' | 'weapon' | 'bomb' | 'ambush'

const TIER_ORDER: ZombieUniverseTier[] = ['gamma', 'beta', 'alpha']

export function resolveZombieUniverseTier(input: {
  tierLabel?: string | null
  name?: string | null
  tierTheme?: string | null
} | null): ZombieUniverseTier {
  if (!input) return 'unknown'
  const blob = `${input.tierLabel ?? ''} ${input.name ?? ''} ${input.tierTheme ?? ''}`.toLowerCase()
  for (const t of TIER_ORDER) {
    if (blob.includes(t)) return t
  }
  return 'unknown'
}

/** Display label for tier chip (Gamma / Beta / Alpha). */
export function formatZombieTierLabel(tier: ZombieUniverseTier, fallbackName?: string | null): string {
  if (tier !== 'unknown') return tier.charAt(0).toUpperCase() + tier.slice(1)
  if (fallbackName?.trim()) return fallbackName.trim()
  return 'Universe tier'
}

/**
 * Tailwind classes for universe tier badges on cards / hero.
 * Gamma = containment green, Beta = outbreak cyan, Alpha = war-room gold.
 */
export function zombieTierBadgeClasses(tier: ZombieUniverseTier): string {
  switch (tier) {
    case 'gamma':
      return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.18)]'
    case 'beta':
      return 'border-cyan-500/35 bg-cyan-500/10 text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.14)]'
    case 'alpha':
      return 'border-amber-500/45 bg-amber-500/15 text-amber-100 shadow-[0_0_26px_rgba(245,158,11,0.22)]'
    default:
      return 'border-white/12 bg-white/[0.06] text-white/75'
  }
}

type ZombieSportHeroPreset = {
  sport: SupportedSport
  label: string
  tagline: string
  /** Extra gradient layers on top of base shell (Tailwind classes). */
  overlayClass: string
}

function overlayFor(sport: SupportedSport): Omit<ZombieSportHeroPreset, 'sport'> {
  const base = {
    NFL: {
      label: 'Gridiron outbreak',
      tagline: 'Ruined stadium · floodlights · toxic fog',
      overlayClass:
        'bg-[radial-gradient(ellipse_85%_55%_at_15%_0%,rgba(74,222,128,0.16),transparent_55%),radial-gradient(ellipse_70%_45%_at_92%_65%,rgba(239,68,68,0.09),transparent_50%),linear-gradient(180deg,rgba(6,8,16,0.88),rgba(3,4,10,0.96))]',
    },
    NBA: {
      label: 'Arena blackout',
      tagline: 'Post-apocalyptic arena · scoreboard glow',
      overlayClass:
        'bg-[radial-gradient(ellipse_80%_50%_at_50%_-5%,rgba(251,191,36,0.1),transparent_50%),radial-gradient(ellipse_60%_40%_at_85%_80%,rgba(56,189,248,0.1),transparent_48%),linear-gradient(180deg,rgba(8,10,18,0.9),rgba(4,5,12,0.97))]',
    },
    MLB: {
      label: 'Ballpark dusk',
      tagline: 'Abandoned yard · flickering towers',
      overlayClass:
        'bg-[radial-gradient(ellipse_75%_48%_at_20%_15%,rgba(74,222,128,0.11),transparent_52%),radial-gradient(ellipse_55%_35%_at_90%_30%,rgba(251,191,36,0.08),transparent_45%),linear-gradient(180deg,rgba(5,7,14,0.9),rgba(3,4,10,0.96))]',
    },
    NHL: {
      label: 'Frozen rink',
      tagline: 'Icy arena · eerie boards · red warning lamps',
      overlayClass:
        'bg-[radial-gradient(ellipse_70%_45%_at_12%_60%,rgba(56,189,248,0.12),transparent_50%),radial-gradient(ellipse_65%_40%_at_88%_20%,rgba(239,68,68,0.08),transparent_48%),linear-gradient(185deg,rgba(5,8,18,0.92),rgba(2,4,12,0.98))]',
    },
    NCAAF: {
      label: 'Campus gridiron',
      tagline: 'Stadium apocalypse · marching lights gone cold',
      overlayClass:
        'bg-[radial-gradient(ellipse_80%_50%_at_25%_5%,rgba(74,222,128,0.13),transparent_54%),radial-gradient(ellipse_50%_35%_at_80%_75%,rgba(220,38,38,0.08),transparent_46%),linear-gradient(180deg,rgba(7,9,16,0.9),rgba(4,5,10,0.97))]',
    },
    NCAAB: {
      label: 'Campus hardwood',
      tagline: 'Empty arena · lone buzzer · haze over the court',
      overlayClass:
        'bg-[radial-gradient(ellipse_78%_48%_at_50%_0%,rgba(59,130,246,0.1),transparent_52%),radial-gradient(ellipse_60%_40%_at_15%_85%,rgba(74,222,128,0.09),transparent_48%),linear-gradient(180deg,rgba(6,8,16,0.9),rgba(3,4,10,0.96))]',
    },
    SOCCER: {
      label: 'Pitch under quarantine',
      tagline: 'Floodlights · drifting mist · stands gone silent',
      overlayClass:
        'bg-[radial-gradient(ellipse_82%_52%_at_18%_20%,rgba(74,222,128,0.14),transparent_56%),radial-gradient(ellipse_55%_38%_at_92%_70%,rgba(34,197,94,0.08),transparent_46%),linear-gradient(180deg,rgba(5,7,15,0.9),rgba(3,4,10,0.97))]',
    },
  }
  return base[sport]
}

export function getZombieSportHeroPreset(sport: string | null | undefined): ZombieSportHeroPreset {
  const s = normalizeToSupportedSport(sport)
  const o = overlayFor(s)
  return { sport: s, ...o }
}

/** Accent classes for item chips / quick actions. */
export function zombieItemKindClasses(kind: ZombieItemKind): { ring: string; text: string; bg: string } {
  switch (kind) {
    case 'serum':
      return {
        ring: 'ring-teal-400/40',
        text: 'text-teal-100',
        bg: 'bg-teal-500/15 border-teal-400/25',
      }
    case 'weapon':
      return {
        ring: 'ring-amber-400/35',
        text: 'text-amber-100',
        bg: 'bg-amber-500/12 border-amber-400/28',
      }
    case 'bomb':
      return {
        ring: 'ring-red-500/50',
        text: 'text-red-100',
        bg: 'bg-red-600/18 border-red-500/35',
      }
    case 'ambush':
      return {
        ring: 'ring-violet-500/40',
        text: 'text-violet-100',
        bg: 'bg-violet-600/15 border-violet-400/30',
      }
  }
}

/** Row / card tint hints for role identity (team rows, standings). */
export function zombieRoleAccentClasses(statusRaw: string): { border: string; glow: string } {
  const s = statusRaw.toLowerCase()
  if (s.includes('whisperer')) {
    return {
      border: 'border-fuchsia-500/25',
      glow: 'shadow-[inset_0_0_0_1px_rgba(217,70,239,0.15)]',
    }
  }
  if (s.includes('zombie')) {
    return {
      border: 'border-lime-500/30',
      glow: 'shadow-[0_0_12px_rgba(132,204,22,0.12)]',
    }
  }
  if (s.includes('survivor') || s.includes('revived')) {
    return {
      border: 'border-sky-500/25',
      glow: 'shadow-[inset_0_1px_0_rgba(56,189,248,0.12)]',
    }
  }
  return { border: 'border-white/10', glow: '' }
}
