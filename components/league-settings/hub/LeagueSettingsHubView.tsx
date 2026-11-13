'use client'

/**
 * Presentational League Settings hub — four Sleeper-parity tabs (My Settings, League
 * Setup, Members, Record Book) in the AllFantasy league surface. Pure props in, callbacks
 * out: `LeagueSettingsHub` owns every fetch and save, and the /e2e preview renders this
 * same component from fixtures, so what the preview shows is what the league page renders.
 */

import { useMemo, useState, type ReactNode } from 'react'
import './league-settings-hub.css'
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
  type HubStandingRow,
} from '@/lib/league-settings-hub/hubModel'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'

export type HubTabId = 'my' | 'setup' | 'members' | 'record'

export type HubMember = {
  id: string
  name: string
  teamName: string | null
  avatarUrl: string | null
  isCommissioner: boolean
  isCoCommissioner: boolean
  isYou: boolean
}

export type HubCoOwner = { id: string; name: string; accepted: boolean }

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
  highScores: Array<{ rank: number; holder: string; season: number | null; value: string }> | null | undefined
  /** Biggest single-week starter scores; `seasons` is the window the rows cover. */
  playerHighScores:
    | { seasons: number[]; rows: Array<{ rank: number; name: string; team: string; season: number; week: number; points: string }> }
    | null
    | undefined
  /** Per week of `season`: final vs still open to corrections, and when it was rescored. */
  correctionWeeks: { season: number; weeks: Array<{ week: number; final: boolean; rescoredAt: string | null }> } | null | undefined
}

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
}

const TABS: Array<{ id: HubTabId; label: string }> = [
  { id: 'my', label: 'My Settings' },
  { id: 'setup', label: 'League Setup' },
  { id: 'members', label: 'Members' },
  { id: 'record', label: 'Record Book' },
]

export function LeagueSettingsHubView({
  data,
  cb,
  initialTab = 'setup',
  busyField = null,
  advanced,
}: {
  data: HubViewData
  cb: HubCallbacks
  initialTab?: HubTabId
  /** Field currently saving — its switch is disabled until the PATCH returns. */
  busyField?: string | null
  /** Optional "Advanced settings" escape hatch to the full legacy editor. */
  advanced?: { label: string; onOpen: () => void }
}) {
  const [tab, setTab] = useState<HubTabId>(initialTab)
  const meta = HUB_KIND_META[data.kind]
  const locked = !data.canEdit
  const sections = useMemo(() => sectionsFor(tab, data), [tab, data])

  return (
    <div className="af-lsh af-league-surface" data-league-art={data.leagueArt ?? undefined} data-testid="league-settings-hub">
      <header className="af-lsh-head">
        <div className="af-lsh-avatar" aria-hidden>
          {data.leagueAvatarUrl ? <img src={data.leagueAvatarUrl} alt="" /> : initials(data.leagueName)}
        </div>
        <div className="af-lsh-head-copy">
          <h1>{data.leagueName}</h1>
          <div className="af-lsh-meta">
            <span className="af-lsh-badge" data-testid="league-settings-hub-type">{meta.label}</span>
            <span>{[data.season, data.sport, data.teamCount ? `${data.teamCount} teams` : null].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <span className="af-lsh-role" data-locked={locked}>
          {data.importedFrom ? 'Read-only mirror' : locked ? 'View only' : data.isHeadCommissioner ? 'Commissioner' : 'Co-commissioner'}
        </span>
      </header>

      <div className="af-lsh-tabbar">
      <div className="af-lsh-tabs" role="tablist" aria-label="League settings">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`af-lsh-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="af-lsh-panel"
            className="af-lsh-tab"
            onClick={() => setTab(t.id)}
            data-testid={`league-settings-hub-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
        {advanced ? (
          <button type="button" className="af-lsh-btn" data-variant="ghost" onClick={advanced.onOpen} data-testid="league-settings-hub-advanced">
            {advanced.label}
          </button>
        ) : null}
      </div>

      <div className="af-lsh-body" id="af-lsh-panel" role="tabpanel" aria-labelledby={`af-lsh-tab-${tab}`}>
        <nav className="af-lsh-jump" aria-label="On this page">
          <span className="af-lsh-jump-label">On this page</span>
          {sections.map((s) => (
            <a key={s.id} href={`#af-lsh-${s.id}`}>{s.label}</a>
          ))}
          <div className="af-lsh-format">
            <span className="af-lsh-eyebrow">Format</span>
            <strong>{meta.label}</strong>
            <span>{meta.blurb}</span>
          </div>
        </nav>
        <div className="af-lsh-stack">
          <nav className="af-lsh-chips" aria-label="Sections">
            {sections.map((s) => (
              <a key={s.id} href={`#af-lsh-${s.id}`}>{s.label}</a>
            ))}
          </nav>
          {data.importedFrom && tab === 'setup' ? (
            <div className="af-lsh-banner" data-tone="info">
              <div>
                <strong>Imported from {data.importedFrom}</strong>
                <p>These rules mirror your host league. Change them on {data.importedFrom} and they sync here.</p>
              </div>
            </div>
          ) : locked && tab === 'setup' ? (
            <div className="af-lsh-banner" role="note">
              <div>
                <strong>Only commissioners can change league settings</strong>
                <p>You can see every rule. Ask your commissioner if something looks off.</p>
              </div>
            </div>
          ) : null}
          {tab === 'my' ? <MyTab data={data} cb={cb} /> : null}
          {tab === 'setup' ? <SetupTab data={data} cb={cb} busyField={busyField} /> : null}
          {tab === 'members' ? <MembersTab data={data} cb={cb} /> : null}
          {tab === 'record' ? <RecordTab data={data} /> : null}
        </div>
      </div>
    </div>
  )
}

function sectionsFor(tab: HubTabId, data: HubViewData): Array<{ id: string; label: string }> {
  const meta = HUB_KIND_META[data.kind]
  if (tab === 'my') return [{ id: 'team', label: 'My Team' }, { id: 'notifications', label: 'Notifications' }, { id: 'leave', label: 'Leave League' }]
  if (tab === 'setup') {
    const out = [{ id: 'general', label: 'General' }, { id: 'waivers', label: 'Waivers' }]
    if (data.typeRules === undefined || data.typeRules.length) out.push({ id: 'rules', label: meta.rulesTitle })
    out.push({ id: 'notes', label: 'Commish Notes' }, { id: 'roster', label: 'Roster' }, { id: 'scoring', label: 'Scoring' }, { id: 'draft', label: 'Draft' })
    return out
  }
  if (tab === 'members') return [{ id: 'commissioners', label: 'Commissioners' }, { id: 'coowners', label: 'Co-Owners' }, { id: 'managers', label: 'Managers' }, { id: 'invite', label: 'Invite' }]
  return [{ id: 'history', label: 'League History' }, { id: 'standings', label: 'All-Time Standings' }, { id: 'highs', label: 'High Scores' }, { id: 'corrections', label: 'Stat Corrections' }, { id: 'legend', label: 'League Legend' }]
}

/* ------------------------------------------------------------ primitives */

function Card({ id, title, sub, action, children }: { id: string; title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="af-lsh-card" id={`af-lsh-${id}`} aria-labelledby={`af-lsh-${id}-title`}>
      <div className="af-lsh-card-head">
        <div>
          <h2 id={`af-lsh-${id}-title`}>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EditButton({ show, onClick, label = 'Edit' }: { show: boolean; onClick: () => void; label?: string }) {
  if (!show) return null
  return <button type="button" className="af-lsh-btn" data-size="sm" onClick={onClick}>{label}</button>
}

export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="af-lsh-switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span><span /></span>
    </button>
  )
}

function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 18px 20px' }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="af-lsh-skeleton" style={{ width: `${70 - i * 12}%` }} />)}
    </div>
  )
}

function Face({ name, src }: { name: string; src?: string | null }) {
  return <span className="af-lsh-face" aria-hidden>{src ? <img src={src} alt="" /> : initials(name)}</span>
}

function RowView({ row, canEdit, busyField, onToggle }: { row: HubRow; canEdit: boolean; busyField?: string | null; onToggle?: (field: string, next: boolean) => void }) {
  return (
    <>
      <div className="af-lsh-row" data-indent={row.indent ? 'true' : undefined}>
        <div className="af-lsh-row-copy">
          <span>{row.label}</span>
          {row.description ? <span>{row.description}</span> : null}
        </div>
        {row.toggle && onToggle ? (
          <Switch
            on={row.toggle.on}
            label={row.label}
            disabled={!canEdit || busyField === row.toggle.field}
            onChange={(next) => onToggle(row.toggle!.field, next)}
          />
        ) : row.schedule ? null : (
          <span className="af-lsh-value" data-empty={row.value == null ? 'true' : undefined}>{row.value ?? '—'}</span>
        )}
      </div>
      {row.schedule ? (
        <div className="af-lsh-schedule">
          {row.schedule.map((d) => (
            <div key={d.day}><span>{d.day}</span><span>{d.mode}</span></div>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** Groups flow into two columns at tablet width and up, balanced by row count. */
function GroupGrid({ groups, canEdit, busyField, onToggle }: { groups: HubGroup[]; canEdit: boolean; busyField?: string | null; onToggle?: (field: string, next: boolean) => void }) {
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
              {g.label ? <div className="af-lsh-group-label">{g.label}</div> : null}
              {g.rows.map((r) => <RowView key={r.key} row={r} canEdit={canEdit} busyField={busyField} onToggle={onToggle} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- My tab */

function MyTab({ data, cb }: { data: HubViewData; cb: HubCallbacks }) {
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
            <p className="af-lsh-note">You don’t manage a team in this league.</p>
          ) : (
            <>
              <div className="af-lsh-team">
                <div className="af-lsh-team-avatar" aria-hidden>
                  {data.myTeam.avatarUrl ? <img src={data.myTeam.avatarUrl} alt="" /> : initials(data.myTeam.name)}
                </div>
                <div className="af-lsh-field">
                  <label htmlFor="af-lsh-team-name">Team Name</label>
                  <div className="af-lsh-inline">
                    <input id="af-lsh-team-name" className="af-lsh-input" value={current} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void save() }} />
                    <button type="button" className="af-lsh-btn" data-variant="primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
                <button type="button" className="af-lsh-btn" onClick={() => cb.onOpenEditor('my-team')}>Change avatar</button>
              </div>
              {status ? <p className="af-lsh-note" data-tone={status.tone} role="status">{status.text}</p> : null}
            </>
          )}
        </div>
      </Card>

      <Card id="notifications" title="Notifications" sub="What pings you about this league">
        {n === undefined ? <Loading /> : n === null ? (
          <p className="af-lsh-empty">Sign in again to manage notifications.</p>
        ) : (
          <>
            <div className="af-lsh-card-flush">
              <div className="af-lsh-row">
                <div className="af-lsh-row-copy">
                  <span>Alerts for this league</span>
                  <span>Turn off to silence this league without changing your other leagues</span>
                </div>
                <Switch on={n.leagueEnabled} label="Alerts for this league" onChange={cb.onToggleLeagueNotifications} />
              </div>
            </div>
            <GroupGrid
              groups={n.groups.map((g) => ({
                key: g.key,
                label: g.label,
                rows: g.rows.map((r) => ({ key: r.id, label: r.label, description: r.description, value: null, toggle: { field: r.id, on: n.leagueEnabled && n.on[r.id] !== false } })),
              }))}
              canEdit={n.leagueEnabled}
              onToggle={(field, next) => cb.onToggleNotification(field as NotificationCategoryId, next)}
            />
            <p className="af-lsh-empty">
              Delivery channels (push, email, SMS) and quiet hours apply to every league. <a href="/settings?tab=notifications">Manage them in account settings</a>.
            </p>
          </>
        )}
      </Card>

      <Card id="leave" title="Leave League">
        <div className="af-lsh-card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--lsh-muted)' }}>
            Are you sure? Your team will be given up and you’ll lose access to this league.
            {data.isHeadCommissioner ? ' Hand the commissioner role to someone else first.' : ''}
          </span>
          <button type="button" className="af-lsh-btn" data-variant="danger" disabled={!cb.onLeaveLeague} onClick={cb.onLeaveLeague}>LEAVE LEAGUE</button>
        </div>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------- Setup tab */

function SetupTab({ data, cb, busyField }: { data: HubViewData; cb: HubCallbacks; busyField: string | null }) {
  const meta = HUB_KIND_META[data.kind]
  const edit = data.canEdit && !data.importedFrom
  const [cat, setCat] = useState<string | null>(null)
  const scoring = data.scoring
  const activeCat = scoring?.categories.find((c) => c.key === cat) ?? scoring?.categories[0] ?? null

  return (
    <>
      <Card id="general" title="General Settings" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('commish-general')} />}>
        <div className="af-lsh-card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="af-lsh-avatar" aria-hidden>{data.leagueAvatarUrl ? <img src={data.leagueAvatarUrl} alt="" /> : initials(data.leagueName)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--lsh-muted)', fontWeight: 600 }}>League Name</span>
            <strong style={{ fontSize: 17 }}>{data.leagueName}</strong>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--lsh-muted)' }}>
              League ID: <code style={{ fontSize: 12 }}>{data.leagueId}</code>
              <button type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" onClick={() => cb.onCopy(data.leagueId)} aria-label="Copy league ID">Copy</button>
            </span>
          </div>
        </div>
        {data.general === undefined ? <Loading lines={5} /> : <GroupGrid groups={data.general} canEdit={edit} busyField={busyField} onToggle={cb.onToggleSetting} />}
      </Card>

      <Card id="waivers" title={data.kind === 'zombie' ? 'Free Agency' : 'Waiver Settings'} action={<EditButton show={edit} onClick={() => cb.onOpenEditor('commish-general')} />}>
        {data.waivers === undefined ? <Loading /> : <GroupGrid groups={data.waivers} canEdit={edit} busyField={busyField} onToggle={cb.onToggleSetting} />}
      </Card>

      {data.typeRules === undefined || data.typeRules.length ? (
        <Card id="rules" title={meta.rulesTitle} sub={meta.blurb} action={<EditButton show={edit} onClick={() => cb.onOpenEditor('commish-controls')} />}>
          {data.typeRules === undefined ? <Loading /> : <GroupGrid groups={data.typeRules} canEdit={edit} />}
        </Card>
      ) : null}

      <NotesCard note={data.commissionerNote} edit={edit} onSave={cb.onSaveNote} />

      <Card id="roster" title="Roster Settings" sub="Starting positions and roster spots" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('roster')} />}>
        {data.roster === undefined ? <Loading lines={4} /> : data.roster === null || data.roster.length === 0 ? (
          <p className="af-lsh-empty">Roster positions aren’t available for this league yet.</p>
        ) : (
          <RosterList items={data.roster} />
        )}
      </Card>

      <Card id="scoring" title="Scoring Settings" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('scoring')} />}>
        {scoring === undefined ? <Loading lines={4} /> : scoring === null || !activeCat ? (
          <p className="af-lsh-empty">Scoring rules aren’t available for this league yet.</p>
        ) : (
          <>
            <div className="af-lsh-row" style={{ borderTop: '1px solid var(--lsh-rule)' }}>
              <div className="af-lsh-row-copy"><span>Scoring Preset</span></div>
              <span className="af-lsh-value">{scoring.preset ?? 'Custom'}</span>
            </div>
            <div className="af-lsh-pills" role="group" aria-label="Scoring categories">
              {scoring.categories.map((c) => (
                <button key={c.key} type="button" className="af-lsh-pill" aria-pressed={c.key === activeCat.key} onClick={() => setCat(c.key)}>{c.label}</button>
              ))}
            </div>
            <ScoringRows rows={activeCat.rows} label={activeCat.label} />
          </>
        )}
      </Card>

      <Card id="draft" title="Draft Settings" action={<EditButton show={edit} onClick={() => cb.onOpenEditor('draft')} />}>
        {data.draft === undefined ? <Loading lines={4} /> : <GroupGrid groups={data.draft} canEdit={edit} busyField={busyField} onToggle={cb.onToggleSetting} />}
        <div className="af-lsh-card-body" style={{ paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>Draft Order</strong>
            <EditButton show={edit} label="Set order" onClick={() => cb.onOpenEditor('draft')} />
          </div>
          {data.draftOrder === undefined ? <Loading lines={3} /> : !data.draftOrder?.length ? (
            <p className="af-lsh-note" style={{ marginTop: 0 }}>The draft order hasn’t been set yet.</p>
          ) : (
            <div className="af-lsh-table">
              <div className="af-lsh-tr af-lsh-order" data-head="true"><span>Pick</span><span>Manager</span><span /></div>
              {data.draftOrder.map((o) => (
                <div className="af-lsh-tr af-lsh-order" key={o.slot}>
                  <strong>{o.slot}</strong>
                  <span className="af-lsh-who"><Face name={o.name} /><span><strong>{o.name}</strong></span></span>
                  <span />
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  )
}

/** Sleeper lays scoring out in two columns: first half left, second half right. */
function ScoringRows({ rows, label }: { rows: HubScoringCategory['rows']; label: string }) {
  const half = Math.ceil(rows.length / 2)
  const cols = [rows.slice(0, half), rows.slice(half)].filter((c) => c.length)
  return (
    <>
      <div className="af-lsh-group-label" style={{ borderTop: '1px solid var(--lsh-rule)' }}>{label}</div>
      <div className="af-lsh-grid" style={{ borderTop: 0 }}>
        {cols.map((col, i) => (
          <div className="af-lsh-col" key={i}>
            {col.map((r) => (
              <div className="af-lsh-row" key={r.key}>
                <div className="af-lsh-row-copy">
                  <span>{r.label}</span>
                  {r.perUnit ? <span>{r.perUnit}</span> : null}
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
      action={edit && !editing && note !== undefined ? <button type="button" className="af-lsh-btn" data-size="sm" onClick={() => setDraft(note ?? '')}>{note ? 'Edit' : 'Add note'}</button> : null}
    >
      <div className="af-lsh-card-body">
        {note === undefined ? <Loading lines={1} /> : editing ? (
          <>
            <label htmlFor="af-lsh-note" className="af-lsh-sr">Commissioner notes</label>
            <textarea id="af-lsh-note" className="af-lsh-input" style={{ minHeight: 120, padding: 12, lineHeight: 1.5, resize: 'vertical' }} maxLength={2000} value={draft ?? ''} onChange={(e) => setDraft(e.target.value)} />
            <div className="af-lsh-inline" style={{ marginTop: 10 }}>
              <button type="button" className="af-lsh-btn" data-variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save notes'}</button>
              <button type="button" className="af-lsh-btn" data-variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(null) }}>Cancel</button>
            </div>
            {error ? <p className="af-lsh-note" data-tone="error" role="alert">{error}</p> : null}
          </>
        ) : (
          <p style={{ margin: 0, whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.55, color: 'var(--lsh-muted)' }}>{note || 'No notes yet.'}</p>
        )}
      </div>
    </Card>
  )
}

function RosterList({ items }: { items: HubRosterItem[] }) {
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
            {sections.length > 1 ? <div className="af-lsh-group-label" style={{ borderTop: '1px solid var(--lsh-rule)' }}>{section}</div> : null}
            <div className="af-lsh-grid">
              {[list.slice(0, half), list.slice(half)].filter((c) => c.length).map((col, i) => (
                <div className="af-lsh-col" key={i}>
                  {col.map((it) => (
                    <div className="af-lsh-slot" key={it.key}>
                      <span className="af-lsh-dot" style={{ background: it.color }} aria-hidden />
                      <strong>{it.name}</strong>
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
      <Card id="commissioners" title="Set Commissioners" sub="Co-commissioners can make roster and lineup changes for any team and manage league settings">
        <div className="af-lsh-card-body">
          {members === undefined ? <Loading /> : (
            <div className="af-lsh-table">
              <div className="af-lsh-tr af-lsh-members" data-head="true"><span>Manager</span><span className="team">Team name</span><span>Commish</span></div>
              {members.map((m) => (
                <div className="af-lsh-tr af-lsh-members" key={m.id} data-you={m.isYou ? 'true' : undefined}>
                  <span className="af-lsh-who"><Face name={m.name} src={m.avatarUrl} /><span><strong>{m.name}{m.isYou ? ' (you)' : ''}</strong>{m.teamName ? <small className="who-team">{m.teamName}</small> : null}</span></span>
                  <span className="team">{m.teamName ?? '—'}</span>
                  {m.isCommissioner ? <span className="af-lsh-tag">HEAD</span> : (
                    <Switch on={m.isCoCommissioner} label={`Co-commissioner: ${m.name}`} disabled={!data.isHeadCommissioner || Boolean(data.importedFrom)} onChange={(next) => cb.onToggleCoCommissioner(m.id, next)} />
                  )}
                </div>
              ))}
            </div>
          )}
          {!data.isHeadCommissioner ? <p className="af-lsh-note">Only the head commissioner can add or remove co-commissioners.</p> : null}
        </div>
      </Card>

      <Card id="coowners" title="Set Co-Owners" sub="A co-owner can set your lineup and make moves for your team">
        <div className="af-lsh-card-body">
          {data.coOwners === undefined ? <Loading lines={2} /> : data.coOwners === null ? (
            <p className="af-lsh-note" style={{ marginTop: 0 }}>{data.importedFrom ? `Co-owners are managed on ${data.importedFrom}.` : 'You need a team in this league to add a co-owner.'}</p>
          ) : (
            <>
              <label htmlFor="af-lsh-coowner" className="af-lsh-sr">Co-owner username</label>
              <div className="af-lsh-inline">
                <input id="af-lsh-coowner" className="af-lsh-input" placeholder="AllFantasy username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && username.trim()) void inviteCoOwner() }} />
                <button type="button" className="af-lsh-btn" data-variant="primary" disabled={!username.trim() || inviting} onClick={() => void inviteCoOwner()}>{inviting ? 'Inviting…' : 'Invite'}</button>
              </div>
              {coStatus ? <p className="af-lsh-note" data-tone={coStatus.tone} role="status">{coStatus.text}</p> : null}
              {data.coOwners.invitations.length ? (
                <div className="af-lsh-list" style={{ marginTop: 12 }}>
                  {data.coOwners.invitations.map((c) => (
                    <div className="af-lsh-season" key={c.id}>
                      <Face name={c.name} />
                      <div><strong>{c.name}</strong><span>{c.accepted ? 'Co-owner' : 'Invitation pending'}</span></div>
                    </div>
                  ))}
                </div>
              ) : <p className="af-lsh-note">No co-owners yet.</p>}
            </>
          )}
        </div>
      </Card>

      <Card id="managers" title="Manage Members" sub="Assign or remove members from rosters and the league" action={<EditButton show={edit} label="Manage" onClick={() => cb.onOpenEditor('members-commish')} />}>
        <div className="af-lsh-card-body">
          {members === undefined ? <Loading /> : (
            <div className="af-lsh-table">
              {members.map((m) => (
                <div className="af-lsh-tr af-lsh-members" key={m.id}>
                  <span className="af-lsh-who"><Face name={m.name} src={m.avatarUrl} /><span><strong>{m.name}</strong><small className="who-team">{m.teamName ?? 'Open team'}</small></span></span>
                  <span className="team">{m.teamName ?? 'Open team'}</span>
                  <span style={{ color: 'var(--lsh-muted)', fontSize: 12 }}>{m.isCommissioner ? 'Commissioner' : m.isCoCommissioner ? 'Co-commish' : 'Manager'}</span>
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
                  <strong style={{ fontSize: 14 }}>League spots</strong>
                  {data.invite?.capacity ? (
                    <span style={{ fontSize: 13, fontWeight: 750, color: data.invite.filled >= data.invite.capacity ? '#fcd34d' : 'var(--lsh-text)' }}>
                      {data.invite.filled} / {data.invite.capacity}{data.invite.filled >= data.invite.capacity ? ' · Full' : ''}
                    </span>
                  ) : null}
                </div>
                <p className="af-lsh-note">
                  {data.invite?.link ? 'Anyone with the link can request to join while spots are open.' : 'Ask your commissioner for the league invite link.'}
                </p>
              </div>
              {data.invite?.link ? (
                <div className="af-lsh-share">
                  <span className="af-lsh-eyebrow">Share your league</span>
                  <div className="af-lsh-link"><span>{data.invite.link.replace(/^https?:\/\//, '')}</span><button type="button" className="af-lsh-btn" data-size="sm" data-variant="ghost" onClick={() => cb.onCopy(data.invite!.link!)} aria-label="Copy invite link">Copy</button></div>
                  {cb.onShare ? <button type="button" className="af-lsh-btn" data-variant="primary" onClick={() => cb.onShare!(data.invite!.link!)}>Share</button> : null}
                  <button type="button" className="af-lsh-btn" onClick={() => cb.onOpenEditor('invite')}>QR code & more</button>
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
  { tag: 'IR', name: 'Injured Reserve', d: 'Eligible for an IR spot', bg: '#2b0f14', fg: '#fca5a5' },
]
const MATCHUP_LEGEND = [
  { tag: 'vs DAL', name: 'Easy', fg: '#6ee7b7', d: 'A soft defense. Your player is more likely to beat their projection.' },
  { tag: '@ CLE', name: 'Neutral', fg: '#e6edf7', d: 'An average defense. Expect close to the projection.' },
  { tag: 'vs BAL', name: 'Tough', fg: '#fca5a5', d: 'A strong defense. Your player is more likely to fall short.' },
]

/** Sleeper's week stepper, showing what is actually stored: final or still open, and when rescored. */
function CorrectionWeeks({ data }: { data: HubViewData['correctionWeeks'] }) {
  const weeks = data?.weeks ?? []
  const [idx, setIdx] = useState<number | null>(null)
  if (data === undefined) return <Loading lines={2} />
  if (!weeks.length) return <p className="af-lsh-empty" style={{ paddingTop: 0 }}>No scored weeks yet this season.</p>
  const i = idx ?? weeks.length - 1
  const w = weeks[Math.min(i, weeks.length - 1)]
  const rescored = w.rescoredAt ? new Date(w.rescoredAt) : null
  return (
    <div className="af-lsh-card-body" data-testid="league-settings-hub-corrections">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--lsh-rule)' }}>
        <strong style={{ fontSize: 14 }}>Week</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 12, border: '1px solid rgba(255,255,255,.14)' }}>
          <button type="button" className="af-lsh-btn" data-variant="ghost" data-size="sm" style={{ border: 0, minWidth: 40 }} aria-label="Previous week" disabled={i <= 0} onClick={() => setIdx((prev) => Math.max(0, (prev ?? weeks.length - 1) - 1))}>‹</button>
          <span style={{ minWidth: 72, textAlign: 'center', fontSize: 13, fontWeight: 700 }} aria-live="polite">Week {w.week}</span>
          <button type="button" className="af-lsh-btn" data-variant="ghost" data-size="sm" style={{ border: 0, minWidth: 40 }} aria-label="Next week" disabled={i >= weeks.length - 1} onClick={() => setIdx((prev) => Math.min(weeks.length - 1, (prev ?? weeks.length - 1) + 1))}>›</button>
        </div>
      </div>
      <div className="af-lsh-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="af-lsh-row-copy">
          <span>{w.final ? 'Scores are final' : 'Open for stat corrections'}</span>
          <span>{w.final ? 'This week is past the correction window.' : 'Points can still change as official corrections come in.'}</span>
        </div>
        <span className="af-lsh-tag" style={w.final ? undefined : { background: '#2a2108', color: '#fcd34d' }}>{w.final ? 'FINAL' : 'OPEN'}</span>
      </div>
      <div className="af-lsh-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="af-lsh-row-copy">
          <span>Rescored after corrections</span>
          <span>Each player’s total already includes any correction</span>
        </div>
        <span className="af-lsh-value" data-empty={rescored ? undefined : 'true'}>
          {rescored ? rescored.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Not rescored'}
        </span>
      </div>
    </div>
  )
}

function RecordTab({ data }: { data: HubViewData }) {
  const note = statCorrectionNote(data.kind)
  return (
    <>
      <Card id="history" title="League History" sub="Draft results and every past season">
        <div className="af-lsh-card-body">
          <div className="af-lsh-split" data-even="true">
            <div className="af-lsh-list">
              <span className="af-lsh-eyebrow">Draft</span>
              {data.draftHistory === undefined ? <Loading lines={1} /> : data.draftHistory ? (
                <div className="af-lsh-season"><div><strong>{data.draftHistory.title}</strong><span>{data.draftHistory.status}</span></div></div>
              ) : <p className="af-lsh-note" style={{ marginTop: 0 }}>No draft scheduled yet.</p>}
            </div>
            <div className="af-lsh-list">
              <span className="af-lsh-eyebrow">Past seasons</span>
              {data.seasons === undefined ? <Loading lines={2} /> : !data.seasons?.length ? (
                <p className="af-lsh-note" style={{ marginTop: 0 }}>Past seasons appear here once one is complete.</p>
              ) : data.seasons.map((s) => (
                <div className="af-lsh-season" key={s.year}>
                  <div>
                    <strong>{s.year} Season</strong>
                    <span>{s.champion ? `${championWord(data.kind)} · ${s.champion}` : 'Champion not recorded'}{s.runnerUp ? ` · Runner-up ${s.runnerUp}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card id="standings" title="All-Time Standings" sub="Every season this league has played, added up">
        <div className="af-lsh-card-body">
          {data.standings === undefined ? <Loading /> : !data.standings?.length ? (
            <p className="af-lsh-note" style={{ marginTop: 0 }}>All-time standings start after the first completed season.</p>
          ) : (
            <div className="af-lsh-table">
              <div className="af-lsh-tr af-lsh-standings" data-head="true"><span>#</span><span>Manager</span><span className="r">Win %</span><span className="r">PF</span><span className="r wide">Seasons</span><span className="r wide">Titles</span></div>
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

      <Card id="highs" title="All-Time High Scores" sub="The league’s biggest weeks, by team and by player">
        <div className="af-lsh-card-body">
          <div className="af-lsh-split" data-even="true">
            <div className="af-lsh-list">
              <strong style={{ fontSize: 15 }}>Weekly high scores</strong>
              {data.highScores === undefined ? <Loading /> : !data.highScores?.length ? (
                <p className="af-lsh-note" style={{ marginTop: 0 }}>High scores are recorded after each completed week.</p>
              ) : (
                <div className="af-lsh-table">
                  <div className="af-lsh-tr af-lsh-records" data-head="true"><span /><span>Team</span><span className="r">Score</span></div>
                  {data.highScores.map((h) => (
                    <div className="af-lsh-tr af-lsh-records" key={h.rank}>
                      <span style={{ color: 'var(--lsh-muted)', fontWeight: 700 }}>{h.rank}</span>
                      <span className="af-lsh-who"><Face name={h.holder} /><span><strong>{h.holder}</strong>{h.season ? <small>{h.season}</small> : null}</span></span>
                      <strong className="r">{h.value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="af-lsh-list" data-testid="league-settings-hub-player-highs">
              <strong style={{ fontSize: 15 }}>Player high scores</strong>
              {data.playerHighScores === undefined ? <Loading /> : !data.playerHighScores?.rows.length ? (
                <p className="af-lsh-note" style={{ marginTop: 0 }}>Player high scores appear once a week’s scores are final.</p>
              ) : (
                <>
                  <div className="af-lsh-table">
                    <div className="af-lsh-tr af-lsh-records" data-head="true"><span /><span>Player</span><span className="r">Score</span></div>
                    {data.playerHighScores.rows.map((p) => (
                      <div className="af-lsh-tr af-lsh-records" key={`${p.rank}-${p.name}`}>
                        <span style={{ color: 'var(--lsh-muted)', fontWeight: 700 }}>{p.rank}</span>
                        <span className="af-lsh-who"><Face name={p.name} /><span><strong>{p.name}</strong><small style={{ whiteSpace: 'normal' }}>{p.team} · {p.season} Wk {p.week}</small></span></span>
                        <strong className="r">{p.points}</strong>
                      </div>
                    ))}
                  </div>
                  <span className="af-lsh-note" style={{ marginTop: 0 }}>
                    Starters only{data.playerHighScores.seasons.length ? ` · ${data.playerHighScores.seasons.join(' & ')} seasons` : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card id="corrections" title="Stat Corrections" sub="Corrections are applied retroactively to each player’s total">
        <CorrectionWeeks data={data.correctionWeeks} />
        <div className="af-lsh-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--lsh-muted)' }}>
          <span>Our stats feed updates live during games, then posts official corrections over the next few days.</span>
          <span>Corrections can land through Thursday — most arrive Monday or Tuesday — so a weekly result isn’t final until then.</span>
          <span>If the feed pauses or misses a play, it’s corrected to match the official league stats.</span>
          {note ? <span style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--lsh-soft)', color: 'var(--lsh-text)' }}>{note}</span> : null}
        </div>
      </Card>

      <Card id="legend" title="League Legend" sub="What the colors and tags mean">
        <div className="af-lsh-card-body">
          <div className="af-lsh-legend">
            <div>
              <strong>Player status</strong>
              {STATUS_LEGEND.map((s) => (
                <div className="af-lsh-legend-item" key={s.tag}>
                  <span className="af-lsh-legend-tag" style={{ background: s.bg, color: s.fg }}>{s.tag}</span>
                  <div><b style={{ color: s.fg }}>{s.name}</b><span>{s.d}</span></div>
                </div>
              ))}
            </div>
            <div>
              <strong>Defense matchup</strong>
              {MATCHUP_LEGEND.map((m) => (
                <div className="af-lsh-legend-item" key={m.tag}>
                  <div><b style={{ color: m.fg }}>{m.tag} <span style={{ color: 'var(--lsh-muted)', fontWeight: 600 }}>· {m.name}</span></b><span>{m.d}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}

