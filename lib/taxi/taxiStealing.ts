/**
 * TAXI STEALING — another team claims a player off your taxi squad; you keep the player by
 * protecting them (promoting them to your active roster) before the window closes.
 *
 * The rule most dynasty leagues mean by "taxi stealing" (or poaching): a taxi squad is a cheap place
 * to stash a prospect, and the price of that is that anyone may take the prospect unless you commit a
 * real roster spot to them.
 *
 *   claim     a team in the league claims a player on another team's taxi squad. One open claim per
 *             player; a team has a number of claims per season (1 by default, counted when made)
 *   protect   the owner promotes the player to the active roster before the window ends (48 h by
 *             default). Protection is the owner's ordinary lineup save, allowed even when the taxi
 *             rules have closed promotions — otherwise a claim during a closed window could never be
 *             answered — and it counts as a promotion, so "once promoted, cannot return" still
 *             applies
 *   steal     the window ends with the player still on that taxi squad: the player moves to the
 *             claiming team's bench. A player who left the taxi squad meanwhile (promoted, dropped,
 *             traded) ends the claim with nothing moved
 *   let go    the owner may hand the player over before the window ends; the claimer may withdraw
 *
 * A stolen player reaches the bench, so the claiming team can end up over the roster limit and must
 * make room before its next lineup save — the same as a trade.
 *
 * AF Commissioner: the commissioner switches it on (`League.settings.taxi_stealing`), and claims are
 * taken only while the league owner holds the plan. A claim already open still resolves on time if
 * the plan lapses, because the owner has been told a deadline.
 *
 * Pure.
 */
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

export const TAXI_STEALING_KEY = 'taxi_stealing'
/** League.settings: every claim, newest last. Written only by lib/taxi/taxiStealingService.ts. */
export const TAXI_STEAL_CLAIMS_KEY = 'taxi_steal_claims'

export const PROTECT_HOURS_CHOICES = [24, 48, 72] as const
export const CLAIMS_PER_SEASON_CHOICES = [1, 2, 3, 5, 0] as const
export const DEFAULT_PROTECT_HOURS = 48
export const DEFAULT_CLAIMS_PER_SEASON = 1
/** Claims kept in settings; the oldest resolved ones drop off first. */
export const MAX_STORED_CLAIMS = 200

export type TaxiStealingRule = {
  enabled: boolean
  protectHours: number
  /** Claims a team may make in a season; 0 is no limit. */
  claimsPerSeason: number
}

export const DEFAULT_TAXI_STEALING_RULE: TaxiStealingRule = {
  enabled: false,
  protectHours: DEFAULT_PROTECT_HOURS,
  claimsPerSeason: DEFAULT_CLAIMS_PER_SEASON,
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** The stored rule, with defaults for anything missing or unreadable — never "on" by accident. */
export function readTaxiStealingRule(settings: unknown): TaxiStealingRule {
  const raw = asObject(asObject(settings)?.[TAXI_STEALING_KEY])
  if (!raw) return { ...DEFAULT_TAXI_STEALING_RULE }
  const hours = Number(raw.protectHours)
  const per = Number(raw.claimsPerSeason)
  return {
    enabled: raw.enabled === true,
    protectHours: (PROTECT_HOURS_CHOICES as readonly number[]).includes(hours) ? hours : DEFAULT_PROTECT_HOURS,
    claimsPerSeason: (CLAIMS_PER_SEASON_CHOICES as readonly number[]).includes(per) ? per : DEFAULT_CLAIMS_PER_SEASON,
  }
}

/** Stored only in the shape the reader knows. Missing fields keep the current value. */
export function parseTaxiStealingRule(raw: unknown, current: TaxiStealingRule): { ok: true; value: TaxiStealingRule } | { ok: false; error: string } {
  const o = asObject(raw)
  if (!o) return { ok: false, error: 'Send { enabled, protectHours?, claimsPerSeason? }.' }
  if ('enabled' in o && typeof o.enabled !== 'boolean') return { ok: false, error: 'enabled is true or false.' }
  const hours = 'protectHours' in o ? Number(o.protectHours) : current.protectHours
  if (!(PROTECT_HOURS_CHOICES as readonly number[]).includes(hours)) return { ok: false, error: `The protection window is ${PROTECT_HOURS_CHOICES.join(', ')} hours.` }
  const per = 'claimsPerSeason' in o ? Number(o.claimsPerSeason) : current.claimsPerSeason
  if (!(CLAIMS_PER_SEASON_CHOICES as readonly number[]).includes(per)) return { ok: false, error: 'Claims per season is 1, 2, 3, 5 or 0 for no limit.' }
  return { ok: true, value: { enabled: 'enabled' in o ? o.enabled === true : current.enabled, protectHours: hours, claimsPerSeason: per } }
}

export type TaxiStealStatus = 'open' | 'protected' | 'stolen' | 'void' | 'withdrawn'

export type TaxiStealClaim = {
  id: string
  playerId: string
  playerName: string
  /** Roster.id of the team whose taxi squad the player is on, and of the claiming team. */
  fromRosterId: string
  toRosterId: string
  claimedBy: string
  season: number
  createdAt: string
  deadline: string
  status: TaxiStealStatus
  resolvedAt?: string | null
  /** Why a claim ended with nothing moved. */
  note?: string | null
}

export function readTaxiStealClaims(settings: unknown): TaxiStealClaim[] {
  const raw = asObject(settings)?.[TAXI_STEAL_CLAIMS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is TaxiStealClaim => {
    const o = asObject(c)
    return Boolean(o && typeof o.id === 'string' && typeof o.playerId === 'string' && typeof o.fromRosterId === 'string' && typeof o.toRosterId === 'string' && typeof o.deadline === 'string')
  })
}

/** Keep every open claim and the newest resolved ones, up to the cap. */
export function trimClaims(claims: readonly TaxiStealClaim[]): TaxiStealClaim[] {
  if (claims.length <= MAX_STORED_CLAIMS) return [...claims]
  const open = claims.filter((c) => c.status === 'open')
  const done = claims.filter((c) => c.status !== 'open').slice(-(MAX_STORED_CLAIMS - open.length))
  const keep = new Set([...open, ...done].map((c) => c.id))
  return claims.filter((c) => keep.has(c.id))
}

export const isDue = (c: TaxiStealClaim, now: Date) => c.status === 'open' && Date.parse(c.deadline) <= now.getTime()

export type ClaimIssue = 'RULE_OFF' | 'OWN_PLAYER' | 'NOT_ON_TAXI' | 'ALREADY_CLAIMED' | 'NO_CLAIMS_LEFT'

/** Whether this team may claim this player now. */
export function checkClaim(input: {
  rule: TaxiStealingRule
  claims: readonly TaxiStealClaim[]
  playerId: string
  fromRosterId: string
  toRosterId: string
  /** The player is on the from-team's taxi squad right now. */
  onTaxi: boolean
  season: number
}): { ok: true } | { ok: false; issue: ClaimIssue } {
  if (!input.rule.enabled) return { ok: false, issue: 'RULE_OFF' }
  if (input.fromRosterId === input.toRosterId) return { ok: false, issue: 'OWN_PLAYER' }
  if (!input.onTaxi) return { ok: false, issue: 'NOT_ON_TAXI' }
  if (input.claims.some((c) => c.status === 'open' && c.playerId === input.playerId)) return { ok: false, issue: 'ALREADY_CLAIMED' }
  if (input.rule.claimsPerSeason > 0) {
    // Counted when made: a claim the owner protects still used one, or a team could probe for free.
    const used = input.claims.filter((c) => c.toRosterId === input.toRosterId && c.season === input.season && c.status !== 'withdrawn').length
    if (used >= input.rule.claimsPerSeason) return { ok: false, issue: 'NO_CLAIMS_LEFT' }
  }
  return { ok: true }
}

export function claimsLeft(input: { rule: TaxiStealingRule; claims: readonly TaxiStealClaim[]; rosterId: string; season: number }): number | null {
  if (input.rule.claimsPerSeason === 0) return null
  const used = input.claims.filter((c) => c.toRosterId === input.rosterId && c.season === input.season && c.status !== 'withdrawn').length
  return Math.max(0, input.rule.claimsPerSeason - used)
}

/** Player ids on the taxi section of a saved lineup. */
export function taxiPlayerIds(playerData: unknown): string[] {
  return getNormalizedLineupSections(playerData).taxi.map((r) => String(r.id ?? '').trim()).filter(Boolean)
}

/** The lineup with this player moved from the taxi squad to the end of the bench. */
export function promoteFromTaxi(playerData: unknown, playerId: string): Record<string, unknown> {
  const sections = getNormalizedLineupSections(playerData)
  const leaving = sections.taxi.filter((r) => String(r.id) === playerId)
  return buildPlayerDataFromSections(playerData, {
    ...sections,
    taxi: sections.taxi.filter((r) => String(r.id) !== playerId),
    bench: [...sections.bench, ...leaving],
  })
}

/** The rule for Chimmy, in one sentence. */
export function describeTaxiStealing(rule: TaxiStealingRule): string | null {
  if (!rule.enabled) return null
  const per = rule.claimsPerSeason === 0 ? 'no limit on claims' : `${rule.claimsPerSeason} claim${rule.claimsPerSeason === 1 ? '' : 's'} per team per season`
  return (
    `Taxi stealing is on: any team may claim a player on another team's taxi squad (${per}). The owner has ${rule.protectHours} hours to protect the player by promoting them to the active roster; ` +
    'otherwise the player moves to the claiming team’s bench. Protection counts as a promotion. Claims are made on the Waivers page (enforced).'
  )
}

const when = (iso: string, es: boolean) =>
  new Date(iso).toLocaleString(es ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })

type Notice = { title: { en: string; es: string }; body: { en: string; es: string } }

/** To the owner, when a claim is made. */
export function claimedNotice(i: { player: string; claimer: string; deadline: string; leagueName: string }): Notice {
  return {
    title: { en: `${i.claimer} claimed ${i.player} off your taxi squad`, es: `${i.claimer} reclamó a ${i.player} de tu escuadra taxi` },
    body: {
      en: `Promote ${i.player} to your active roster in ${i.leagueName} by ${when(i.deadline, false)} to keep them. If you do nothing, ${i.player} moves to ${i.claimer}.`,
      es: `Pasa a ${i.player} a tu plantilla activa en ${i.leagueName} antes de ${when(i.deadline, true)} para conservarlo. Si no haces nada, pasará a ${i.claimer}.`,
    },
  }
}

/** To both teams, when a claim ends. */
export function outcomeNotice(i: { player: string; owner: string; claimer: string; outcome: 'protected' | 'stolen'; forClaimer: boolean; leagueName: string }): Notice {
  if (i.outcome === 'protected') {
    return i.forClaimer
      ? {
          title: { en: `${i.owner} protected ${i.player}`, es: `${i.owner} protegió a ${i.player}` },
          body: {
            en: `${i.player} was promoted to ${i.owner}'s active roster in ${i.leagueName}, so your claim ended. The claim still counts for this season.`,
            es: `${i.player} pasó a la plantilla activa de ${i.owner} en ${i.leagueName}, así que tu reclamo terminó. El reclamo sigue contando para esta temporada.`,
          },
        }
      : {
          title: { en: `You kept ${i.player}`, es: `Conservaste a ${i.player}` },
          body: {
            en: `${i.player} is on your active roster in ${i.leagueName}, so ${i.claimer}'s claim ended.`,
            es: `${i.player} está en tu plantilla activa en ${i.leagueName}, así que el reclamo de ${i.claimer} terminó.`,
          },
        }
  }
  return i.forClaimer
    ? {
        title: { en: `${i.player} is yours`, es: `${i.player} es tuyo` },
        body: {
          en: `${i.owner} did not protect ${i.player}, so they joined your ${i.leagueName} bench. If your roster is over the limit, drop a player before your next lineup save.`,
          es: `${i.owner} no protegió a ${i.player}, así que pasó a tu banca en ${i.leagueName}. Si tu plantilla pasa del límite, suelta a un jugador antes de guardar tu próxima alineación.`,
        },
      }
    : {
        title: { en: `${i.player} moved to ${i.claimer}`, es: `${i.player} pasó a ${i.claimer}` },
        body: {
          en: `${i.player} was still on your taxi squad when the window closed, so they moved to ${i.claimer} in ${i.leagueName}.`,
          es: `${i.player} seguía en tu escuadra taxi al cerrarse el plazo, así que pasó a ${i.claimer} en ${i.leagueName}.`,
        },
      }
}
