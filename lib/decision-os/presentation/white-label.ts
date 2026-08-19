/**
 * Decision OS — Phase 7.0 IPM White-Label Layer.
 *
 * Pure lookup configurations mapping IPM semantic tokens to licensee design systems.
 * No provider-specific data logic — only visual token mappings.
 * The IPM produces token names; frontends resolve actual CSS values via their theme.
 */

import type { WhiteLabelConfig, ColorToken, IconToken } from './types'

// ── Default configs by platform ───────────────────────────────────────────────

export const WHITE_LABEL_CONFIGS: Record<string, WhiteLabelConfig> = {
  default: {
    platform: 'default',
    displayName: 'AllFantasy Intelligence',
    colorTokenMap: {},   // identity mapping — IPM tokens map to themselves
    iconTokenMap: {},
    labelOverrides: {},
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: true,
      behavioralPatterns: true,
      companyIntelligence: true,
    },
  },

  sleeper: {
    platform: 'sleeper',
    displayName: 'Sleeper Intelligence',
    colorTokenMap: {
      success:         'sleeper-emerald',
      healthy:         'sleeper-green',
      positive:        'sleeper-teal',
      warning:         'sleeper-yellow',
      danger:          'sleeper-orange',
      critical:        'sleeper-red',
      neutral:         'sleeper-gray',
      accent:          'sleeper-blue',
      benchmark_above: 'sleeper-emerald',
      benchmark_equal: 'sleeper-blue',
      benchmark_below: 'sleeper-red',
      surface:         'sleeper-surface',
      surface_elevated:'sleeper-elevated',
      muted:           'sleeper-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      engagement: 'Activity Score',
      recommendations: 'Actions',
    },
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: true,
      behavioralPatterns: true,
      companyIntelligence: false,
    },
  },

  yahoo: {
    platform: 'yahoo',
    displayName: 'Yahoo Fantasy Intelligence',
    colorTokenMap: {
      success:         'yahoo-purple-light',
      healthy:         'yahoo-purple',
      positive:        'yahoo-blue',
      warning:         'yahoo-gold',
      danger:          'yahoo-orange',
      critical:        'yahoo-red',
      neutral:         'yahoo-gray',
      accent:          'yahoo-purple',
      benchmark_above: 'yahoo-purple-light',
      benchmark_equal: 'yahoo-blue',
      benchmark_below: 'yahoo-red',
      surface:         'yahoo-surface',
      surface_elevated:'yahoo-elevated',
      muted:           'yahoo-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      retentionRisk: 'Member Risk',
      commissionerWorkload: 'Commissioner Tasks',
    },
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: false,
      behavioralPatterns: false,
      companyIntelligence: false,
    },
  },

  espn: {
    platform: 'espn',
    displayName: 'ESPN Fantasy Intelligence',
    colorTokenMap: {
      success:         'espn-green',
      healthy:         'espn-green-light',
      positive:        'espn-blue-light',
      warning:         'espn-gold',
      danger:          'espn-orange',
      critical:        'espn-red',
      neutral:         'espn-gray',
      accent:          'espn-red',
      benchmark_above: 'espn-green',
      benchmark_equal: 'espn-blue',
      benchmark_below: 'espn-red',
      surface:         'espn-surface',
      surface_elevated:'espn-elevated',
      muted:           'espn-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      healthScore: 'League Score',
      engagement: 'Participation',
    },
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: false,
      behavioralPatterns: false,
      companyIntelligence: false,
    },
  },

  fantrax: {
    platform: 'fantrax',
    displayName: 'Fantrax Intelligence',
    colorTokenMap: {
      success:         'fantrax-green',
      healthy:         'fantrax-teal',
      positive:        'fantrax-blue',
      warning:         'fantrax-yellow',
      danger:          'fantrax-orange',
      critical:        'fantrax-red',
      neutral:         'fantrax-gray',
      accent:          'fantrax-blue',
      benchmark_above: 'fantrax-green',
      benchmark_equal: 'fantrax-blue',
      benchmark_below: 'fantrax-red',
      surface:         'fantrax-surface',
      surface_elevated:'fantrax-elevated',
      muted:           'fantrax-muted',
    },
    iconTokenMap: {},
    labelOverrides: {},
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: true,
      behavioralPatterns: true,
      companyIntelligence: true,
    },
  },

  cbs: {
    platform: 'cbs',
    displayName: 'CBS Fantasy Intelligence',
    colorTokenMap: {
      success:         'cbs-green',
      healthy:         'cbs-teal',
      positive:        'cbs-blue',
      warning:         'cbs-yellow',
      danger:          'cbs-orange',
      critical:        'cbs-red',
      neutral:         'cbs-gray',
      accent:          'cbs-blue',
      benchmark_above: 'cbs-green',
      benchmark_equal: 'cbs-blue',
      benchmark_below: 'cbs-red',
      surface:         'cbs-surface',
      surface_elevated:'cbs-elevated',
      muted:           'cbs-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      retentionRisk: 'Renewal Risk',
    },
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: false,
      behavioralPatterns: false,
      companyIntelligence: true,
    },
  },

  draftkings: {
    platform: 'draftkings',
    displayName: 'DraftKings Intelligence',
    colorTokenMap: {
      success:         'dk-green',
      healthy:         'dk-green-light',
      positive:        'dk-teal',
      warning:         'dk-gold',
      danger:          'dk-orange',
      critical:        'dk-red',
      neutral:         'dk-gray',
      accent:          'dk-gold',
      benchmark_above: 'dk-green',
      benchmark_equal: 'dk-gold',
      benchmark_below: 'dk-red',
      surface:         'dk-surface',
      surface_elevated:'dk-elevated',
      muted:           'dk-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      engagement: 'Contest Activity',
    },
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: false,
      behavioralPatterns: true,
      companyIntelligence: true,
    },
  },

  fanduel: {
    platform: 'fanduel',
    displayName: 'FanDuel Intelligence',
    colorTokenMap: {
      success:         'fd-blue-light',
      healthy:         'fd-blue',
      positive:        'fd-teal',
      warning:         'fd-yellow',
      danger:          'fd-orange',
      critical:        'fd-red',
      neutral:         'fd-gray',
      accent:          'fd-blue',
      benchmark_above: 'fd-blue-light',
      benchmark_equal: 'fd-blue',
      benchmark_below: 'fd-red',
      surface:         'fd-surface',
      surface_elevated:'fd-elevated',
      muted:           'fd-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      engagement: 'Lineup Activity',
    },
    sectionVisibility: {
      benchmarkComparison: true,
      archetypeClassification: false,
      behavioralPatterns: false,
      companyIntelligence: true,
    },
  },

  underdog: {
    platform: 'underdog',
    displayName: 'Underdog Intelligence',
    colorTokenMap: {
      success:         'ud-green',
      healthy:         'ud-teal',
      positive:        'ud-blue',
      warning:         'ud-yellow',
      danger:          'ud-orange',
      critical:        'ud-red',
      neutral:         'ud-gray',
      accent:          'ud-orange',
      benchmark_above: 'ud-green',
      benchmark_equal: 'ud-blue',
      benchmark_below: 'ud-red',
      surface:         'ud-surface',
      surface_elevated:'ud-elevated',
      muted:           'ud-muted',
    },
    iconTokenMap: {},
    labelOverrides: {
      engagement: 'Draft Activity',
    },
    sectionVisibility: {
      benchmarkComparison: false,
      archetypeClassification: false,
      behavioralPatterns: true,
      companyIntelligence: true,
    },
  },
}

// ── Token resolution ──────────────────────────────────────────────────────────

/**
 * Resolves an IPM ColorToken to the licensee's design-system token name.
 * Falls back to the original IPM token if no override is configured.
 * The IPM never resolves to hex/CSS — that is the frontend's responsibility.
 */
export function resolveColorToken(token: ColorToken, config: WhiteLabelConfig): string {
  return config.colorTokenMap[token] ?? token
}

/**
 * Resolves an IPM IconToken to the licensee's icon identifier.
 * Falls back to the original IPM token if no override is configured.
 */
export function resolveIconToken(token: IconToken, config: WhiteLabelConfig): string {
  return config.iconTokenMap[token] ?? token
}

/**
 * Gets a white-label config by platform name.
 * Falls back to 'default' for unknown platforms.
 */
export function getWhiteLabelConfig(platform: string): WhiteLabelConfig {
  return WHITE_LABEL_CONFIGS[platform] ?? WHITE_LABEL_CONFIGS['default']!
}

/**
 * Returns true if a given section is visible under this white-label config.
 * Defaults to true when no explicit configuration is set.
 */
export function isSectionVisible(
  section: keyof NonNullable<WhiteLabelConfig['sectionVisibility']>,
  config: WhiteLabelConfig,
): boolean {
  const v = config.sectionVisibility[section]
  return v !== false  // undefined → visible
}
