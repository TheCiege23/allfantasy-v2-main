/**
 * Per-league Zombie rule overrides, stored at `League.settings.zombie_rules`.
 *
 * 🛑 THE LIVE ENGINES READ RULES PER SPORT, NOT PER LEAGUE. `getZombieRulesForSport` resolves
 * `ZombieRulesTemplate` (a row per sport, which nothing seeds) over `sportRulesConfig`, so before
 * this a commish had nowhere to change a bash margin — the old Combat/Items panels showed numbers
 * and saved nothing. This layer sits ON TOP of the sport rules: an absent key means "the sport's
 * number", so a league that never opens the editor plays exactly as before.
 *
 * Pure. The resolver that merges it is `getZombieRulesForLeague` in ./zombieRules.ts; the editor is
 * the Specialty tab (app/api/leagues/[leagueId]/specialty-settings/handler.ts).
 */

export const ZOMBIE_RULES_SETTINGS_KEY = 'zombie_rules'

export const WHISPERER_DEFEAT_RULES = [
  'new_whisperer_emerges',
  'whisperer_demoted_to_zombie',
  'season_escalation',
  'commissioner_decides',
] as const
export type WhispererDefeatRule = (typeof WHISPERER_DEFEAT_RULES)[number]

/** Every key optional: a missing key falls through to the sport's rule. */
export type ZombieRuleOverrides = {
  bashingThreshold?: number
  maulingThreshold?: number
  /** Hours a Survivor who bashed another Survivor has to choose spare or infect. Sport default 48. */
  bashDecisionHours?: number
  weaponShieldThreshold?: number
  weaponAmbushThreshold?: number
  /** False stops the 5-win-streak bomb from being granted. Default true. */
  bombEnabled?: boolean
  reviveThreshold?: number
  serumMaxHold?: number
  /** What happens when the Whisperer is mauled. Default commissioner_decides. */
  whispererDefeatRule?: WhispererDefeatRule
}

/*
 * Margins and weapon scores are in the SPORT's points: NBA weeks run in the hundreds and its own lines
 * are 128/211 to bash/maul and 900/1,050 for the knife/bow (sportRulesConfig.ts). The caps leave room
 * above every sport's line; they only stop a typo, never a sport.
 */
export const ZOMBIE_RULE_LIMITS = {
  bashingThreshold: [1, 2000],
  maulingThreshold: [1, 2000],
  bashDecisionHours: [12, 96],
  weaponShieldThreshold: [1, 5000],
  weaponAmbushThreshold: [1, 5000],
  reviveThreshold: [1, 10],
  serumMaxHold: [1, 20],
} as const

type NumericKey = keyof typeof ZOMBIE_RULE_LIMITS

function validNumber(key: NumericKey, v: unknown): v is number {
  const [min, max] = ZOMBIE_RULE_LIMITS[key]
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return false
  // Score margins may be half points; counts and hours are whole.
  const halfStep = key === 'bashingThreshold' || key === 'maulingThreshold' || key.startsWith('weapon')
  return halfStep ? Number.isInteger(v * 2) : Number.isInteger(v)
}

/**
 * Read what is stored, keeping only valid keys. A hand-edited or stale value is dropped (so the
 * sport's rule applies) rather than handed to an engine that would bash on a margin of -5.
 */
export function readZombieRuleOverrides(settings: unknown): ZombieRuleOverrides {
  const raw = ((settings ?? {}) as Record<string, unknown>)[ZOMBIE_RULES_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: ZombieRuleOverrides = {}
  for (const key of Object.keys(ZOMBIE_RULE_LIMITS) as NumericKey[]) {
    if (validNumber(key, r[key])) out[key] = r[key] as number
  }
  if (typeof r.bombEnabled === 'boolean') out.bombEnabled = r.bombEnabled
  if ((WHISPERER_DEFEAT_RULES as readonly unknown[]).includes(r.whispererDefeatRule)) {
    out.whispererDefeatRule = r.whispererDefeatRule as WhispererDefeatRule
  }
  return out
}

/**
 * Validate a patch. Cross-field rules are judged on the EFFECTIVE values (stored override, else
 * the sport's rule), so moving one side of a pair is checked against the other side's live value.
 */
export function parseZombieRulesPatch(
  raw: Record<string, unknown>,
  effective: Required<Omit<ZombieRuleOverrides, 'whispererDefeatRule'>> & { whispererDefeatRule: WhispererDefeatRule },
): { ok: true; patch: ZombieRuleOverrides } | { ok: false; error: string } {
  const patch: ZombieRuleOverrides = {}
  for (const key of Object.keys(ZOMBIE_RULE_LIMITS) as NumericKey[]) {
    if (raw[key] === undefined) continue
    if (!validNumber(key, raw[key])) {
      const [min, max] = ZOMBIE_RULE_LIMITS[key]
      return { ok: false, error: `${key} must be from ${min} to ${max}` }
    }
    patch[key] = raw[key] as number
  }
  if (raw.bombEnabled !== undefined) {
    if (typeof raw.bombEnabled !== 'boolean') return { ok: false, error: 'bombEnabled must be true or false' }
    patch.bombEnabled = raw.bombEnabled
  }
  if (raw.whispererDefeatRule !== undefined) {
    if (!(WHISPERER_DEFEAT_RULES as readonly unknown[]).includes(raw.whispererDefeatRule)) {
      return { ok: false, error: `whispererDefeatRule must be one of: ${WHISPERER_DEFEAT_RULES.join(', ')}` }
    }
    patch.whispererDefeatRule = raw.whispererDefeatRule as WhispererDefeatRule
  }

  const next = { ...effective, ...patch }
  if (next.maulingThreshold <= next.bashingThreshold) {
    return { ok: false, error: 'A mauling has to take a bigger margin than a bashing.' }
  }
  if (next.weaponAmbushThreshold <= next.weaponShieldThreshold) {
    return { ok: false, error: 'The bow has to take a higher score than the knife.' }
  }
  if (next.serumMaxHold < next.reviveThreshold) {
    return { ok: false, error: 'A team has to be able to hold enough serums to revive.' }
  }
  return { ok: true, patch }
}
