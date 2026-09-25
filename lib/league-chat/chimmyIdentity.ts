/**
 * Chimmy's identity in league chat — who a message is FROM when Chimmy says it.
 *
 * Client-safe: no Prisma, no server imports. The read path (LeagueChatMessageService), the
 * Discord relay, the comms list (ChatMessageList) and the dashboard panel all decide "is this
 * Chimmy?" with `isChimmyAuthored` below, so they cannot drift apart.
 *
 * ─── THE MARKER IS SERVER-OWNED, AND THAT IS THE WHOLE SECURITY PROPERTY ─────────────────────────
 *
 * A Chimmy post carries `metadata.chimmy === true`. Nothing else makes a message Chimmy's — not the
 * sender's display name, not `discordAuthorName`, not the message type. Every route a CLIENT posts
 * through (`/api/league/chat`, `/api/shared/chat/threads/…/messages`, `/api/redraft/communication/chat`)
 * stores metadata only through the ALLOWLIST in `lib/chat-core/clientMessageInput.ts`, which never
 * lists these keys, so a member cannot put the badge on their own message. A member who renames
 * themselves "Chimmy" gets the name and nothing else: no badge, no sparkle avatar.
 *
 * `chimmy: true` was already the marker the in-chat Chimmy replies used (Big Brother, C2C, devy and
 * IDP command handlers, via `/api/league/chat`). It is formalised here rather than replaced, so
 * those replies render as Chimmy too. `chimmyPrivateReply` / `chimmyResponse` are Chimmy's private
 * answers to an @chimmy question; they are Chimmy's words as well.
 *
 * ─── WHO THE ROW IS AUTHORED BY ─────────────────────────────────────────────────────────────────
 *
 * `LeagueChatMessage.userId` is a required foreign key to `AppUser`, and this repo has no system or
 * bot user (`lib/league/systemActor.ts` records what a synthetic id does to an FK). So a Chimmy row
 * keeps the league owner as its TECHNICAL author — the identity the weekly recap and the in-chat
 * replies already used — and the READ path swaps in Chimmy's identity whenever the marker is present:
 * no sender id (so it is never "yours", never editable, never reportable or blockable as a person,
 * and never hidden by blocking the commissioner), Chimmy's name, and no user avatar.
 */

/** The only name Chimmy posts under. Never bare "AI". */
export const CHIMMY_DISPLAY_NAME = 'Chimmy'

/** The server-owned metadata key that marks a message as Chimmy's. */
export const CHIMMY_MARKER_KEY = 'chimmy'

/**
 * Every metadata key that makes a row Chimmy-authored, plus the moment descriptor. All of them are
 * server-owned: the client allowlist must never admit any of these (a test pins it).
 */
export const CHIMMY_SERVER_KEYS = ['chimmy', 'chimmyMoment', 'chimmyPrivateReply', 'chimmyResponse'] as const

/**
 * What Chimmy posts. `weekly_awards`, `trade`, `commissioner_notice` and `commissioner_alerts` are
 * posted today; `close_finish`, `upset` and `starter_injury` are reserved for the moments built on
 * `postChimmyMoment` next.
 *
 *   - `commissioner_notice`  — a governance notice the COMMISSIONER chose to send ("Send notice" in
 *                              the AI Commissioner panel). A person asked for it, so it skips the cap.
 *   - `commissioner_alerts`  — the automatic governance cycle's summary, when the commissioner set
 *                              notices to go to chat. Automatic, so it counts against the cap.
 */
export const CHIMMY_MOMENT_KINDS = [
  'weekly_awards',
  'trade',
  'close_finish',
  'upset',
  'starter_injury',
  'commissioner_notice',
  'commissioner_alerts',
] as const
export type ChimmyMomentKind = (typeof CHIMMY_MOMENT_KINDS)[number]

/** A short label drawn beside Chimmy's name. Never "AI" — the post is Chimmy's. */
export const CHIMMY_MOMENT_LABELS: Record<ChimmyMomentKind, string> = {
  weekly_awards: 'Weekly awards',
  trade: 'Trade take',
  close_finish: 'Close finish',
  upset: 'Upset',
  starter_injury: 'Injury',
  commissioner_notice: 'Commissioner notice',
  commissioner_alerts: 'Commissioner notice',
}

export function isChimmyMomentKind(value: unknown): value is ChimmyMomentKind {
  return typeof value === 'string' && (CHIMMY_MOMENT_KINDS as readonly string[]).includes(value)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Whether a message is Chimmy's. Decided by the server-owned marker ONLY — never by a name.
 */
export function isChimmyAuthored(metadata: unknown): boolean {
  const meta = record(metadata)
  if (!meta) return false
  return meta.chimmy === true || meta.chimmyPrivateReply === true || meta.chimmyResponse === true
}

/** The moment a Chimmy post was for, when it was one (awards, trade …). */
export function chimmyMomentKindOf(metadata: unknown): ChimmyMomentKind | null {
  const meta = record(metadata)
  if (!meta || !isChimmyAuthored(meta)) return null
  const kind = record(meta.chimmyMoment)?.kind
  return isChimmyMomentKind(kind) ? kind : null
}

export function chimmyMomentLabelOf(metadata: unknown): string | null {
  const kind = chimmyMomentKindOf(metadata)
  return kind ? CHIMMY_MOMENT_LABELS[kind] : null
}

// ─── The per-league switch ──────────────────────────────────────────────────────────────────────

/**
 * `League.settings.chimmySpeaksUp` — "Chimmy speaks up in league chat". Written by the Commissioner
 * Hub's Automations section through `PATCH /api/league/settings` (`settingsMerge`), which is
 * commissioner-gated and audited. Listed in `AF_OWNED_LEAGUE_SETTINGS_KEYS` so a re-import keeps it.
 */
export const CHIMMY_SPEAKS_UP_SETTING_KEY = 'chimmySpeaksUp'

/** ON unless the commissioner explicitly switched it off. Anything but a literal `false` is on. */
export function readChimmySpeaksUp(settings: unknown): boolean {
  const bag = record(settings)
  return bag?.[CHIMMY_SPEAKS_UP_SETTING_KEY] !== false
}

/** The `settingsMerge` body that sets the switch. One top-level boolean, so a shallow merge is safe. */
export function buildChimmySpeaksUpMerge(enabled: boolean): { chimmySpeaksUp: boolean } {
  return { [CHIMMY_SPEAKS_UP_SETTING_KEY]: enabled } as { chimmySpeaksUp: boolean }
}
