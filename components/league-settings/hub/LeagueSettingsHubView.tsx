'use client'

/**
 * Presentational League Settings hub — Sleeper-parity tabs (My Settings, League Setup, Members,
 * Record Book) plus the Commissioner Hub (owner's page review #16, Phase C), which a commissioner of
 * an AllFantasy league sees between Members and Record Book. Lives in the AllFantasy league surface. Pure props in, callbacks
 * out: `LeagueSettingsHub` owns every fetch and save, and the /e2e preview renders this
 * same component from fixtures, so what the preview shows is what the league page renders.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './league-settings-hub.css'
import {
  CalendarDays, ChevronRight, ClipboardList, Coins, Crown, Flame, Lock, LockKeyhole, Network, Scale, Settings2, Sparkles, Trophy, UserCog, Users, type LucideIcon,
} from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubLocale, hubScheduleMode, hubSeasons, hubText } from '@/lib/league-settings-hub/hubI18n'
import {
  HUB_KIND_META,
  championWord,
  initials,
  statCorrectionNote,
  type HubGroup,
  type HubKind,
  type HubNotificationGroup,
  type HubRosterItem,
  type HubRow,
  type HubScoringCategory,
  type HubAfOption,
  type HubStandingRow,
} from '@/lib/league-settings-hub/hubModel'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import type { TaskCard } from '@/lib/core-app/commissioner/tasks'
import type { ConnectedGroup } from '@/lib/league/connectedLeagues'
import type { CorrectionWeek } from '@/lib/league-settings-hub/recordBookModel'
import { sportCopy, sportDisplayName } from '@/lib/league-settings-hub/sportProfile'

export type HubTabId = 'my' | 'setup' | 'members' | 'hub' | 'record'

type HubMember = {
  id: string
  name: string
  teamName: string | null
  avatarUrl: string | null
  isCommissioner: boolean
  isCoCommissioner: boolean
  isYou: boolean
}

type HubCoOwner = { id: string; name: string; accepted: boolean }

/** `undefined` = still loading, `null` = not available for this league / viewer. */
export type HubViewData = {
  leagueId: string
  kind: HubKind
  leagueName: string
  leagueAvatarUrl: string | null
  sport: string | null
  season: number | null
  teamCount: number | null
  leagueArt: string | null
  canEdit: boolean
  isHeadCommissioner: boolean
  /** Imported leagues are read-only mirrors of their host platform. */
  importedFrom: string | null
  myTeam: { name: string; avatarUrl: string | null } | null | undefined
  notifications:
    | { groups: HubNotificationGroup[]; on: Partial<Record<NotificationCategoryId, boolean>>; leagueEnabled: boolean }
    | null
    | undefined
  general: HubGroup[] | undefined
  waivers: HubGroup[] | undefined
  typeRules: HubGroup[] | undefined
  commissionerNote: string | null | undefined
  roster: HubRosterItem[] | null | undefined
  scoring: { preset: string | null; categories: HubScoringCategory[] } | null | undefined
  draft: HubGroup[] | undefined
  draftOrder: Array<{ slot: number; name: string }> | null | undefined
  members: HubMember[] | undefined
  coOwners: { rosterId: string; invitations: HubCoOwner[] } | null | undefined
  invite: { link: string | null; filled: number; capacity: number | null } | null | undefined
  draftHistory: { title: string; status: string } | null | undefined
  seasons: Array<{ year: number; champion: string | null; runnerUp: string | null }> | null | undefined
  standings: HubStandingRow[] | null | undefined
  highScores: Array<{ rank: number; holder: string; season: number | null; week?: number | null; value: string }> | null | undefined
  /** Set when team highs come from final results rather than the record-book engine: the seasons covered. */
  highScoresSeasons?: number[] | null
  /** Biggest single-week starter scores; `seasons` is the window the rows cover. */
  playerHighScores:
    | { seasons: number[]; rows: Array<{ rank: number; name: string; team: string; season: number; week: number; points: string }> }
    | null
    | undefined
  /** Per week of `season`: final vs still open, when it was rescored, and (when checked) which players changed. */
  correctionWeeks: { season: number; weeks: CorrectionWeek[] } | null | undefined
  /**
   * Commissioner Hub "Needs you": the same task queue as /core's Commissioner Hub
   * (`/api/leagues/[id]/commissioner-hub`). Absent or `undefined` while loading; `null` when it
   * could not be read.
   */
  commissionerTasks?: { cards: TaskCard[]; overflow: TaskCard[] } | null
  /**
   * AllFantasy-only rules (lib/league-settings-hub/hubModel `buildAfOptions`), shown in League Setup and
   * again in the Commissioner Hub. Absent or `undefined` while loading.
   */
  afOptions?: HubAfOption[]
  /**
   * The Survivor islands, tournament round or Zombie universe this league belongs to
   * (lib/league/connectedLeagues.ts); `null` when it stands alone, absent or `undefined` while loading.
   */
  connected?: ConnectedGroup | null
}

/** Live panels the Commissioner Hub embeds; the fetching owner supplies them, a fixture preview may not. */
export type HubSlots = { rivalryWeek?: ReactNode; storyline?: ReactNode; copyLeague?: ReactNode }

export type HubCallbacks = {
  onToggleSetting: (field: string, next: boolean) => void
  onSaveTeamName: (name: string) => Promise<string | null>
  /** Commissioner notes, stored in `League.settings.commissioner_notes`. */
  onSaveNote: (text: string) => Promise<string | null>
  onToggleNotification: (id: NotificationCategoryId, on: boolean) => void
  onToggleLeagueNotifications: (on: boolean) => void
  onToggleCoCommissioner: (memberId: string, next: boolean) => void
  onInviteCoOwner: (username: string) => Promise<string | null>
  onOpenEditor: (panelId: string) => void
  onLeaveLeague?: () => void
  onCopy: (text: string) => void
  onShare?: (url: string) => void
  /** Schedule every connected league's draft at once (the group's own route). Resolves to an error, or null. */
  onScheduleConnectedDrafts?: (isoDateTime: string) => Promise<string | null>
}

/**
 * The viewer's language, applied at render time. The model builds English (its tests assert it);
 * `t` swaps in Spanish for strings lib/league-settings-hub/hubI18n knows and leaves data — names,
 * presets, numbers — untouched.
 */
type HubTr = { t: (s: string) => string; tStat: (s: string) => string; tMode: (s: string) => string; lang: string }
const HubT = createContext<HubTr>({ t: (s) => s, tStat: (s) => s, tMode: (s) => s, lang: 'en' })
const useT = () => useContext(HubT)

const TABS: Array<{ id: HubTabId; label: string }> = [
  { id: 'my', label: 'My Settings' },
  { id: 'setup', label: 'League Setup' },
  { id: 'members', label: 'Members' },
  { id: 'hub', label: 'Commissioner Hub' },
  { id: 'record', label: 'Record Book' },
]

/**
 * The Commissioner Hub tab: commissioners and co-commissioners of an AllFantasy league. An imported
 * league's commissioner tools live on its host platform, and a manager has nothing to run here.
 */
export function showsCommissionerHub(data: Pick<HubViewData, 'canEdit' | 'importedFrom'>): boolean {
  return data.canEdit && !data.importedFrom
}

export function LeagueSettingsHubView({
  data,
  cb,
  initialTab = 'setup',
  busyField = null,
  advanced,
  slots,
}: {
  data: HubViewData
  cb: HubCallbacks
  initialTab?: HubTabId
  /** Field currently saving — its switch is disabled until the PATCH returns. */
  busyField?: string | null
  /** Optional "Advanced settings" escape hatch to the full legacy editor. */
  advanced?: { label: string; onOpen: () => void }
  /** Live panels for the Commissioner Hub tab (Rivalry Week, Storyline). */
  slots?: HubSlots
}) {
  const hubAllowed = showsCommissionerHub(data)
  const [picked, setTab] = useState<HubTabId>(initialTab)
  // The payload arrives after the first render, so `canEdit` can flip: a hub tab asked for before it
  // is known lands on League Setup until it is.
  const tab: HubTabId = picked === 'hub' && !hubAllowed ? 'setup' : picked
  const tabs = hubAllowed ? TABS : TABS.filter((tb) => tb.id !== 'hub')
  const { language } = useOptionalLanguage()
  const tr = useMemo<HubTr>(() => ({
    lang: language,
    t: (s) => hubText(language, s, data.sport),
    // Scoring-table names only: a stat "Save" is a save, never the button verb.
    tStat: (s) => hubText(language, s, data.sport, { stat: true }),
    // A waiver-schedule day: "Waivers" there is a run («Reclamos»), not the free-agent screen.
    tMode: (s) => hubScheduleMode(language, s, data.sport),
  }), [language, data.sport])
  const { t } = tr
  const meta = HUB_KIND_META[data.kind]
  const locked = !data.canEdit
  const sections = useMemo(() => sectionsFor(tab, data), [tab, data])
  const sportName = sportDisplayName(data.sport)

  return (
    <HubT.Provider value={tr}>
    <div className="af-lsh af-league-surface" data-league-art={data.leagueArt ?? undefined} data-testid="league-settings-hub">
      <header className="af-lsh-head">
        <div className="af-lsh-avatar" aria-hidden>
          {data.leagueAvatarUrl ? <img src={data.leagueAvatarUrl} alt="" /> : initials(data.leagueName)}
        </div>
        <div className="af-lsh-head-copy">
          <h1>{data.leagueName}</h1>
          <div className="af-lsh-meta">
            <span className="af-lsh-badge" data-testid="league-settings-hub-type">{t(meta.label)}</span>
            <span>{[data.season, sportName ? t(sportName) : null, data.teamCount ? t(`${data.teamCount} teams`) : null].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <span className="af-lsh-role" data-locked={locked}>
          {t(data.importedFrom ? 'Read-only mirror' : locked ? 'View only' : data.isHeadCommissioner ? 'Commissioner' : 'Co-commissioner')}
        </span>
      </header>

      <div className="af-lsh-tabbar">
      <div className="af-lsh-tabs" role="tablist" aria-label={t('League settings')}>
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            id={`af-lsh-tab-${tb.id}`}
            aria-selected={tab === tb.id}
            aria-controls="af-lsh-panel"
            className="af-lsh-tab"
            onClick={() => setTab(tb.id)}
            data-testid={`league-settings-hub-tab-${tb.id}`}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>
        {advanced ? (
          <button type="button" className="af-lsh-btn" data-variant="ghost" onClick={advanced.onOpen} data-testid="league-settings-hub-advanced">
            {t(advanced.label)}
          </button>
        ) : null}
      </div>

      <div className="af-lsh-body" id="af-lsh-panel" role="tabpanel" aria-labelledby={`af-lsh-tab-${tab}`}>
        <nav className="af-lsh-jump" aria-label={t('On this page')} onClick={openLinkedSection}>
          <span className="af-lsh-jump-label">{t('On this page')}</span>
          {sections.map((s) => (
            <a key={s.id} href={`#af-lsh-${s.id}`}>{t(s.label)}</a>
          ))}
          <div className="af-lsh-format">
            <span className="af-lsh-eyebrow">{t('Format')}</span>
            <strong>{t(meta.label)}</strong>
            <span>{t(meta.blurb)}</span>
          </div>
        </nav>
        <div className="af-lsh-stack">
          <nav className="af-lsh-chips" aria-label={t('Sections')} onClick={openLinkedSection}>
            {sections.map((s) => (
              <a key={s.id} href={`#af-lsh-${s.id}`}>{t(s.label)}</a>
            ))}
          </nav>
          {data.importedFrom && tab === 'setup' ? (
            <div className="af-lsh-banner" data-tone="info">
              <div>
                <strong>{t(`Imported from ${data.importedFrom}`)}</strong>
                <p>{t(`These rules mirror your host league. Change them on ${data.importedFrom} and they sync here.`)}</p>
              </div>
            </div>
          ) : locked && tab === 'setup' ? (
            <div className="af-lsh-banner" role="note">
              <div>
                <strong>{t('Only commissioners can change league settings')}</strong>
                <p>{t('You can see every rule. Ask your commissioner if something looks off.')}</p>
              </div>
            </div>
          ) : null}
          {tab === 'my' ? <MyTab data={data} cb={cb} slots={slots} /> : null}
          {tab === 'setup' ? <SetupTab data={data} cb={cb} busyField={busyField} /> : null}
          {tab === 'members' ? <MembersTab data={data} cb={cb} /> : null}
          {tab === 'hub' ? <CommissionerHubTab data={data} cb={cb} slots={slots} /> : null}
          {tab === 'record' ? <RecordTab data={data} /> : null}
        </div>
      </div>
    </div>
    </HubT.Provider>
  )
}

/** The native settings sub-page that edits this format's own rules (lib/league-settings-home). */
export function rulesEditorFor(kind: HubKind): string {
  if (kind === 'guillotine') return 'guillotine-rules'
  if (kind === 'pirate') return 'pirate-rules'
  if (kind === 'survivor') return 'survivor-tribes'
  return 'format'
}

/** "2026 & 2025" for two seasons, "2022–2026" for a longer run. */
export function seasonsLabel(seasons: number[]): string {
  if (seasons.length <= 2) return seasons.join(' & ')
  return `${Math.min(...seasons)}–${Math.max(...seasons)}`
}

function sectionsFor(tab: HubTabId, data: HubViewData): Array<{ id: string; label: string }> {
  const meta = HUB_KIND_META[data.kind]
  /* An imported league is left on its host platform, so "Leave League" is not offered for one. */
  if (tab === 'my') {
    const out = [{ id: 'team', label: 'My Team' }, { id: 'notifications', label: 'Notifications' }]
    if (!data.importedFrom) out.push({ id: 'leave', label: 'Leave League' })
    return out
  }
  if (tab === 'setup') {
    const out = [{ id: 'general', label: 'General' }, { id: 'waivers', label: 'Waivers' }]
    if (data.typeRules === undefined || data.typeRules.length) out.push({ id: 'rules', label: meta.rulesTitle })
    if (data.afOptions === undefined || data.afOptions.length) out.push({ id: 'afoptions', label: 'AllFantasy options' })
    out.push({ id: 'notes', label: 'Commish Notes' }, { id: 'roster', label: 'Roster' }, { id: 'scoring', label: 'Scoring' }, { id: 'draft', label: 'Draft' })
    if (data.isHeadCommissioner && !data.importedFrom) out.push({ id: 'delete', label: 'Delete League' })
    return out
  }
  if (tab === 'members') return [{ id: 'commissioners', label: 'Commissioners' }, { id: 'coowners', label: 'Co-Owners' }, { id: 'managers', label: 'Managers' }, { id: 'invite', label: 'Invite' }]
  if (tab === 'hub') return [...(data.connected ? [{ id: 'connected', label: 'Connected leagues' }] : []), ...HUB_SECTIONS.map((s) => ({ id: s.id, label: s.label }))]
  return [{ id: 'history', label: 'League History' }, { id: 'standings', label: 'All-Time Standings' }, { id: 'highs', label: 'High Scores' }, { id: 'corrections', label: 'Stat Corrections' }, { id: 'legend', label: 'League Legend' }]
}

/* ------------------------------------------------------------ primitives */

/**
 * A section card. `fold` makes it a <details> whose summary is the card's own head (2026-11-24, the
 * simplify pass): League Setup drew every section open — ~5,600px on a phone — so all but General now
 * start closed, as one row each. The Edit button stays in the head and works without opening the card
 * (a click on a button inside a summary does not toggle it), and the section chips open what they jump to.
 */
function Card({ id, title, sub, action, children, fold }: { id: string; title: string; sub?: string; action?: ReactNode; children: ReactNode; fold?: 'open' | 'closed' }) {
  const { t } = useT()
  const head = (
    <>
      <div>
        <h2 id={`af-lsh-${id}-title`}>{t(title)}</h2>
        {sub ? <p>{t(sub)}</p> : null}
      </div>
      {action}
    </>
  )
  if (fold) {
    return (
      <section className="af-lsh-card" id={`af-lsh-${id}`} aria-labelledby={`af-lsh-${id}-title`} data-fold="true">
        <details className="af-lsh-fold" open={fold === 'open' || undefined} data-testid={`league-settings-fold-${id}`}>
          <summary className="af-lsh-card-head">{head}</summary>
          {children}
        </details>
      </section>
    )
  }
  return (
    <section className="af-lsh-card" id={`af-lsh-${id}`} aria-labelledby={`af-lsh-${id}-title`}>
      <div className="af-lsh-card-head">{head}</div>
      {children}
    </section>
  )
}

/** A section link was tapped: open the folded card it points at, then let the browser jump to it. */
function openLinkedSection(event: { target: EventTarget }) {
  const link = (event.target as HTMLElement | null)?.closest?.('a[href^="#af-lsh-"]')
  const id = link?.getAttribute('href')?.slice(1)
  const fold = id ? document.getElementById(id)?.querySelector<HTMLDetailsElement>(':scope > details.af-lsh-fold') : null
  if (fold) fold.open = true
}

function EditButton({ show, onClick, label = 'Edit' }: { show: boolean; onClick: () => void; label?: string }) {
  const { t } = useT()
  if (!show) return null
  return <button type="button" className="af-lsh-btn" data-size="sm" onClick={onClick}>{t(label)}</button>
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="af-lsh-switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span><span /></span>
    </button>
  )
}

function Loading({ lines = 3 }: { lines?: number }) {
  const { t } = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 18px 20px' }} aria-busy="true" aria-label={t('Loading')}>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="af-lsh-skeleton" style={{ width: `${70 - i * 12}%` }} />)}
    </div>
  )
}

function Face({ name, src }: { name: string; src?: string | null }) {
  return <span className="af-lsh-face" aria-hidden>{src ? <img src={src} alt="" /> : initials(name)}</span>
}

function RowView({ row, canEdit, busyField, onToggle }: { row: HubRow; canEdit: boolean; busyField?: string | null; onToggle?: (field: string, next: boolean) => void }) {
  const { t, tMode } = useT()
  return (
    <>
      <div className="af-lsh-row" data-indent={row.indent ? 'true' : undefined}>
        <div className="af-lsh-row-copy">
          <span>{t(row.label)}</span>
          {row.description ? <span>{t(row.description)}</span> : null}
        </div>
        {row.toggle && onToggle ? (
          <Switch
            on={row.toggle.on}
            label={t(row.label)}
            disabled={!canEdit || busyField === row.toggle.field}
            onChange={(next) => onToggle(row.toggle!.field, next)}
          />
        ) : row.schedule ? null : (
          <span className="af-lsh-value" data-empty={row.value == null ? 'true' : undefined}>{row.value == null ? '—' : translateValue(t, row.value)}</span>
        )}
      </div>
      {row.schedule ? (
        <div className="af-lsh-schedule">
          {row.schedule.map((d) => (
            <div key={d.day}><span>{t(d.day)}</span><span>{tMode(d.mode)}</span></div>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** A row value: whole-string first, then a comma list ("Out, Doubtful, NA") item by item. */
function translateValue(t: (s: string) => string, value: string): string {
  const whole = t(value)
  if (whole !== value || !value.includes(', ')) return whole
  return value.split(', ').map(t).join(', ')
}

/** Groups flow into two columns at tablet width and up, balanced by row count. */
function GroupGrid({ groups, canEdit, busyField, onToggle }: { groups: HubGroup[]; canEdit: boolean; busyField?: string | null; onToggle?: (field: string, next: boolean) => void }) {
  const { t } = useT()
  const cols = useMemo(() => {
    const left: HubGroup[] = []
    const right: HubGroup[] = []
    let a = 0
    let b = 0
    for (const g of groups) {
      const w = g.rows.length + (g.label ? 1 : 0) + g.rows.reduce((n, r) => n + (r.schedule?.length ?? 0) * 0.5, 0)
      if (a <= b) { left.push(g); a += w } else { right.push(g); b += w }
    }
    return [left, right].filter((c) => c.length)
  }, [groups])
  return (
    <div className="af-lsh-grid">
      {cols.map((col, i) => (
        <div className="af-lsh-col" key={i}>
          {col.map((g) => (
            <div key={g.key}>
              {g.label ? <div className="af-lsh-group-label">{t(g.label)}</div> : null}
              {g.rows.map((r) => <RowView key={r.key} row={r} canEdit={canEdit} busyField={busyField} onToggle={onToggle} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------- Commissioner Hub tab */

/**
 * The Commissioner Hub (owner's page review #16): it replaces the "Commissioner tools" entry. What
 * needs the commissioner comes first; then one card per job, each opening the editor that already
 * does it. Panel ids are League Settings sub-pages (lib/league-settings-home); `commissioner-tools:<view>`
 * opens that sub-page on one of CommissionerControlPanel's views.
 */
const HUB_SECTIONS = [
  { id: 'needs', label: 'Needs you' },
  { id: 'season', label: 'Season controls' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'rivalry', label: 'Rivalry Week' },
  { id: 'options', label: 'League options' },
  { id: 'storyline', label: 'Storyline' },
] as const

type HubLink = { label: string; description: string; panel?: string; href?: string; testid: string }

const SEASON_LINKS: HubLink[] = [
  { label: 'Edit lineups and records', description: 'Set any team’s lineup, then rescore the week.', panel: 'commissioner-tools:edit-lineups', testid: 'hub-edit-lineups' },
  { label: 'Lock a roster', description: 'Stop a team from adding, dropping or trading.', panel: 'commissioner-tools:lock-roster', testid: 'hub-lock-roster' },
  { label: 'Member settings', description: 'Chimmy lineup and auto-switch injured starters, team by team.', panel: 'commissioner-tools:member-settings', testid: 'hub-member-settings' },
  { label: 'Co-commissioners', description: 'Who can run the league with you.', panel: 'commissioner-tools:update-commissioners', testid: 'hub-co-commissioners' },
  { label: 'Score adjustments', description: 'Add or take away points for a team in a week.', panel: 'score-adjustments', testid: 'hub-score-adjustments' },
  { label: 'Dues & payouts', description: 'Track who has paid. AllFantasy never holds the money.', panel: 'dues', testid: 'hub-dues' },
  { label: 'Settings lock', description: 'Lock the rules for the season.', panel: 'settings-lock', testid: 'hub-settings-lock' },
]

const SCHEDULE_LINKS: HubLink[] = [
  { label: 'Edit the schedule', description: 'Randomize it up to 25 times in the league chat, set a week by hand, rebuild it, or swap two teams.', panel: 'commissioner-tools:edit-schedule', testid: 'hub-edit-schedule' },
  { label: 'Divisions', description: 'How many, their names, who is in each, and division rivals twice.', panel: 'divisions', testid: 'hub-divisions' },
]

const NO_PLAYOFF_KINDS: ReadonlySet<HubKind> = new Set<HubKind>(['survivor', 'big_brother', 'guillotine'])
const ROOKIE_ORDER_KINDS: ReadonlySet<HubKind> = new Set<HubKind>(['dynasty', 'devy', 'c2c'])

export function leagueOptionLinks(kind: HubKind, leagueId: string): HubLink[] {
  const out: HubLink[] = [{ label: `${HUB_KIND_META[kind].label} rules`, description: 'The rules only this league type has.', panel: rulesEditorFor(kind), testid: 'hub-format-rules' }]
  if (kind === 'survivor') {
    out.push({ label: 'Idols', description: 'How many idols, their powers, and when they expire.', href: `/survivor/${encodeURIComponent(leagueId)}/settings`, testid: 'hub-survivor-idols' })
  }
  if (!NO_PLAYOFF_KINDS.has(kind)) {
    out.push({ label: 'Playoffs', description: 'Playoff teams, byes, and the median game.', panel: 'playoffs', testid: 'hub-playoffs' })
  }
  out.push({ label: 'League Chimmy', description: 'Chimmy’s helpers for managers, and what Chimmy watches for you.', panel: 'ai', testid: 'hub-league-chimmy' })
  out.push(
    ROOKIE_ORDER_KINDS.has(kind)
      ? { label: 'Draft and rookie order', description: 'Draft settings, and how next season’s rookie order is set.', panel: 'draft', testid: 'hub-draft' }
      : { label: 'Draft', description: 'Draft type, clock, rounds and order.', panel: 'draft', testid: 'hub-draft' },
  )
  return out
}

/** A link the AllFantasy option rows already open (same editor) is not listed twice. */
export function withoutAfDuplicates(links: HubLink[], options: HubAfOption[] | undefined): HubLink[] {
  if (!options?.length) return links
  const taken = new Set(options.flatMap((o) => [o.panel, o.href].filter(Boolean) as string[]))
  return links.filter((l) => !taken.has((l.panel ?? l.href) as string))
}

const TASK_DOT: Record<TaskCard['severity'], string> = { bad: '#ef4444', warn: '#f59e0b', info: '#3b82f6' }

/**
 * AllFantasy options as rows: the value, what it means, and the editor that changes it. `tagged` adds
 * "Also in Hub" (League Setup); `canOpen` hides the editor for a viewer who cannot change it.
 */
function AfOptionRows({ options, cb, canOpen, tagged = false }: { options: HubAfOption[]; cb: HubCallbacks; canOpen: boolean; tagged?: boolean }) {
  const { t } = useT()
  return (
    <div className="af-lsh-list" data-testid="af-options">
      {options.map((o) => (
        <div key={o.key} className="af-lsh-row" data-af-option="" data-testid={`af-option-${o.key}`}>
          <div className="af-lsh-row-copy" style={{ flex: '1 1 auto' }}>
            <span>
              {t(o.label)}
              {tagged ? <span className="af-lsh-af-tag">{t('Also in Hub')}</span> : null}
            </span>
            <span>{t(o.description)}</span>
          </div>
          <strong className="af-lsh-af-value">{t(o.value)}</strong>
          {!canOpen ? null : o.href ? (
            <a className="af-lsh-btn" data-size="sm" href={o.href} data-testid={`af-option-open-${o.key}`}>{t('Open')}</a>
          ) : o.panel ? (
            <button type="button" className="af-lsh-btn" data-size="sm" onClick={() => cb.onOpenEditor(o.panel as string)} data-testid={`af-option-open-${o.key}`}>{t('Open')}</button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** Each tool's icon, so a commissioner finds a row by its mark before reading it (Sleeper's settings list). */
const HUB_LINK_ICON: Record<string, LucideIcon> = {
  'hub-edit-lineups': ClipboardList,
  'hub-lock-roster': Lock,
  'hub-member-settings': UserCog,
  'hub-co-commissioners': Crown,
  'hub-score-adjustments': Scale,
  'hub-dues': Coins,
  'hub-settings-lock': LockKeyhole,
  'hub-edit-schedule': CalendarDays,
  'hub-divisions': Network,
  'hub-rivalry-open': Flame,
  'hub-playoffs': Trophy,
  'hub-league-chimmy': Sparkles,
  'hub-draft': Users,
}

/**
 * The hub's tools as one tappable row each — icon, name, one muted line, chevron — the way Sleeper's
 * commissioner settings read (owner report, 2026-11-28: the hub "looks like code, not ready for users").
 * It used to be a title, a sentence and a separate "Open" pill per row; on a phone the pills formed a
 * column under the floating chat buttons, and every row read as a form. The whole row is the button now.
 */
function HubLinks({ links, cb }: { links: HubLink[]; cb: HubCallbacks }) {
  const { t } = useT()
  return (
    <div className="af-lsh-list" data-variant="nav">
      {links.map((l) => {
        const Icon = HUB_LINK_ICON[l.testid] ?? Settings2
        const body = (
          <>
            <span className="af-lsh-nav-icon" aria-hidden><Icon size={18} strokeWidth={2} /></span>
            <span className="af-lsh-row-copy">
              <span>{t(l.label)}</span>
              <span>{t(l.description)}</span>
            </span>
            <ChevronRight className="af-lsh-nav-chevron" size={18} aria-hidden />
          </>
        )
        return l.href ? (
          <a key={l.testid} className="af-lsh-row af-lsh-nav" href={l.href} data-testid={l.testid}>{body}</a>
        ) : (
          <button key={l.testid} type="button" className="af-lsh-row af-lsh-nav" onClick={() => cb.onOpenEditor(l.panel as string)} data-testid={l.testid}>{body}</button>
        )
      })}
    </div>
  )
}

const TASK_TAG: Record<TaskCard['severity'], string> = { bad: 'Urgent', warn: 'Soon', info: 'Suggestion' }

/**
 * One thing that needs the commissioner: a severity tag, the title, at most two lines of detail (the
 * rest on tap), and the action as a real button under it — not a dot and an "Open" pill beside a
 * paragraph (owner report, 2026-11-28).
 */
function TaskRow({ card }: { card: TaskCard }) {
  const { t } = useT()
  const [more, setMore] = useState(false)
  const long = (card.detail?.length ?? 0) > 120
  return (
    <div className="af-lsh-task" data-testid="hub-task" data-severity={card.severity}>
      <div className="af-lsh-task-top">
        <span className="af-lsh-task-tag" style={{ color: TASK_DOT[card.severity], borderColor: TASK_DOT[card.severity] }}>{t(TASK_TAG[card.severity])}</span>
      </div>
      <strong className="af-lsh-task-title">{card.title}</strong>
      {card.detail ? (
        <p className="af-lsh-task-detail" data-clamped={long && !more ? 'true' : undefined}>
          {card.detail}
        </p>
      ) : null}
      {long ? (
        <button type="button" className="af-lsh-task-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          {t(more ? 'Show less' : 'Show more')}
        </button>
      ) : null}
      {card.action ? (
        <a
          className="af-lsh-btn"
          // Only the urgent card's action is the bright button; three in a row read as one shout.
          data-variant={card.severity === 'bad' ? 'primary' : undefined}
          href={card.action.href}
          {...(card.action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {card.action.label || t('Open')}
        </a>
      ) : null}
    </div>
  )
}

const GROUP_KIND_TEXT: Record<ConnectedGroup['kind'], { banner: string; hub: string; ownerOnly: string }> = {
  survivor: { banner: 'Main Island and Exile Island share one season.', hub: 'Open the Survivor commissioner page', ownerOnly: '' },
  tournament: { banner: 'This league is one of a tournament’s leagues.', hub: 'Open the tournament hub', ownerOnly: 'Only the tournament’s commissioner can schedule every draft at once.' },
  zombie: { banner: 'This league is one of a Zombie universe’s leagues.', hub: 'Open the universe hub', ownerOnly: 'Only the universe’s commissioner can schedule every draft at once.' },
}

const GROUP_STATUS: Record<string, string> = {
  setup: 'Setting up', forming: 'Forming', pre_draft: 'Before the draft', drafting: 'Drafting', draft: 'Drafting',
  in_season: 'In season', active: 'In season', playoffs: 'Playoffs', complete: 'Finished', completed: 'Finished', archived: 'Archived',
}

export function groupStatus(raw: string | null): string | null {
  if (!raw) return null
  return GROUP_STATUS[raw.toLowerCase()] ?? raw.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Connected leagues (owner's page review #16, Phase C4): every league that shares one game with this one,
 * where each stands, and the one decision that spans them — every draft at once — for the group's owner.
 * Everything else about the group stays on its own hub, linked at the bottom.
 */
export function ConnectedLeaguesDialog({ group, cb, onClose }: { group: ConnectedGroup; cb: HubCallbacks; onClose: () => void }) {
  const { t, lang } = useT()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const text = GROUP_KIND_TEXT[group.kind]
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const fmt = (v: string | null) => {
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString(lang === 'es' ? 'es' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  const schedule = async () => {
    if (!when || !cb.onScheduleConnectedDrafts) return
    const d = new Date(when)
    if (Number.isNaN(d.getTime())) return
    setBusy(true)
    setNote(null)
    const error = await cb.onScheduleConnectedDrafts(d.toISOString())
    setBusy(false)
    setNote(error ? { tone: 'error', text: error } : { tone: 'ok', text: 'Every draft is set for that time.' })
  }
  return (
    <div className="af-lsh-modal-backdrop" onClick={onClose} data-testid="connected-leagues-backdrop">
      <div className="af-lsh-modal" role="dialog" aria-modal="true" aria-labelledby="af-lsh-connected-title" onClick={(e) => e.stopPropagation()} data-testid="connected-leagues-dialog">
        <div className="af-lsh-card-head">
          <div>
            <h2 id="af-lsh-connected-title">{t('Connected leagues')}</h2>
            <p>{group.name} · {t(text.banner)}</p>
          </div>
          <button ref={closeRef} type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="af-lsh-list">
          {group.leagues.map((l, i) => {
            const status = groupStatus(l.status)
            const draft = fmt(l.draftAt)
            return (
              <div key={l.leagueId ?? `slot-${i}`} className="af-lsh-row" data-testid="connected-league">
                <div className="af-lsh-row-copy" style={{ flex: '1 1 auto' }}>
                  <span>
                    {l.name}
                    {l.current ? <span className="af-lsh-af-tag">{t('This league')}</span> : null}
                  </span>
                  <span>{[l.role ? t(l.role) : null, status ? t(status) : null, draft ? `${t('Draft')} ${draft}` : null].filter(Boolean).join(' · ')}</span>
                </div>
                {l.leagueId && !l.current ? <a className="af-lsh-btn" data-size="sm" href={`/league/${encodeURIComponent(l.leagueId)}`}>{t('Open')}</a> : null}
              </div>
            )
          })}
        </div>
        {group.draftSchedule ? (
          <div className="af-lsh-modal-section" data-testid="connected-schedule">
            <strong>{t('Schedule every draft at once')}</strong>
            <span>{t('Every league above drafts at the same time. You can still change one league’s draft from that league.')}</span>
            <div className="af-lsh-modal-row">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t('Draft time')} className="af-lsh-input" data-testid="connected-schedule-when" />
              <button type="button" className="af-lsh-btn" data-variant="primary" disabled={!when || busy} onClick={() => void schedule()} data-testid="connected-schedule-save">
                {t(busy ? 'Saving…' : 'Set every draft')}
              </button>
            </div>
            {note ? <p className="af-lsh-note" data-tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>{t(note.text)}</p> : null}
          </div>
        ) : !group.isGroupOwner && text.ownerOnly ? (
          <p className="af-lsh-empty" data-testid="connected-owner-only">{t(text.ownerOnly)}</p>
        ) : null}
        <div className="af-lsh-modal-foot">
          <a className="af-lsh-btn" href={group.hubHref} data-testid="connected-hub-link">{t(text.hub)}</a>
        </div>
      </div>
    </div>
  )
}

function CommissionerHubTab({ data, cb, slots }: { data: HubViewData; cb: HubCallbacks; slots?: HubSlots }) {
  const { t } = useT()
  const [showAll, setShowAll] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const tasks = data.commissionerTasks
  const count = tasks ? tasks.cards.length + tasks.overflow.length : 0
  return (
    // `display: contents` keeps the cards direct items of `.af-lsh-stack`, so they get its gap.
    <div data-testid="league-settings-hub-commissioner" style={{ display: 'contents' }}>
      {data.connected ? (
        <Card
          id="connected"
          title="Connected leagues"
          sub={GROUP_KIND_TEXT[data.connected.kind].banner}
          action={<button type="button" className="af-lsh-btn" data-variant="primary" data-size="sm" onClick={() => setGroupOpen(true)} data-testid="connected-open">{t('Open connected leagues')}</button>}
        >
          <p className="af-lsh-empty" style={{ paddingTop: 0 }}>{data.connected.name} · {t(data.connected.leagues.length === 1 ? '1 league' : `${data.connected.leagues.length} leagues`)}</p>
        </Card>
      ) : null}
      {groupOpen && data.connected ? <ConnectedLeaguesDialog group={data.connected} cb={cb} onClose={() => setGroupOpen(false)} /> : null}
      <Card id="needs" title={tasks && count ? `Needs you · ${count}` : 'Needs you'} sub="What needs you in this league, most urgent first.">
        {tasks === undefined ? (
          <Loading lines={2} />
        ) : tasks === null ? (
          <p className="af-lsh-empty">{t('Could not load what needs you. Try again in a minute.')}</p>
        ) : count === 0 ? (
          <p className="af-lsh-empty" data-testid="hub-tasks-empty">{t('Nothing needs you right now.')}</p>
        ) : (
          <div className="af-lsh-list">
            {tasks.cards.map((c) => <TaskRow key={c.id} card={c} />)}
            {showAll ? tasks.overflow.map((c) => <TaskRow key={c.id} card={c} />) : null}
            {tasks.overflow.length && !showAll ? (
              <div className="af-lsh-row">
                <button type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" onClick={() => setShowAll(true)}>
                  {t(`Show ${tasks.overflow.length} more`)}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </Card>
      <Card id="season" title="Season controls" sub="Lineups, locks, members and points, for any team.">
        <HubLinks links={SEASON_LINKS} cb={cb} />
      </Card>
      {/*
        Below Season controls, one closed row each (2026-11-25, the simplify pass), as in League Setup:
        open, the tab was ~2,700px on a phone. "Needs you" and Season controls — the queue and the tools
        used week to week — stay open; the section chips open what they jump to.
      */}
      <Card id="schedule" fold="closed" title="Schedule" sub="Who plays whom each week.">
        <HubLinks links={SCHEDULE_LINKS} cb={cb} />
      </Card>
      <Card id="rivalry" fold="closed" title="Rivalry Week" sub="Pick a week and pair each team with its biggest rival.">
        {slots?.rivalryWeek ?? <HubLinks links={[{ label: 'Set up Rivalry Week', description: 'Preview the pairs, then apply them to that week.', panel: 'commissioner-tools:edit-schedule', testid: 'hub-rivalry-open' }]} cb={cb} />}
      </Card>
      <Card id="options" fold="closed" title="League options" sub="The same settings as League Setup, with the editors that change them.">
        {data.afOptions === undefined ? <Loading lines={2} /> : data.afOptions.length ? <AfOptionRows options={data.afOptions} cb={cb} canOpen /> : null}
        <HubLinks links={withoutAfDuplicates(leagueOptionLinks(data.kind, data.leagueId), data.afOptions)} cb={cb} />
      </Card>
      <Card id="storyline" fold="closed" title="Storyline" sub="How Chimmy tells your season in the league chat.">
        {slots?.storyline ?? <p className="af-lsh-empty">{t('Storyline loads here on the league page.')}</p>}
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------------- My tab */

function MyTab({ data, cb, slots }: { data: HubViewData; cb: HubCallbacks; slots?: HubSlots }) {
  const { t } = useT()
  const [name, setName] = useState<string | null>(null)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const current = name ?? data.myTeam?.name ?? ''
  const dirty = name != null && name.trim() !== (data.myTeam?.name ?? '') && name.trim().length > 0

  const save = async () => {
    setSaving(true)
    setStatus(null)
    const err = await cb.onSaveTeamName(current.trim())
    setSaving(false)
    if (err) setStatus({ tone: 'error', text: err })
    else { setStatus({ tone: 'ok', text: 'Team name saved' }); setName(null) }
  }

  const n = data.notifications
  return (
    <>
      <Card id="team" title="My Team">
        <div className="af-lsh-card-body">
          {data.myTeam === undefined ? <Loading lines={2} /> : data.myTeam === null ? (
            <p className="af-lsh-note">{t('You don’t manage a team in this league.')}</p>
          ) : data.importedFrom ? (
            /*
              Read-only for an imported league (2026-11-15): a rename or avatar saved here would never
              reach the host platform, and the next sync would put the old name back. Show it, and say
              where it changes.
            */
            <div className="af-lsh-team" data-testid="lsh-team-mirror">
              <div className="af-lsh-team-avatar" aria-hidden>
                {data.myTeam.avatarUrl ? <img src={data.myTeam.avatarUrl} alt="" /> : initials(data.myTeam.name)}
              </div>
              <div className="af-lsh-field">
                <span className="af-lsh-label">{t('Team Name')}</span>
                <strong className="af-lsh-team-name">{data.myTeam.name}</strong>
                <p className="af-lsh-note" style={{ margin: 0 }}>{t(`Change your team name and avatar on ${data.importedFrom}.`)}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="af-lsh-team">
                <div className="af-lsh-team-avatar" aria-hidden>
                  {data.myTeam.avatarUrl ? <img src={data.myTeam.avatarUrl} alt="" /> : initials(data.myTeam.name)}
                </div>
                <div className="af-lsh-field">
                  <label htmlFor="af-lsh-team-name">{t('Team Name')}</label>
                  <div className="af-lsh-inline">
                    <input id="af-lsh-team-name" className="af-lsh-input" value={current} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void save() }} />
                    <button type="button" className="af-lsh-btn" data-variant="primary" disabled={!dirty || saving} onClick={() => void save()}>{t(saving ? 'Saving…' : 'Save')}</button>
                  </div>
                </div>
                <button type="button" className="af-lsh-btn" onClick={() => cb.onOpenEditor('my-team')}>{t('Change avatar')}</button>
              </div>
              {status ? <p className="af-lsh-note" data-tone={status.tone} role="status">{t(status.text)}</p> : null}
            </>
          )}
        </div>
      </Card>
      {/* Copy league (docs/league-page/COPY_LEAGUES_DESIGN.md): take a real team; renders nothing elsewhere. */}
      {slots?.copyLeague ?? null}

      <Card id="notifications" title="Notifications" sub="What pings you about this league">
        {n === undefined ? <Loading /> : n === null ? (
          <p className="af-lsh-empty">{t('Sign in again to manage notifications.')}</p>
        ) : (
          <>
            <div className="af-lsh-card-flush">
              <div className="af-lsh-row">
                <div className="af-lsh-row-copy">
                  <span>{t('Alerts for this league')}</span>
                  <span>{t('Turn off to silence this league without changing your other leagues')}</span>
                </div>
                <Switch on={n.leagueEnabled} label={t('Alerts for this league')} onChange={cb.onToggleLeagueNotifications} />
              </div>
            </div>
            {/*
              The per-category switches behind one row (2026-11-25, the simplify pass): ~14 rows open on a
              phone, under the one switch most people want here. The row says how many are on.
            */}
            <details className="af-lsh-subfold" data-testid="league-settings-notification-categories">
              <summary className="af-lsh-row">
                <span className="af-lsh-row-copy">
                  <span>{t('By category')}</span>
                  <span data-testid="league-settings-notification-count">
                    {(() => {
                      const all = n.groups.flatMap((g) => g.rows)
                      const on = n.leagueEnabled ? all.filter((r) => n.on[r.id] !== false).length : 0
                      return `${on} / ${all.length} ${t('on')}`
                    })()}
                  </span>
                </span>
                <span aria-hidden="true" className="af-lsh-subfold-chev">▾</span>
              </summary>
            <GroupGrid
              groups={n.groups.map((g) => ({
                key: g.key,
                label: g.label,
                rows: g.rows.map((r) => ({ key: r.id, label: r.label, description: r.description, value: null, toggle: { field: r.id, on: n.leagueEnabled && n.on[r.id] !== false } })),
              }))}
              canEdit={n.leagueEnabled}
              onToggle={(field, next) => cb.onToggleNotification(field as NotificationCategoryId, next)}
            />
            </details>
            <p className="af-lsh-empty">
              {t('Delivery channels (push, email, SMS) and quiet hours apply to every league.')} <a href="/settings?tab=notifications">{t('Manage them in account settings')}</a>.
            </p>
          </>
        )}
      </Card>

      {data.importedFrom ? null : (
      <Card id="leave" title="Leave League">
        <div className="af-lsh-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--lsh-muted)' }}>
            {t('Are you sure? Your team will be given up and you’ll lose access to this league.')}
            {data.isHeadCommissioner ? ` ${t('Hand the commissioner role to someone else first.')}` : ''}
          </span>
          <button type="button" className="af-lsh-btn" data-variant="danger" disabled={!cb.onLeaveLeague} onClick={cb.onLeaveLeague}>{t('LEAVE LEAGUE')}</button>
        </div>
      </Card>
      )}
    </>
  )
}

/* ------------------------------------------------------------- Setup tab */

function SetupTab({ data, cb, busyField }: { data: HubViewData; cb: HubCallbacks; busyField: string | null }) {
  const { t } = useT()
  const meta = HUB_KIND_META[data.kind]
  const edit = data.canEdit && !data.importedFrom
  const [cat, setCat] = useState<string | null>(null)
  const scoring = data.scoring
  const activeCat = scoring?.categories.find((c) => c.key === cat) ?? scoring?.categories[0] ?? null

  return (
    <>
      <Card id="general" fold="open" title="General Settings" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('general')} />}>
        <div className="af-lsh-card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="af-lsh-avatar" aria-hidden>{data.leagueAvatarUrl ? <img src={data.leagueAvatarUrl} alt="" /> : initials(data.leagueName)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--lsh-muted)', fontWeight: 600 }}>{t('League Name')}</span>
            <strong style={{ fontSize: 17 }}>{data.leagueName}</strong>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--lsh-muted)' }}>
              {t('League ID:')} <code style={{ fontSize: 12 }}>{data.leagueId}</code>
              <button type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" onClick={() => cb.onCopy(data.leagueId)} aria-label={t('Copy league ID')}>{t('Copy')}</button>
            </span>
          </div>
        </div>
        {data.general === undefined ? <Loading lines={5} /> : <GroupGrid groups={data.general} canEdit={edit} busyField={busyField} onToggle={cb.onToggleSetting} />}
      </Card>

      <Card id="waivers" fold="closed" title={data.kind === 'zombie' ? 'Free Agency' : 'Waiver Settings'} action={<EditButton show={edit} onClick={() => cb.onOpenEditor('waivers')} />}>
        {data.waivers === undefined ? <Loading /> : <GroupGrid groups={data.waivers} canEdit={edit} busyField={busyField} onToggle={cb.onToggleSetting} />}
      </Card>

      {data.typeRules === undefined || data.typeRules.length ? (
        <Card id="rules" fold="closed" title={meta.rulesTitle} sub={meta.blurb} action={<EditButton show={edit} onClick={() => cb.onOpenEditor(rulesEditorFor(data.kind))} />}>
          {data.typeRules === undefined ? <Loading /> : <GroupGrid groups={data.typeRules} canEdit={edit} />}
        </Card>
      ) : null}

      {data.afOptions === undefined || data.afOptions.length ? (
        <Card id="afoptions" fold="closed" title="AllFantasy options" sub="Rules only AllFantasy has. Each one is also in the Commissioner Hub.">
          {data.afOptions === undefined ? <Loading lines={2} /> : <AfOptionRows options={data.afOptions} cb={cb} canOpen={edit} tagged />}
        </Card>
      ) : null}

      <NotesCard note={data.commissionerNote} edit={edit} onSave={cb.onSaveNote} />

      <Card id="roster" fold="closed" title="Roster Settings" sub="Starting positions and roster spots" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('roster')} />}>
        {data.roster === undefined ? <Loading lines={4} /> : data.roster === null || data.roster.length === 0 ? (
          <p className="af-lsh-empty">{t('Roster positions aren’t available for this league yet.')}</p>
        ) : (
          <RosterList items={data.roster} />
        )}
      </Card>

      <Card id="scoring" fold="closed" title="Scoring Settings" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('scoring')} />}>
        {scoring === undefined ? <Loading lines={4} /> : scoring === null || !activeCat ? (
          <p className="af-lsh-empty">{t('Scoring rules aren’t available for this league yet.')}</p>
        ) : (
          <>
            <div className="af-lsh-row" style={{ borderTop: '1px solid var(--lsh-rule)' }}>
              <div className="af-lsh-row-copy"><span>{t('Scoring Preset')}</span></div>
              <span className="af-lsh-value">{scoring.preset ?? t('Custom')}</span>
            </div>
            <div className="af-lsh-pills" role="group" aria-label={t('Scoring categories')}>
              {scoring.categories.map((c) => (
                <button key={c.key} type="button" className="af-lsh-pill" aria-pressed={c.key === activeCat.key} onClick={() => setCat(c.key)}>{t(c.label)}</button>
              ))}
            </div>
            <ScoringRows rows={activeCat.rows} label={activeCat.label} />
          </>
        )}
      </Card>

      <Card id="draft" fold="closed" title="Draft Settings" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('draft')} />}>
        {data.draft === undefined ? <Loading lines={4} /> : <GroupGrid groups={data.draft} canEdit={edit} busyField={busyField} onToggle={cb.onToggleSetting} />}
        <div className="af-lsh-card-body" style={{ paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>{t('Draft Order')}</strong>
            <EditButton show={edit} label="Set order" onClick={() => cb.onOpenEditor('draft')} />
          </div>
          {data.draftOrder === undefined ? <Loading lines={3} /> : !data.draftOrder?.length ? (
            <p className="af-lsh-note" style={{ marginTop: 0 }}>{t('The draft order hasn’t been set yet.')}</p>
          ) : (
            <div className="af-lsh-table">
              <div className="af-lsh-tr af-lsh-order" data-head="true"><span>{t('Pick')}</span><span>{t('Manager')}</span><span /></div>
              {data.draftOrder.map((o) => (
                <div className="af-lsh-tr af-lsh-order" key={o.slot}>
                  <strong>{o.slot}</strong>
                  <span className="af-lsh-who"><Face name={o.name} /><span><strong>{t(o.name)}</strong></span></span>
                  <span />
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Head commissioner only. Deleting used to sit at the bottom of Lineups, locks & schedule, under the league history. */}
      {data.isHeadCommissioner && !data.importedFrom ? (
        <Card id="delete" title="Delete League">
          <div className="af-lsh-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--lsh-muted)' }}>
              {t('Removes this league, its draft and its history for every member. You’ll type the league name to confirm.')}
            </span>
            <button type="button" className="af-lsh-btn" data-variant="danger" onClick={() => cb.onOpenEditor('delete-league')} data-testid="league-settings-hub-delete">
              {t('DELETE LEAGUE')}
            </button>
          </div>
        </Card>
      ) : null}
    </>
  )
}

/** Sleeper lays scoring out in two columns: first half left, second half right. */
function ScoringRows({ rows, label }: { rows: HubScoringCategory['rows']; label: string }) {
  const { t, tStat } = useT()
  const half = Math.ceil(rows.length / 2)
  const cols = [rows.slice(0, half), rows.slice(half)].filter((c) => c.length)
  return (
    <>
      <div className="af-lsh-group-label" style={{ borderTop: '1px solid var(--lsh-rule)' }}>{t(label)}</div>
      <div className="af-lsh-grid" style={{ borderTop: 0 }}>
        {cols.map((col, i) => (
          <div className="af-lsh-col" key={i}>
            {col.map((r) => (
              <div className="af-lsh-row" key={r.key}>
                <div className="af-lsh-row-copy">
                  <span>{tStat(r.label)}</span>
                  {r.perUnit ? <span>{t(r.perUnit)}</span> : null}
                </div>
                <span className="af-lsh-points">{r.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function NotesCard({ note, edit, onSave }: { note: string | null | undefined; edit: boolean; onSave: (text: string) => Promise<string | null> }) {
  const { t } = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = draft != null
  const save = async () => {
    setSaving(true)
    setError(null)
    const err = await onSave(draft ?? '')
    setSaving(false)
    if (err) setError(err)
    else setDraft(null)
  }
  return (
    <Card
      id="notes"
      title="Commissioner Notes"
      sub={edit ? 'Pinned for every manager in the league' : undefined}
      action={edit && !editing && note !== undefined ? <button type="button" className="af-lsh-btn" data-size="sm" onClick={() => setDraft(note ?? '')}>{t(note ? 'Edit' : 'Add note')}</button> : null}
    >
      <div className="af-lsh-card-body">
        {note === undefined ? <Loading lines={1} /> : editing ? (
          <>
            <label htmlFor="af-lsh-note" className="af-lsh-sr">{t('Commissioner notes')}</label>
            <textarea id="af-lsh-note" className="af-lsh-input" style={{ minHeight: 120, padding: 12, lineHeight: 1.5, resize: 'vertical' }} maxLength={2000} value={draft ?? ''} onChange={(e) => setDraft(e.target.value)} />
            <div className="af-lsh-inline" style={{ marginTop: 10 }}>
              <button type="button" className="af-lsh-btn" data-variant="primary" disabled={saving} onClick={() => void save()}>{t(saving ? 'Saving…' : 'Save notes')}</button>
              <button type="button" className="af-lsh-btn" data-variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(null) }}>{t('Cancel')}</button>
            </div>
            {error ? <p className="af-lsh-note" data-tone="error" role="alert">{t(error)}</p> : null}
          </>
        ) : (
          <p style={{ margin: 0, whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.55, color: 'var(--lsh-muted)' }}>{note || t('No notes yet.')}</p>
        )}
      </div>
    </Card>
  )
}

function RosterList({ items }: { items: HubRosterItem[] }) {
  const { t } = useT()
  const sections = useMemo(() => {
    const map = new Map<string, HubRosterItem[]>()
    for (const it of items) map.set(it.section, [...(map.get(it.section) ?? []), it])
    return Array.from(map.entries())
  }, [items])
  return (
    <>
      {sections.map(([section, list]) => {
        const half = Math.ceil(list.length / 2)
        return (
          <div key={section}>
            {sections.length > 1 ? <div className="af-lsh-group-label" style={{ borderTop: '1px solid var(--lsh-rule)' }}>{t(section)}</div> : null}
            <div className="af-lsh-grid">
              {[list.slice(0, half), list.slice(half)].filter((c) => c.length).map((col, i) => (
                <div className="af-lsh-col" key={i}>
                  {col.map((it) => (
                    <div className="af-lsh-slot" key={it.key}>
                      <span className="af-lsh-dot" style={{ background: it.color }} aria-hidden />
                      <strong>{t(it.name)}</strong>
                      <small>{it.abbr}</small>
                      <b data-zero={it.count === 0 ? 'true' : undefined}>{it.count}</b>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

/* ----------------------------------------------------------- Members tab */

function MembersTab({ data, cb }: { data: HubViewData; cb: HubCallbacks }) {
  const { t } = useT()
  const edit = data.canEdit && !data.importedFrom
  const [username, setUsername] = useState('')
  const [coStatus, setCoStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [inviting, setInviting] = useState(false)

  const inviteCoOwner = async () => {
    setInviting(true)
    setCoStatus(null)
    const err = await cb.onInviteCoOwner(username.trim())
    setInviting(false)
    if (err) setCoStatus({ tone: 'error', text: err })
    else { setCoStatus({ tone: 'ok', text: `Invitation sent to ${username.trim()}` }); setUsername('') }
  }

  const members = data.members
  return (
    <>
      {/*
        Folded (2026-11-25, the simplify pass): it listed every manager with a switch, and "Manage Members"
        right below lists them again with their role. Only the head commissioner changes it.
      */}
      <Card id="commissioners" fold="closed" title="Set Commissioners" sub="Co-commissioners can make roster and lineup changes for any team and manage league settings">
        <div className="af-lsh-card-body">
          {members === undefined ? <Loading /> : (
            <div className="af-lsh-table">
              <div className="af-lsh-tr af-lsh-members" data-head="true"><span>{t('Manager')}</span><span className="team">{t('Team name')}</span><span>{t('Commish')}</span></div>
              {members.map((m) => (
                <div className="af-lsh-tr af-lsh-members" key={m.id} data-you={m.isYou ? 'true' : undefined}>
                  <span className="af-lsh-who"><Face name={m.name} src={m.avatarUrl} /><span><strong>{t(m.name)}{m.isYou ? ` ${t('(you)')}` : ''}</strong>{m.teamName ? <small className="who-team">{m.teamName}</small> : null}</span></span>
                  <span className="team">{m.teamName ?? '—'}</span>
                  {m.isCommissioner ? <span className="af-lsh-tag">{t('HEAD')}</span> : (
                    <Switch on={m.isCoCommissioner} label={t(`Co-commissioner: ${m.name}`)} disabled={!data.isHeadCommissioner || Boolean(data.importedFrom)} onChange={(next) => cb.onToggleCoCommissioner(m.id, next)} />
                  )}
                </div>
              ))}
            </div>
          )}
          {!data.isHeadCommissioner ? <p className="af-lsh-note">{t('Only the head commissioner can add or remove co-commissioners.')}</p> : null}
        </div>
      </Card>

      <Card id="coowners" title="Set Co-Owners" sub="A co-owner can set your lineup and make moves for your team">
        <div className="af-lsh-card-body">
          {data.coOwners === undefined ? <Loading lines={2} /> : data.coOwners === null ? (
            <p className="af-lsh-note" style={{ marginTop: 0 }}>{t(data.importedFrom ? `Co-owners are managed on ${data.importedFrom}.` : 'You need a team in this league to add a co-owner.')}</p>
          ) : (
            <>
              <label htmlFor="af-lsh-coowner" className="af-lsh-sr">{t('Co-owner username')}</label>
              <div className="af-lsh-inline">
                <input id="af-lsh-coowner" className="af-lsh-input" placeholder={t('AllFantasy username')} value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && username.trim()) void inviteCoOwner() }} />
                <button type="button" className="af-lsh-btn" data-variant="primary" disabled={!username.trim() || inviting} onClick={() => void inviteCoOwner()}>{t(inviting ? 'Inviting…' : 'Invite')}</button>
              </div>
              {coStatus ? <p className="af-lsh-note" data-tone={coStatus.tone} role="status">{t(coStatus.text)}</p> : null}
              {data.coOwners.invitations.length ? (
                <div className="af-lsh-list" style={{ marginTop: 12 }}>
                  {data.coOwners.invitations.map((c) => (
                    <div className="af-lsh-season" key={c.id}>
                      <Face name={c.name} />
                      <div><strong>{t(c.name)}</strong><span>{t(c.accepted ? 'Co-owner' : 'Invitation pending')}</span></div>
                    </div>
                  ))}
                </div>
              ) : <p className="af-lsh-note">{t('No co-owners yet.')}</p>}
            </>
          )}
        </div>
      </Card>

      <Card id="managers" title="Manage Members" sub="Assign or remove members from rosters and the league" action={<EditButton show={edit} label="Manage" onClick={() => cb.onOpenEditor('members')} />}>
        <div className="af-lsh-card-body">
          {members === undefined ? <Loading /> : (
            <div className="af-lsh-table">
              {members.map((m) => (
                <div className="af-lsh-tr af-lsh-members" key={m.id}>
                  <span className="af-lsh-who"><Face name={m.name} src={m.avatarUrl} /><span><strong>{t(m.name)}</strong><small className="who-team">{m.teamName ?? t('Open team')}</small></span></span>
                  <span className="team">{m.teamName ?? t('Open team')}</span>
                  <span style={{ color: 'var(--lsh-muted)', fontSize: 12 }}>{t(m.isCommissioner ? 'Commissioner' : m.isCoCommissioner ? 'Co-commish' : 'Manager')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card id="invite" title="Invite to League" sub="Invite friends to fill the league">
        <div className="af-lsh-card-body">
          {data.invite === undefined ? <Loading lines={2} /> : (
            <div className="af-lsh-split">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <strong style={{ fontSize: 14 }}>{t('League spots')}</strong>
                  {data.invite?.capacity ? (
                    <span style={{ fontSize: 13, fontWeight: 750, color: data.invite.filled >= data.invite.capacity ? '#fcd34d' : 'var(--lsh-text)' }}>
                      {data.invite.filled} / {data.invite.capacity}{data.invite.filled >= data.invite.capacity ? ` · ${t('Full')}` : ''}
                    </span>
                  ) : null}
                </div>
                <p className="af-lsh-note">
                  {t(data.invite?.link ? 'Anyone with the link can request to join while spots are open.' : 'Ask your commissioner for the league invite link.')}
                </p>
              </div>
              {data.invite?.link ? (
                <div className="af-lsh-share">
                  <span className="af-lsh-eyebrow">{t('Share your league')}</span>
                  <div className="af-lsh-link"><span>{data.invite.link.replace(/^https?:\/\//, '')}</span><button type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" onClick={() => cb.onCopy(data.invite!.link!)} aria-label={t('Copy invite link')}>{t('Copy')}</button></div>
                  {cb.onShare ? <button type="button" className="af-lsh-btn" data-variant="primary" onClick={() => cb.onShare!(data.invite!.link!)}>{t('Share')}</button> : null}
                  <button type="button" className="af-lsh-btn" onClick={() => cb.onOpenEditor('invite')}>{t('QR code & more')}</button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------ Record tab */

const STATUS_LEGEND = [
  { tag: 'P', name: 'Probable', d: 'Very likely to play', bg: '#0b2b22', fg: '#6ee7b7' },
  { tag: 'Q', name: 'Questionable', d: 'About a 50/50 chance to play', bg: '#2a2108', fg: '#fcd34d' },
  { tag: 'D', name: 'Doubtful', d: 'Unlikely to play', bg: '#2b1609', fg: '#fdba74' },
  { tag: 'O', name: 'Out', d: 'Will not play', bg: '#2b0f14', fg: '#fca5a5' },
]
const INJURED_STYLE = { bg: '#2b0f14', fg: '#fca5a5' }
const MATCHUP_COLORS: Record<string, string> = { Easy: '#6ee7b7', Neutral: '#e6edf7', Tough: '#fca5a5' }

/** Sleeper's week stepper, showing what is actually stored: final or still open, and when rescored. */
function CorrectionWeeks({ data }: { data: HubViewData['correctionWeeks'] }) {
  const { t, lang } = useT()
  const weeks = data?.weeks ?? []
  const [idx, setIdx] = useState<number | null>(null)
  if (data === undefined) return <Loading lines={2} />
  if (!weeks.length) return <p className="af-lsh-empty" style={{ paddingTop: 0 }}>{t('No scored weeks yet this season.')}</p>
  const i = idx ?? weeks.length - 1
  const w = weeks[Math.min(i, weeks.length - 1)]
  const rescored = w.rescoredAt ? new Date(w.rescoredAt) : null
  return (
    <div className="af-lsh-card-body" data-testid="league-settings-hub-corrections">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--lsh-rule)' }}>
        <strong style={{ fontSize: 14 }}>{t('Week')}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 12, border: '1px solid rgba(255,255,255,.14)' }}>
          <button type="button" className="af-lsh-btn" data-variant="ghost" data-size="sm" style={{ border: 0, minWidth: 40 }} aria-label={t('Previous week')} disabled={i <= 0} onClick={() => setIdx((prev) => Math.max(0, (prev ?? weeks.length - 1) - 1))}>‹</button>
          <span style={{ minWidth: 72, textAlign: 'center', fontSize: 13, fontWeight: 700 }} aria-live="polite">{t(`Week ${w.week}`)}</span>
          <button type="button" className="af-lsh-btn" data-variant="ghost" data-size="sm" style={{ border: 0, minWidth: 40 }} aria-label={t('Next week')} disabled={i >= weeks.length - 1} onClick={() => setIdx((prev) => Math.min(weeks.length - 1, (prev ?? weeks.length - 1) + 1))}>›</button>
        </div>
      </div>
      <div className="af-lsh-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="af-lsh-row-copy">
          <span>{t(w.final ? 'Scores are final' : 'Open for stat corrections')}</span>
          <span>{t(w.final ? 'This week is past the correction window.' : 'Points can still change as official corrections come in.')}</span>
        </div>
        <span className="af-lsh-tag" style={w.final ? undefined : { background: '#2a2108', color: '#fcd34d' }}>{t(w.final ? 'FINAL' : 'OPEN')}</span>
      </div>
      <div className="af-lsh-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="af-lsh-row-copy">
          <span>{t('Rescored after corrections')}</span>
          <span>{t('Each player’s total already includes any correction')}</span>
        </div>
        <span className="af-lsh-value" data-empty={rescored ? undefined : 'true'}>
          {rescored ? rescored.toLocaleDateString(hubLocale(lang), { month: 'short', day: 'numeric' }) : t('Not rescored')}
        </span>
      </div>
      {w.changes ? <CorrectionChanges changes={w.changes} /> : null}
    </div>
  )
}

const pts = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/** The players this week's correction check found changed: before → after, biggest change first. */
function CorrectionChanges({ changes }: { changes: NonNullable<CorrectionWeek['changes']> }) {
  const { t } = useT()
  const [all, setAll] = useState(false)
  const shown = all ? changes : changes.slice(0, 8)
  return (
    <div style={{ paddingTop: 12 }} data-testid="league-settings-hub-correction-changes">
      <strong style={{ fontSize: 14 }}>{t('Player changes')}</strong>
      {!changes.length ? (
        <p className="af-lsh-note" style={{ marginTop: 6 }}>{t('Checked against the official stats — no player’s points changed.')}</p>
      ) : (
        <>
          <div className="af-lsh-table" style={{ marginTop: 8 }}>
            <div className="af-lsh-tr af-lsh-records" data-head="true"><span /><span>{t('Player')}</span><span className="r">{t('Change')}</span></div>
            {shown.map((c, i) => (
              <div className="af-lsh-tr af-lsh-records" key={`${c.player}-${c.team}-${i}`}>
                <span style={{ color: 'var(--lsh-muted)', fontWeight: 700, fontSize: 11 }}>{c.position ?? ''}</span>
                <span className="af-lsh-who">
                  <span>
                    <strong>{c.player}</strong>
                    <small style={{ whiteSpace: 'normal' }}>{t(c.team)} · {pts(c.before)} → {pts(c.after)}</small>
                  </span>
                </span>
                <strong className="r" style={{ color: c.delta > 0 ? '#6ee7b7' : c.delta < 0 ? '#fca5a5' : undefined }}>
                  {c.delta > 0 ? '+' : ''}{pts(c.delta)}
                </strong>
              </div>
            ))}
          </div>
          {changes.length > shown.length || all ? (
            <button type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" style={{ marginTop: 8 }} onClick={() => setAll((v) => !v)}>
              {all ? t('Show fewer') : t(`Show all ${changes.length}`)}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

function RecordTab({ data }: { data: HubViewData }) {
  const { t, lang } = useT()
  const note = statCorrectionNote(data.kind)
  const copy = sportCopy(data.sport)
  const seasonsText = (s: number[]) => hubSeasons(lang, seasonsLabel(s))
  const wk = (season: number | null | undefined, week: number | null | undefined) => `${season ?? ''}${week ? ` ${t('Wk')} ${week}` : ''}`
  return (
    <>
      {/*
        Record Book, folded like League Setup (2026-11-25, the simplify pass): League History open, the
        other four one closed row each. Open, the tab was ~4,400px on a phone — two 8-row high-score tables,
        three paragraphs on how corrections work and a colour legend under the history. The section chips
        open what they jump to.
      */}
      <Card id="history" fold="open" title="League History" sub="Draft results and every past season">
        <div className="af-lsh-card-body">
          <div className="af-lsh-split" data-even="true">
            <div className="af-lsh-list">
              <span className="af-lsh-eyebrow">{t('Draft')}</span>
              {data.draftHistory === undefined ? <Loading lines={1} /> : data.draftHistory ? (
                <div className="af-lsh-season"><div><strong>{t(data.draftHistory.title)}</strong><span>{data.draftHistory.status.split(' · ').map((part) => t(part)).join(' · ')}</span></div></div>
              ) : <p className="af-lsh-note" style={{ marginTop: 0 }}>{t('No draft scheduled yet.')}</p>}
            </div>
            <div className="af-lsh-list">
              <span className="af-lsh-eyebrow">{t('Past seasons')}</span>
              {data.seasons === undefined ? <Loading lines={2} /> : !data.seasons?.length ? (
                <p className="af-lsh-note" style={{ marginTop: 0 }}>{t('Past seasons appear here once one is complete.')}</p>
              ) : data.seasons.map((s) => (
                <div className="af-lsh-season" key={s.year}>
                  <div>
                    <strong>{t(`${s.year} Season`)}</strong>
                    <span>{s.champion ? `${t(championWord(data.kind))} · ${s.champion}` : t('Champion not recorded')}{s.runnerUp ? ` · ${t(`Runner-up ${s.runnerUp}`)}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card id="standings" fold="closed" title="All-Time Standings" sub="Every season this league has played, added up">
        <div className="af-lsh-card-body">
          {data.standings === undefined ? <Loading /> : !data.standings?.length ? (
            <p className="af-lsh-note" style={{ marginTop: 0 }}>{t('All-time standings start after the first completed season.')}</p>
          ) : (
            <div className="af-lsh-table">
              <div className="af-lsh-tr af-lsh-standings" data-head="true"><span>#</span><span>{t('Manager')}</span><span className="r">{t('Win %')}</span><span className="r">{t('PF')}</span><span className="r wide">{t('Seasons')}</span><span className="r wide">{t('Titles')}</span></div>
              {data.standings.map((s) => (
                <div className="af-lsh-tr af-lsh-standings" key={s.rank}>
                  <span style={{ color: 'var(--lsh-muted)', fontWeight: 700 }}>{s.rank}</span>
                  <span className="af-lsh-who"><Face name={s.name} src={s.avatar} /><span><strong>{s.name}</strong><small>{s.record}</small></span></span>
                  <span className="r" style={{ fontWeight: 700 }}>{s.winPct}</span>
                  <span className="r">{s.pointsFor}</span>
                  <span className="r wide">{s.seasons}</span>
                  <span className="r wide">{s.titles}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card id="highs" fold="closed" title="All-Time High Scores" sub="The league’s biggest weeks, by team and by player">
        <div className="af-lsh-card-body">
          <div className="af-lsh-split" data-even="true">
            <div className="af-lsh-list">
              <strong style={{ fontSize: 15 }}>{t('Weekly high scores')}</strong>
              {data.highScores === undefined ? <Loading /> : !data.highScores?.length ? (
                <p className="af-lsh-note" style={{ marginTop: 0 }}>{t('High scores are recorded after each completed week.')}</p>
              ) : (
                <div className="af-lsh-table">
                  <div className="af-lsh-tr af-lsh-records" data-head="true"><span /><span>{t('Team')}</span><span className="r">{t('Score')}</span></div>
                  {data.highScores.map((h) => (
                    <div className="af-lsh-tr af-lsh-records" key={h.rank}>
                      <span style={{ color: 'var(--lsh-muted)', fontWeight: 700 }}>{h.rank}</span>
                      <span className="af-lsh-who"><Face name={h.holder} /><span><strong>{t(h.holder)}</strong>{h.season ? <small>{wk(h.season, h.week)}</small> : null}</span></span>
                      <strong className="r">{h.value}</strong>
                    </div>
                  ))}
                </div>
              )}
              {data.highScores?.length && data.highScoresSeasons?.length ? (
                <span className="af-lsh-note" style={{ marginTop: 0 }}>{t('From final results')} · {t(`${seasonsText(data.highScoresSeasons)} seasons`)}</span>
              ) : null}
            </div>
            <div className="af-lsh-list" data-testid="league-settings-hub-player-highs">
              <strong style={{ fontSize: 15 }}>{t('Player high scores')}</strong>
              {data.playerHighScores === undefined ? <Loading /> : !data.playerHighScores?.rows.length ? (
                <p className="af-lsh-note" style={{ marginTop: 0 }}>{t('Player high scores appear once a week’s scores are final.')}</p>
              ) : (
                <>
                  <div className="af-lsh-table">
                    <div className="af-lsh-tr af-lsh-records" data-head="true"><span /><span>{t('Player')}</span><span className="r">{t('Score')}</span></div>
                    {data.playerHighScores.rows.map((p) => (
                      <div className="af-lsh-tr af-lsh-records" key={`${p.rank}-${p.name}`}>
                        <span style={{ color: 'var(--lsh-muted)', fontWeight: 700 }}>{p.rank}</span>
                        <span className="af-lsh-who"><Face name={p.name} /><span><strong>{p.name}</strong><small style={{ whiteSpace: 'normal' }}>{p.team} · {wk(p.season, p.week)}</small></span></span>
                        <strong className="r">{p.points}</strong>
                      </div>
                    ))}
                  </div>
                  <span className="af-lsh-note" style={{ marginTop: 0 }}>
                    {t('Starters only')}{data.playerHighScores.seasons.length ? ` · ${t(`${seasonsText(data.playerHighScores.seasons)} seasons`)}` : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card id="corrections" fold="closed" title="Stat Corrections" sub="Corrections are applied retroactively to each player’s total">
        <CorrectionWeeks data={data.correctionWeeks} />
        <div className="af-lsh-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--lsh-muted)' }}>
          <span>{t('Our stats feed updates live during games, then posts official corrections over the next few days.')}</span>
          <span>{t(copy.correctionTiming)}</span>
          <span>{t('If the feed pauses or misses a play, it’s corrected to match the official league stats.')}</span>
          {note ? <span style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--lsh-soft)', color: 'var(--lsh-text)' }}>{t(note)}</span> : null}
        </div>
      </Card>

      <Card id="legend" fold="closed" title="League Legend" sub="What the colors and tags mean">
        <div className="af-lsh-card-body">
          <div className="af-lsh-legend">
            <div>
              <strong>{t('Player status')}</strong>
              {[...STATUS_LEGEND, { ...copy.injured, ...INJURED_STYLE }].map((s) => (
                <div className="af-lsh-legend-item" key={s.tag}>
                  <span className="af-lsh-legend-tag" style={{ background: s.bg, color: s.fg }}>{s.tag}</span>
                  <div><b style={{ color: s.fg }}>{t(s.name)}</b><span>{t(s.d)}</span></div>
                </div>
              ))}
            </div>
            <div>
              <strong>{t(copy.matchupTitle)}</strong>
              {copy.matchup.map((m) => (
                <div className="af-lsh-legend-item" key={m.tag}>
                  <div><b style={{ color: MATCHUP_COLORS[m.name] }}>{m.tag} <span style={{ color: 'var(--lsh-muted)', fontWeight: 600 }}>· {t(m.name)}</span></b><span>{t(m.d)}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}

