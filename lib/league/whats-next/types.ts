/**
 * "What's next?" — the league-home banner that says what phase a league is in, whether the viewer has
 * to do something or wait, who the league is waiting on, and how long is left.
 *
 * Three layers, each pure and client-safe:
 *   formatPhaseGuides.ts  the phase config: for every format, every phase it can be in, the plain-English
 *                         copy for the three audiences (the manager who must act, the commissioner, and
 *                         everyone else) and the tab that holds the action.
 *   adapters.ts           each format's EXISTING summary payload → `WhatsNextFacts` (which phase, who is
 *                         acting, names, deadline). No new routes.
 *   resolveWhatsNext.ts   facts + viewer → the `WhatsNextView` the panel renders.
 */

/** Every format the panel knows. The lifecycle formats share one guide with per-format wording. */
export type WhatsNextFormatId =
  | 'big_brother'
  | 'survivor'
  | 'zombie'
  | 'guillotine'
  | 'tournament'
  | 'pirate'
  | 'redraft'
  | 'dynasty'
  | 'keeper'
  | 'best_ball'
  | 'devy'
  | 'c2c'
  | 'salary_cap'
  | 'idp'
  /** A league imported from Sleeper, ESPN, … — read-only here, so every action happens on the host. */
  | 'imported'

/**
 * Who acts in a phase.
 *  - `viewer_decides`  a specific manager or managers act; the adapter says whether the viewer is one
 *  - `commissioner`    the commissioner is the one the league is waiting on
 *  - `everyone`        every manager has something to do (set a lineup, set protections)
 *  - `automatic`       nobody: it resolves on its own at a deadline
 */
type PhaseActor = 'viewer_decides' | 'commissioner' | 'everyone' | 'automatic'

export type PhaseAction = {
  /** A league tab id (LeagueShell `tabDefs`). */
  tab?: string
  /** Or a full path, for actions that live on their own page. */
  href?: string
  label: string
  /**
   * The href is on another site (an imported league's host). Its template is filled WITHOUT encoding —
   * the value is a whole URL from the allowlisted source-link resolver — and is dropped unless https.
   */
  external?: boolean
}

/**
 * One phase of one format. Copy is a template: `{name}` placeholders are filled from `WhatsNextFacts.vars`.
 * A placeholder with no value falls back to the text in `PLACEHOLDER_FALLBACKS`, never to a raw `{name}`.
 */
export type PhaseGuide = {
  /** The phase in plain English — "HOH has been chosen: {hoh}". */
  title: string
  actor: PhaseActor
  /** Shown to the manager the league is waiting on (or to everyone, when `actor` is `everyone`). */
  actorMessage?: string
  /** Shown to the commissioner when they are not the one acting. */
  commissionerMessage: string
  /** Shown to everyone else. */
  memberMessage: string
  /** Shown to a manager who is part of this phase but has nothing to do ("You're on the block"). */
  involvedMessage?: string
  /** Shown to the manager who was asked and already did it ("Your vote is in"). */
  doneMessage?: string
  /** "Waiting on …" — omitted for `automatic` and `everyone` phases. */
  waitingOn?: string
  /** The button for whoever acts. */
  action?: PhaseAction
  /** A separate button for the commissioner (BB command, settings) when they are not the actor. */
  commissionerAction?: PhaseAction
}

export type FormatGuide = {
  format: WhatsNextFormatId
  label: string
  /** Phase id → guide. The ids are the format's own stored phase values wherever one exists. */
  phases: Record<string, PhaseGuide>
}

/** What an adapter reads out of a format's summary. Everything optional degrades to a quieter banner. */
export type WhatsNextFacts = {
  format: WhatsNextFormatId
  /** A key of `FORMAT_GUIDES[format].phases`. */
  phase: string
  /** Overrides the guide's label in the kicker ("Sleeper" rather than "Imported league"). */
  formatLabel?: string | null
  week?: number | null
  /** The viewer is the manager (or one of the managers) this phase is waiting on. */
  viewerIsActor?: boolean
  /** The viewer is in this phase without anything to do (a nominee, a veto player). */
  viewerIsInvolved?: boolean
  /** The viewer already did their part (a juror who has voted). */
  viewerDone?: boolean
  /** Template values — hoh, nominees, vetoHolder, tribe, … */
  vars?: Record<string, string | null | undefined>
  deadlineIso?: string | null
  deadlineLabel?: string | null
}

export type WhatsNextViewer = {
  isCommissioner: boolean
  /** False for a non-playing host: an every-manager phase ("set your lineup") is then not theirs. */
  hasTeam?: boolean
}

type WhatsNextRole = 'actor' | 'commissioner' | 'involved' | 'member'

export type WhatsNextView = {
  format: WhatsNextFormatId
  formatLabel: string
  phase: string
  title: string
  role: WhatsNextRole
  /** `act` — the viewer has something to do now. `wait` — they do not. `done` — they already did. */
  status: 'act' | 'wait' | 'done'
  /**
   * The viewer's task is one every manager shares (set a lineup, get ready for the draft), so the
   * league is not waiting on them in particular: the chip says "To do", not "Your turn".
   */
  shared: boolean
  message: string
  /** A second line for a commissioner who is also the acting manager. */
  commissionerNote: string | null
  waitingOn: string | null
  deadlineIso: string | null
  deadlineLabel: string | null
  action: PhaseAction | null
}
