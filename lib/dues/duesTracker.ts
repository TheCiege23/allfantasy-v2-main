/**
 * The league dues tracker — pure rules over `League.settings.dues_tracker`. No IO, client-safe.
 *
 * 🛑 A TRACKER, NOT A PAYMENT SYSTEM (owner's decision, 2026-11-07). AllFantasy never holds, moves or
 * settles league money: holding entry fees brings money-transmitter and gambling regulation. Money goes
 * straight from manager to the league's own collector (Venmo, Cash App, PayPal, LeagueSafe, FanCred);
 * this records who has paid, reminds who has not, and links out. The Stripe entry-fee and payout flows
 * stay behind `ALLFANTASY_LEAGUE_ENTRY_FEE_ENABLED`, which is off.
 *
 * ⚠ A PAYMENT LINK IS SOMETHING WE RENDER AS AN <a href>. It used to be stored as whatever string the
 * commissioner typed, so `javascript:` would have been saved and rendered as a link for every member.
 * Only https URLs are accepted now, and a link of a known kind must be on that service's own host.
 *
 * ⚠ "I PAID" IS A CLAIM, NOT A PAYMENT. A member can say they paid; only the commissioner marks a team
 * paid. The two are stored apart and shown apart, so a self-report never reads as confirmed.
 */

export const PAYMENT_LINK_KINDS = ['venmo', 'cashapp', 'paypal', 'leaguesafe', 'fancred', 'other'] as const
export type PaymentLinkKind = (typeof PAYMENT_LINK_KINDS)[number]
export type PaymentLink = { kind: PaymentLinkKind; url: string }

export const PAYMENT_LINK_LABEL: Record<PaymentLinkKind, string> = {
  venmo: 'Venmo',
  cashapp: 'Cash App',
  paypal: 'PayPal',
  leaguesafe: 'LeagueSafe',
  fancred: 'FanCred',
  other: 'Payment link',
}

/** The hosts a link of each known kind must be on. `other` accepts any https host. */
const KIND_HOSTS: Record<Exclude<PaymentLinkKind, 'other'>, readonly string[]> = {
  venmo: ['venmo.com'],
  cashapp: ['cash.app'],
  paypal: ['paypal.me', 'paypal.com'],
  leaguesafe: ['leaguesafe.com'],
  fancred: ['fancred.app', 'fancred.com'],
}

export const MAX_PAYMENT_LINKS = 4
export const SELF_REPORT_NOTE_MAX = 140

export type DuesEntry = {
  teamId: string
  /** Confirmed by the commissioner. */
  paid: boolean
  /** Dynasty / C2C / devy / keeper: the seasons this team has paid for. */
  paidSeasons: number[]
  paidAt: string | null
  /** The member said they paid. A claim the commissioner confirms or not. */
  selfReportedAt?: string | null
  selfReportedNote?: string | null
  confirmedBy?: string | null
}

export type DuesConfig = {
  enabled: boolean
  amount: number | null
  currency: string
  /** YYYY-MM-DD, the day dues are due. Null when the league has not set one. */
  dueDate: string | null
  paymentLinks: PaymentLink[]
  /** Legacy single link (before 2026-11-07). Read into `paymentLinks`; kept so nothing is lost. */
  paymentLink: string | null
  paymentProvider: string | null
  entries: DuesEntry[]
  /** Reminder keys already sent (`<season>:<kind>`), so a reminder goes out once. */
  remindersSent: Record<string, string>
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

export function defaultDuesConfig(): DuesConfig {
  return {
    enabled: false,
    amount: null,
    currency: 'USD',
    dueDate: null,
    paymentLinks: [],
    paymentLink: null,
    paymentProvider: null,
    entries: [],
    remindersSent: {},
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
}

/** A valid link, or null. https only; a known kind must be on its own host. */
export function parsePaymentLink(raw: unknown): PaymentLink | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = typeof r.kind === 'string' && (PAYMENT_LINK_KINDS as readonly string[]).includes(r.kind) ? (r.kind as PaymentLinkKind) : null
  const url = typeof r.url === 'string' ? r.url.trim() : ''
  if (!kind || !url || url.length > 300) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  if (kind !== 'other') {
    const host = parsed.hostname.toLowerCase()
    if (!KIND_HOSTS[kind].some((h) => host === h || host.endsWith(`.${h}`))) return null
  }
  return { kind, url: parsed.toString() }
}

/** The legacy single link, as a typed link when it is a safe one. */
function legacyLink(url: unknown, provider: unknown): PaymentLink | null {
  if (typeof url !== 'string' || !url.trim()) return null
  const kind = provider === 'leaguesafe' ? 'leaguesafe' : provider === 'fancred' ? 'fancred' : 'other'
  return parsePaymentLink({ kind, url }) ?? parsePaymentLink({ kind: 'other', url })
}

function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

/** Reads whatever is stored — old shape included — into the current one. Never throws. */
export function readDuesConfig(raw: unknown): DuesConfig {
  const d = defaultDuesConfig()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const links = Array.isArray(r.paymentLinks) ? r.paymentLinks.map(parsePaymentLink).filter((l): l is PaymentLink => l != null) : []
  const legacy = links.length === 0 ? legacyLink(r.paymentLink, r.paymentProvider) : null
  const entries = Array.isArray(r.entries)
    ? r.entries
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).teamId === 'string')
        .map((e) => ({
          teamId: e.teamId as string,
          paid: e.paid === true,
          paidSeasons: Array.isArray(e.paidSeasons) ? e.paidSeasons.filter((s): s is number => typeof s === 'number') : [],
          paidAt: typeof e.paidAt === 'string' ? e.paidAt : null,
          selfReportedAt: typeof e.selfReportedAt === 'string' ? e.selfReportedAt : null,
          selfReportedNote: typeof e.selfReportedNote === 'string' ? e.selfReportedNote : null,
          confirmedBy: typeof e.confirmedBy === 'string' ? e.confirmedBy : null,
        }))
    : []
  return {
    enabled: r.enabled === true,
    amount: typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0 ? r.amount : null,
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : 'USD',
    dueDate: isDate(r.dueDate) ? r.dueDate : null,
    paymentLinks: (links.length ? links : legacy ? [legacy] : []).slice(0, MAX_PAYMENT_LINKS),
    paymentLink: typeof r.paymentLink === 'string' ? r.paymentLink : null,
    paymentProvider: typeof r.paymentProvider === 'string' ? r.paymentProvider : null,
    entries,
    remindersSent: r.remindersSent && typeof r.remindersSent === 'object' ? (r.remindersSent as Record<string, string>) : {},
    lastUpdatedAt: typeof r.lastUpdatedAt === 'string' ? r.lastUpdatedAt : null,
    lastUpdatedBy: typeof r.lastUpdatedBy === 'string' ? r.lastUpdatedBy : null,
  }
}

export type DuesUpdateError = 'invalid_payment_link' | 'invalid_due_date' | 'invalid_amount' | 'too_many_links'

/** A commissioner's edit applied to the stored config. Every payment link is validated or the edit is refused. */
export function applyCommissionerUpdate(
  existing: DuesConfig,
  body: Record<string, unknown>,
  actor: { userId: string; now: Date },
): { ok: true; config: DuesConfig } | { ok: false; error: DuesUpdateError } {
  let paymentLinks = existing.paymentLinks
  if (Array.isArray(body.paymentLinks)) {
    if (body.paymentLinks.length > MAX_PAYMENT_LINKS) return { ok: false, error: 'too_many_links' }
    const parsed = body.paymentLinks.map(parsePaymentLink)
    if (parsed.some((l) => l == null)) return { ok: false, error: 'invalid_payment_link' }
    paymentLinks = parsed as PaymentLink[]
  }
  let dueDate = existing.dueDate
  if (body.dueDate === null || body.dueDate === '') dueDate = null
  else if (body.dueDate !== undefined) {
    if (!isDate(body.dueDate)) return { ok: false, error: 'invalid_due_date' }
    dueDate = body.dueDate
  }
  let amount = existing.amount
  if (body.amount === null) amount = null
  else if (body.amount !== undefined) {
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0 || body.amount > 100_000) return { ok: false, error: 'invalid_amount' }
    amount = body.amount
  }
  const entries = Array.isArray(body.entries)
    ? readDuesConfig({ entries: body.entries }).entries.map((e) => {
        const before = existing.entries.find((x) => x.teamId === e.teamId)
        const newlyPaid = e.paid && !before?.paid
        return {
          ...e,
          // A member's claim survives the commissioner's save; confirming it records who confirmed.
          selfReportedAt: before?.selfReportedAt ?? null,
          selfReportedNote: before?.selfReportedNote ?? null,
          paidAt: e.paid ? (before?.paid ? before.paidAt : actor.now.toISOString()) : null,
          confirmedBy: e.paid ? (newlyPaid ? actor.userId : (before?.confirmedBy ?? null)) : null,
        }
      })
    : existing.entries
  // A changed due date or season starts the reminders over.
  const remindersSent = dueDate !== existing.dueDate ? {} : existing.remindersSent
  return {
    ok: true,
    config: {
      ...existing,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
      amount,
      currency: typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : existing.currency,
      dueDate,
      paymentLinks,
      entries,
      remindersSent,
      lastUpdatedAt: actor.now.toISOString(),
      lastUpdatedBy: actor.userId,
    },
  }
}

/** A member says they paid. Records the claim on their own team only; never marks it paid. */
export function applySelfReport(config: DuesConfig, teamId: string, note: unknown, now: Date): DuesConfig {
  const text = typeof note === 'string' ? note.trim().slice(0, SELF_REPORT_NOTE_MAX) : ''
  const has = config.entries.some((e) => e.teamId === teamId)
  const entries = has
    ? config.entries.map((e) => (e.teamId === teamId ? { ...e, selfReportedAt: now.toISOString(), selfReportedNote: text || null } : e))
    : [...config.entries, { teamId, paid: false, paidSeasons: [], paidAt: null, selfReportedAt: now.toISOString(), selfReportedNote: text || null, confirmedBy: null }]
  return { ...config, entries }
}

/**
 * Is this league tracking dues? The switch, or simply having set an amount: the tracker never showed the
 * switch, so `enabled` was false for every league that used it.
 */
export function isTracking(config: Pick<DuesConfig, 'enabled' | 'amount'>): boolean {
  return config.enabled || config.amount != null
}

/** Paid for this season: a multi-season league tracks seasons, a redraft league the single flag. */
export function teamPaid(config: DuesConfig, teamId: string, season: number, multiSeason: boolean): boolean {
  const e = config.entries.find((x) => x.teamId === teamId)
  if (!e) return false
  return multiSeason ? e.paidSeasons.includes(season) || e.paid : e.paid
}

export type ReminderKind = 'week_before' | 'day_before' | 'overdue'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Which reminder is due today, if any: a week before, the day before, and once three days after the due
 * date. Each goes once per season (`remindersSent`). Nothing without a due date, an amount, or tracking on.
 */
export function reminderDue(config: DuesConfig, season: number, now: Date): ReminderKind | null {
  if (!isTracking(config) || !config.dueDate || config.amount == null) return null
  const due = Date.parse(`${config.dueDate}T23:59:59Z`)
  const days = (due - now.getTime()) / DAY_MS
  const kind: ReminderKind | null = days < -3 && days >= -10 ? 'overdue' : days >= 0 && days < 1.5 ? 'day_before' : days >= 5 && days < 7.5 ? 'week_before' : null
  if (!kind) return null
  return config.remindersSent[`${season}:${kind}`] ? null : kind
}

export function formatAmount(config: Pick<DuesConfig, 'amount' | 'currency'>): string {
  if (config.amount == null) return ''
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: config.currency || 'USD', maximumFractionDigits: 2 }).format(config.amount)
  } catch {
    return `$${config.amount}`
  }
}

export function reminderText(config: DuesConfig, kind: ReminderKind, leagueName: string): { title: string; body: string } {
  const amount = formatAmount(config)
  const date = config.dueDate ?? ''
  if (kind === 'overdue') return { title: `Dues overdue · ${leagueName}`, body: `Your ${amount} league dues were due ${date}. Pay your commissioner, then tap "I paid".` }
  if (kind === 'day_before') return { title: `Dues due tomorrow · ${leagueName}`, body: `Your ${amount} league dues are due ${date}.` }
  return { title: `Dues due in a week · ${leagueName}`, body: `Your ${amount} league dues are due ${date}.` }
}
