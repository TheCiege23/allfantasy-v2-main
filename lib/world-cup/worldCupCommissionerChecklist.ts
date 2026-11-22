/**
 * worldCupCommissionerChecklist.ts
 *
 * Pure deterministic helper for the Commissioner "Pool Completion
 * Checklist" card. Composes finalized/incomplete counts + per-entry
 * rows + a copy-ready reminder message from data already loaded on
 * the Commissioner Brain panel — no new API route, no LLM call.
 *
 * Privacy:
 *   - Output never exposes userId or email.
 *   - Display names fall back to "Member" when unsafe/missing.
 *   - Reminder message includes pool name + optional invite URL +
 *     optional deadline; nothing else.
 *   - Reminder NEVER includes invite code (privacy spec — commissioner
 *     shares the message in chat / DM, and we don't want the invite
 *     code to ride along with what may be a public reminder).
 *
 * Localization (Phase 4):
 *   - All builders accept an optional `locale` parameter and emit
 *     deterministic translated reminder + member fallback text for
 *     en/es/zh/fil/vi.
 *   - Status labels (Finalized / In progress / Needs picks / Unknown)
 *     remain English in the result object so existing consumers
 *     (status color map, tests) don't break — the card component
 *     translates them via the `wc.checklist.entryStatus.*` keys when
 *     rendering.
 */
import {
  getWorldCupLocale,
  type WorldCupLocale,
} from "@/lib/world-cup/worldCupI18n"

export type ChecklistEntryStatus =
  | "Finalized"
  | "In progress"
  | "Needs picks"
  | "Unknown"

type ChecklistStatus = "ready" | "no_members" | "no_data"

type ChecklistRow = {
  /** Entry display name (e.g. "Bracket 1"). */
  entryName: string
  /** Member display name (sanitized — never email, never user id). */
  displayName: string
  status: ChecklistEntryStatus
  /** Missing pick count for this entry (0 when finalized). */
  missingPicks: number
}

type ChecklistSummary = {
  totalEntries: number
  finalized: number
  inProgress: number
  notStarted: number
  /** 0–100 integer percent of entries that are finalized. */
  percentComplete: number
}

type ChecklistResult = {
  status: ChecklistStatus
  summary: ChecklistSummary
  rows: ChecklistRow[]
  reminderMessage: string
  /** Optional friendly fallback lines when no rows render. */
  emptyLines?: string[]
}

/** Snapshot-like input from the Commissioner Brain endpoint. */
type WorldCupChecklistSnapshot = {
  totalEntries: number
  completedBracketCount: number
  incompleteBracketCount: number
  totalMissingPicks: number
  /** Users with at least one incomplete entry. userId is used internally to look up display names; never rendered. */
  usersWithIncompleteBrackets: Array<{
    userId?: string | null
    displayName?: string | null
    incompleteEntryCount?: number
    missingPicks?: number
  }>
  /** Specific entries that are missing picks. userId is used internally to look up display names; never rendered. */
  entriesMissingPicks: Array<{
    entryName?: string | null
    missingPicks?: number
    userId?: string | null
  }>
}

export type BuildChecklistInput = {
  /** Snapshot already loaded by WorldCupCommissionerBrainPanel. */
  snapshot: WorldCupChecklistSnapshot | null
  /** Pool/challenge display name. */
  poolName: string
  /** Public pool URL (e.g. /brackets/world-cup/[id]) — optional. */
  poolUrl?: string | null
  /** Human-readable lock deadline label — optional. */
  lockDeadlineLabel?: string | null
  /** Whether the viewer is commissioner/admin. Member-mode renders nothing. */
  isCommissioner?: boolean
  /** Locale for translated reminder/member fallback text. Defaults to "en". */
  locale?: WorldCupLocale | string | null
}

type ReminderTemplates = {
  poweredBy: string
  askCommissioner: (poolName: string) => string
  finalizeLine: (poolName: string) => string
  joinLine: (poolName: string) => string
  statusLine: (done: number, total: number, percent: number) => string
  deadlineLine: (label: string) => string
  noSnapshotLine: (poolName: string) => string
  /** Friendly fallback shown to non-commissioners on the card. */
  memberOnlyEmptyLine: string
  /** Card "still loading" line when commissioner is set but snapshot is null. */
  loadingEmptyLine: string
  /** Card "no members yet" line when totalEntries === 0. */
  noMembersEmptyLine: string
}

const REMINDER_TEMPLATES: Record<string, ReminderTemplates> = {
  en: {
    poweredBy: "Powered by AllFantasy.",
    askCommissioner: (p) =>
      `Ask the pool commissioner to remind members about ${p}.`,
    finalizeLine: (p) =>
      `Friendly reminder: finalize your picks for "${p}" on AllFantasy.`,
    joinLine: (p) =>
      `Reminder: join "${p}" on AllFantasy and lock in your World Cup bracket.`,
    statusLine: (d, t, p) =>
      `Status: ${d}/${t} brackets finalized (${p}%).`,
    deadlineLine: (l) => `Picks lock ${l}.`,
    noSnapshotLine: (p) =>
      `Reminder: finish your picks for "${p}" on AllFantasy.`,
    memberOnlyEmptyLine:
      "Only the pool commissioner or admin can see member status.",
    loadingEmptyLine: "Commissioner status data is still loading.",
    noMembersEmptyLine:
      "No members have created entries yet. Share the invite link to get started.",
  },
  es: {
    poweredBy: "Hecho con AllFantasy.",
    askCommissioner: (p) =>
      `Pídele al comisionado del grupo que recuerde a los miembros sobre ${p}.`,
    finalizeLine: (p) =>
      `Recordatorio amistoso: finaliza tus picks para "${p}" en AllFantasy.`,
    joinLine: (p) =>
      `Recordatorio: únete a "${p}" en AllFantasy y confirma tu bracket de la Copa del Mundo.`,
    statusLine: (d, t, p) =>
      `Estado: ${d}/${t} brackets finalizados (${p}%).`,
    deadlineLine: (l) => `Los picks cierran ${l}.`,
    noSnapshotLine: (p) =>
      `Recordatorio: termina tus picks para "${p}" en AllFantasy.`,
    memberOnlyEmptyLine:
      "Solo el comisionado o admin del grupo puede ver el estado de los miembros.",
    loadingEmptyLine: "Datos del comisionado aún cargando.",
    noMembersEmptyLine:
      "Aún no hay miembros con entradas. Comparte el enlace de invitación para empezar.",
  },
  zh: {
    poweredBy: "由 AllFantasy 提供支援。",
    askCommissioner: (p) => `請群組管理員提醒成員注意 ${p}。`,
    finalizeLine: (p) =>
      `提醒:請在 AllFantasy 完成「${p}」的選擇並送出。`,
    joinLine: (p) =>
      `提醒:加入 AllFantasy 上的「${p}」,並鎖定你的世界盃對戰表。`,
    statusLine: (d, t, p) =>
      `進度:${d}/${t} 個對戰表已送出(${p}%)。`,
    deadlineLine: (l) => `選擇將於 ${l} 鎖定。`,
    noSnapshotLine: (p) =>
      `提醒:請在 AllFantasy 完成「${p}」的選擇。`,
    memberOnlyEmptyLine:
      "只有群組管理員或系統管理員可以看到成員狀態。",
    loadingEmptyLine: "管理員狀態資料仍在載入中。",
    noMembersEmptyLine:
      "尚無成員建立對戰表。分享邀請連結以開始。",
  },
  fil: {
    poweredBy: "Powered by AllFantasy.",
    askCommissioner: (p) =>
      `Hilingin sa pool commissioner na mag-paalala sa mga miyembro tungkol sa ${p}.`,
    finalizeLine: (p) =>
      `Friendly reminder: i-finalize ang iyong mga pick para sa "${p}" sa AllFantasy.`,
    joinLine: (p) =>
      `Reminder: sumali sa "${p}" sa AllFantasy at i-lock ang iyong World Cup bracket.`,
    statusLine: (d, t, p) =>
      `Status: ${d}/${t} brackets na finalized (${p}%).`,
    deadlineLine: (l) => `Magla-lock ang picks ${l}.`,
    noSnapshotLine: (p) =>
      `Reminder: tapusin ang iyong picks para sa "${p}" sa AllFantasy.`,
    memberOnlyEmptyLine:
      "Tanging pool commissioner o admin lang ang makakakita ng status ng miyembro.",
    loadingEmptyLine: "Naglo-load pa ang commissioner status data.",
    noMembersEmptyLine:
      "Wala pang miyembrong gumawa ng entry. I-share ang invite link para makasimula.",
  },
  vi: {
    poweredBy: "Hỗ trợ bởi AllFantasy.",
    askCommissioner: (p) =>
      `Hãy nhờ chủ pool nhắc các thành viên về ${p}.`,
    finalizeLine: (p) =>
      `Lời nhắc thân thiện: hoàn tất các lựa chọn của bạn cho "${p}" trên AllFantasy.`,
    joinLine: (p) =>
      `Lời nhắc: tham gia "${p}" trên AllFantasy và khoá bracket World Cup của bạn.`,
    statusLine: (d, t, p) =>
      `Trạng thái: ${d}/${t} bracket đã hoàn tất (${p}%).`,
    deadlineLine: (l) => `Lựa chọn khoá lúc ${l}.`,
    noSnapshotLine: (p) =>
      `Lời nhắc: hoàn tất các lựa chọn của bạn cho "${p}" trên AllFantasy.`,
    memberOnlyEmptyLine:
      "Chỉ chủ pool hoặc admin mới có thể xem trạng thái thành viên.",
    loadingEmptyLine: "Dữ liệu trạng thái chủ pool đang tải.",
    noMembersEmptyLine:
      "Chưa có thành viên nào tạo entry. Hãy chia sẻ link mời để bắt đầu.",
  },
}

const FORBIDDEN_TERMS = [
  /\bdfs\b/gi,
  /\bbetting\b/gi,
  /\bwager(?:ing|s|ed)?\b/gi,
  /\bsportsbook\b/gi,
  /\bodds\b/gi,
]

function sanitize(text: string): string {
  let cleaned = text
  for (const pattern of FORBIDDEN_TERMS) {
    cleaned = cleaned.replace(pattern, "prediction")
  }
  return cleaned.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function safeDisplayName(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return "Member"
  // Defensive: never let an email-shaped string leak into the UI.
  if (/@/.test(trimmed) || /^user[-_]?[0-9a-f]{6,}$/i.test(trimmed)) {
    return "Member"
  }
  return trimmed.slice(0, 40)
}

function safeEntryName(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return "Bracket"
  return trimmed.slice(0, 80)
}

/**
 * Builds the deterministic checklist + reminder text. Always returns a
 * stable object — non-commissioner viewers receive a `no_data` status
 * with a safe fallback message and no per-row data.
 */
export function buildWorldCupCommissionerChecklist(
  input: BuildChecklistInput
): ChecklistResult {
  const {
    snapshot,
    poolName,
    poolUrl,
    lockDeadlineLabel,
    isCommissioner = false,
    locale,
  } = input

  const lang = getWorldCupLocale(locale)
  const tpl = REMINDER_TEMPLATES[lang] ?? REMINDER_TEMPLATES.en

  if (!isCommissioner) {
    return {
      status: "no_data",
      summary: { totalEntries: 0, finalized: 0, inProgress: 0, notStarted: 0, percentComplete: 0 },
      rows: [],
      reminderMessage: sanitize(tpl.askCommissioner(poolName)),
      emptyLines: [tpl.memberOnlyEmptyLine],
    }
  }

  if (!snapshot) {
    return {
      status: "no_data",
      summary: { totalEntries: 0, finalized: 0, inProgress: 0, notStarted: 0, percentComplete: 0 },
      rows: [],
      reminderMessage: sanitize(
        [
          tpl.noSnapshotLine(poolName),
          lockDeadlineLabel ? tpl.deadlineLine(lockDeadlineLabel) : null,
          poolUrl ?? null,
          tpl.poweredBy,
        ]
          .filter(Boolean)
          .join("\n")
      ),
      emptyLines: [tpl.loadingEmptyLine],
    }
  }

  const totalEntries = Math.max(0, Number(snapshot.totalEntries) || 0)
  const completed = Math.max(0, Number(snapshot.completedBracketCount) || 0)
  const incompleteCount = Math.max(0, Number(snapshot.incompleteBracketCount) || 0)

  if (totalEntries === 0) {
    return {
      status: "no_members",
      summary: { totalEntries: 0, finalized: 0, inProgress: 0, notStarted: 0, percentComplete: 0 },
      rows: [],
      reminderMessage: sanitize(
        [
          tpl.joinLine(poolName),
          lockDeadlineLabel ? tpl.deadlineLine(lockDeadlineLabel) : null,
          poolUrl ?? null,
          tpl.poweredBy,
        ]
          .filter(Boolean)
          .join("\n")
      ),
      emptyLines: [tpl.noMembersEmptyLine],
    }
  }

  // Build a userId → safe display-name lookup from the users-with-incomplete-brackets list.
  // userIds are used only internally; the resulting display name is the only PII-safe value rendered.
  const displayNameByUserId = new Map<string, string>()
  for (const user of snapshot.usersWithIncompleteBrackets ?? []) {
    if (!user.userId) continue
    displayNameByUserId.set(String(user.userId), safeDisplayName(user.displayName))
  }

  // Build per-entry rows from the incomplete entries; everything else is treated as finalized.
  const incompleteRows: ChecklistRow[] = (snapshot.entriesMissingPicks ?? []).map(
    (row) => {
      const missingPicks = Math.max(0, Number(row.missingPicks ?? 0) || 0)
      // Map missing-pick count to a stable status label.
      const status: ChecklistEntryStatus =
        missingPicks <= 0 ? "Unknown" : missingPicks <= 3 ? "In progress" : "Needs picks"
      const lookup = row.userId ? displayNameByUserId.get(String(row.userId)) : null
      return {
        entryName: safeEntryName(row.entryName),
        displayName: lookup ?? "Member",
        status,
        missingPicks,
      }
    }
  )

  // If incompleteRows < incompleteCount (because some incomplete entries have 0 missing per the
  // snapshot detail), pad with generic rows so the UI mirrors the headline count.
  const missingRows = Math.max(0, incompleteCount - incompleteRows.length)
  for (let i = 0; i < missingRows; i++) {
    incompleteRows.push({
      entryName: `Bracket`,
      displayName: "Member",
      status: "In progress",
      missingPicks: 0,
    })
  }

  // Finalized rows — we don't have a per-entry finalized list on the snapshot, so represent
  // them as a single aggregated row when commissioner has at least one finalized entry.
  const finalizedRows: ChecklistRow[] =
    completed > 0
      ? [
          {
            entryName: `${completed} finalized bracket${completed === 1 ? "" : "s"}`,
            displayName: "—",
            status: "Finalized",
            missingPicks: 0,
          },
        ]
      : []

  const rows: ChecklistRow[] = [...finalizedRows, ...incompleteRows]

  // Counts derived strictly from the snapshot — never invent data.
  const notStarted = Math.max(0, totalEntries - completed - incompleteCount)
  const percentComplete = totalEntries > 0 ? Math.round((completed / totalEntries) * 100) : 0

  const summary: ChecklistSummary = {
    totalEntries,
    finalized: completed,
    inProgress: incompleteCount,
    notStarted,
    percentComplete,
  }

  // Reminder copy — commissioner-safe. Never includes invite code; invite
  // URL is the only commissioner-supplied addressing surface that survives
  // the reminder template (matches the spec for not leaking codes via
  // public reminder messages).
  const reminderLines: string[] = []
  reminderLines.push(tpl.finalizeLine(poolName))
  if (lockDeadlineLabel) {
    reminderLines.push(tpl.deadlineLine(lockDeadlineLabel))
  }
  reminderLines.push(
    tpl.statusLine(completed, totalEntries, percentComplete)
  )
  if (poolUrl) {
    reminderLines.push(poolUrl)
  }
  reminderLines.push(tpl.poweredBy)

  return {
    status: "ready",
    summary,
    rows,
    reminderMessage: sanitize(reminderLines.join("\n")),
  }
}
