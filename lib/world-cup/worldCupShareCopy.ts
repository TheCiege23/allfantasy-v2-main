/**
 * worldCupShareCopy.ts
 *
 * Pure deterministic helpers for launch-growth share/invite copy. No LLM
 * call. No external fetch. Used by the Invite tab (commissioner Copy
 * Invite Message) and the Review tab (finalized bracket Share CTA +
 * social caption helpers).
 *
 * Privacy:
 *   - Commissioner-only data (invite code / invite link) is only
 *     surfaced when the caller explicitly passes it. Helpers never
 *     fabricate a fake link.
 *   - Member-facing helpers never include invite code or link.
 *
 * Localization (Phase 4):
 *   - All builders accept an optional `locale` parameter (`en` default)
 *     and produce deterministic translated copy for en/es/zh/fil/vi.
 *   - The mandatory `WORLD_CUP_SOCIAL_HASHTAGS` block is identical
 *     across every locale per product preference.
 *   - The "Powered by AllFantasy." line is also localized via
 *     `POWERED_BY_BY_LOCALE`.
 *   - No Google Translate / OpenAI call at runtime; templates are
 *     static and verified by tests.
 */
import {
  getWorldCupLocale,
  type WorldCupLocale,
  type WorldCupShareTone,
  WORLD_CUP_DEFAULT_SHARE_TONE,
} from "@/lib/world-cup/worldCupI18n"

/**
 * Required social hashtag block. Applied to every generated social
 * caption per product preference, even for World Cup pools.
 *
 * IMPORTANT: this block is locale-invariant — tests assert it must
 * appear verbatim in every translated caption.
 */
export const WORLD_CUP_SOCIAL_HASHTAGS =
  "#fantasyfootball #NFL #football #fantasyfootballadvice #sports #nflnews #fantasyfootballdraft"

const POWERED_BY_BY_LOCALE: Record<string, string> = {
  en: "Powered by AllFantasy.",
  es: "Hecho con AllFantasy.",
  zh: "由 AllFantasy 提供支援。",
  fil: "Powered by AllFantasy.",
  vi: "Hỗ trợ bởi AllFantasy.",
}

const POWERED_BY = POWERED_BY_BY_LOCALE.en

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

// ── 1. Commissioner Invite Message ──────────────────────────────────────────

type WorldCupInviteMessageInput = {
  /** Pool display name. */
  poolName: string
  /** Public join URL — required. */
  inviteUrl: string
  /** Invite code — optional; surfaced as a secondary line when present. */
  inviteCode?: string | null
  /** Human-readable lock deadline string (e.g. "June 11, 2026 3:00 PM ET"). */
  lockDeadlineLabel?: string | null
  /** Visibility of the message — only "commissioner" surfaces invite code/link. */
  audience?: "commissioner" | "member"
  /** Locale for translated templates. Defaults to "en". */
  locale?: WorldCupLocale | string | null
}

type WorldCupInviteMessageResult = {
  status: "ready" | "member_blocked"
  message: string
  /** Lines used to build the message — useful for previewing. */
  lines: string[]
}

type InviteMessageTemplates = {
  memberHeading: (poolName: string) => string
  memberAsk: string
  commissionerHeading: (poolName: string) => string
  commissionerPitch: string
  deadline: (label: string) => string
  inviteCodeLine: (code: string) => string
}

const INVITE_MESSAGE_TEMPLATES: Record<string, InviteMessageTemplates> = {
  en: {
    memberHeading: (p) => `Want to join the AllFantasy World Cup Bracket Pool "${p}"?`,
    memberAsk: "Ask the pool commissioner for the invite link.",
    commissionerHeading: (p) => `Join my 2026 World Cup Bracket Pool on AllFantasy: ${p}.`,
    commissionerPitch:
      "Make your picks, finalize your bracket, and see if your AI Bracket Report says you can beat the pool.",
    deadline: (l) => `Picks lock ${l}.`,
    inviteCodeLine: (c) => `Invite code: ${c}`,
  },
  es: {
    memberHeading: (p) =>
      `¿Quieres unirte al grupo de brackets de la Copa del Mundo de AllFantasy "${p}"?`,
    memberAsk: "Pídele al comisionado del grupo el enlace de invitación.",
    commissionerHeading: (p) =>
      `Únete a mi grupo de brackets de la Copa del Mundo 2026 en AllFantasy: ${p}.`,
    commissionerPitch:
      "Haz tus picks, finaliza tu bracket y mira si tu Informe IA dice que puedes ganarle al grupo.",
    deadline: (l) => `Los picks cierran ${l}.`,
    inviteCodeLine: (c) => `Código de invitación: ${c}`,
  },
  zh: {
    memberHeading: (p) =>
      `想加入 AllFantasy 的世界盃對戰群組「${p}」嗎?`,
    memberAsk: "請向群組管理員索取邀請連結。",
    commissionerHeading: (p) =>
      `來加入我在 AllFantasy 的 2026 世界盃對戰群組:${p}。`,
    commissionerPitch:
      "做出你的選擇、送出對戰表,看看 AI 對戰表報告能不能說你可以擊敗整個群組。",
    deadline: (l) => `選擇將於 ${l} 鎖定。`,
    inviteCodeLine: (c) => `邀請碼:${c}`,
  },
  fil: {
    memberHeading: (p) =>
      `Gusto mong sumali sa AllFantasy World Cup Bracket Pool na "${p}"?`,
    memberAsk: "Humingi sa pool commissioner ng invite link.",
    commissionerHeading: (p) =>
      `Sumali sa 2026 World Cup Bracket Pool ko sa AllFantasy: ${p}.`,
    commissionerPitch:
      "Mag-pick ka, i-finalize ang bracket mo, at tingnan kung sasabihin ng AI Bracket Report mo na kaya mong talunin ang pool.",
    deadline: (l) => `Magla-lock ang picks ${l}.`,
    inviteCodeLine: (c) => `Invite code: ${c}`,
  },
  vi: {
    memberHeading: (p) =>
      `Muốn tham gia pool bracket World Cup AllFantasy "${p}" không?`,
    memberAsk: "Hãy hỏi chủ pool để lấy link mời.",
    commissionerHeading: (p) =>
      `Tham gia pool bracket World Cup 2026 của tôi trên AllFantasy: ${p}.`,
    commissionerPitch:
      "Đưa ra lựa chọn, hoàn tất bracket, và xem báo cáo AI nói bạn có thể đánh bại pool hay không.",
    deadline: (l) => `Lựa chọn khoá lúc ${l}.`,
    inviteCodeLine: (c) => `Mã mời: ${c}`,
  },
}

/**
 * Builds a ready-to-send commissioner invite message. Returns a `member_blocked`
 * status when the caller is a non-commissioner — the message is then a safe
 * fallback that does not include invite code or link.
 *
 * Locale-aware (Phase 4) — defaults to English when unset. Member output
 * never includes invite code/link/url regardless of locale.
 */
export function buildWorldCupInviteMessage(
  input: WorldCupInviteMessageInput
): WorldCupInviteMessageResult {
  const {
    poolName,
    inviteUrl,
    inviteCode,
    lockDeadlineLabel,
    audience = "commissioner",
    locale,
  } = input

  const lang = getWorldCupLocale(locale)
  const tpl = INVITE_MESSAGE_TEMPLATES[lang] ?? INVITE_MESSAGE_TEMPLATES.en
  const poweredBy = POWERED_BY_BY_LOCALE[lang] ?? POWERED_BY

  if (audience === "member") {
    const lines = [
      tpl.memberHeading(poolName),
      tpl.memberAsk,
      poweredBy,
    ]
    return {
      status: "member_blocked",
      message: sanitize(lines.join("\n")),
      lines,
    }
  }

  const lines: string[] = []
  lines.push(tpl.commissionerHeading(poolName))
  lines.push(tpl.commissionerPitch)
  if (lockDeadlineLabel) {
    lines.push(tpl.deadline(lockDeadlineLabel))
  }
  lines.push(inviteUrl)
  if (inviteCode) {
    lines.push(tpl.inviteCodeLine(inviteCode))
  }
  lines.push(poweredBy)

  return {
    status: "ready",
    message: sanitize(lines.join("\n")),
    lines,
  }
}

// ── 2. Finalized Bracket Share Message ──────────────────────────────────────

type WorldCupBracketShareInput = {
  poolName: string
  entryName?: string | null
  championName?: string | null
  /** Bracket Grade letter (e.g. "B+"). When absent, falls back to a generic line. */
  gradeLabel?: string | null
  /** Whether the bracket has been submitted/finalized. */
  isComplete?: boolean
  /** Public pool URL — optional. When present, included so friends can join. */
  poolUrl?: string | null
  /** Pre-built AI share card text — when present, takes priority over deterministic build. */
  prebuiltShareText?: string | null
  /** Locale for translated templates. Defaults to "en". */
  locale?: WorldCupLocale | string | null
}

type WorldCupBracketShareResult = {
  status: "ready" | "incomplete"
  message: string
  lines: string[]
}

type BracketShareTemplates = {
  heading: (poolName: string) => string
  entryLine: (entryName: string, complete: boolean) => string
  noEntryLine: (complete: boolean) => string
  championLine: (championName: string) => string
  gradeLine: (gradeLabel: string) => string
  ctaComplete: string
  ctaIncomplete: string
}

const BRACKET_SHARE_TEMPLATES: Record<string, BracketShareTemplates> = {
  en: {
    heading: (p) => `My AllFantasy World Cup Bracket — ${p}.`,
    entryLine: (n, c) => `${n} — ${c ? "locked in" : "in progress"}.`,
    noEntryLine: (c) => `My bracket is ${c ? "locked in" : "in progress"}.`,
    championLine: (n) => `Champion pick: ${n}.`,
    gradeLine: (g) => `Bracket Grade: ${g}.`,
    ctaComplete: "Think you can beat my bracket?",
    ctaIncomplete: "Make your picks before lock and see if you can beat mine.",
  },
  es: {
    heading: (p) => `Mi bracket de la Copa del Mundo de AllFantasy — ${p}.`,
    entryLine: (n, c) => `${n} — ${c ? "confirmado" : "en progreso"}.`,
    noEntryLine: (c) =>
      `Mi bracket está ${c ? "confirmado" : "en progreso"}.`,
    championLine: (n) => `Campeón elegido: ${n}.`,
    gradeLine: (g) => `Calificación: ${g}.`,
    ctaComplete: "¿Crees que puedes vencer mi bracket?",
    ctaIncomplete:
      "Haz tus picks antes del cierre y mira si puedes vencerme.",
  },
  zh: {
    heading: (p) => `我的 AllFantasy 世界盃對戰表 — ${p}。`,
    entryLine: (n, c) => `${n} — ${c ? "已鎖定" : "進行中"}。`,
    noEntryLine: (c) => `我的對戰表${c ? "已鎖定" : "進行中"}。`,
    championLine: (n) => `冠軍選擇:${n}。`,
    gradeLine: (g) => `對戰表評分:${g}。`,
    ctaComplete: "覺得你能贏過我的對戰表嗎?",
    ctaIncomplete:
      "在鎖定前做好你的選擇,看看你能不能贏我。",
  },
  fil: {
    heading: (p) => `Aking AllFantasy World Cup Bracket — ${p}.`,
    entryLine: (n, c) =>
      `${n} — ${c ? "naka-lock" : "ginagawa pa"}.`,
    noEntryLine: (c) =>
      `Ang bracket ko ay ${c ? "naka-lock na" : "ginagawa pa"}.`,
    championLine: (n) => `Champion pick: ${n}.`,
    gradeLine: (g) => `Bracket Grade: ${g}.`,
    ctaComplete: "Sa tingin mo matatalo mo ba ang bracket ko?",
    ctaIncomplete:
      "Mag-pick ka bago mag-lock at tingnan kung matatalo mo ako.",
  },
  vi: {
    heading: (p) => `Bracket World Cup AllFantasy của tôi — ${p}.`,
    entryLine: (n, c) =>
      `${n} — ${c ? "đã khoá" : "đang làm"}.`,
    noEntryLine: (c) =>
      `Bracket của tôi ${c ? "đã khoá" : "đang làm"}.`,
    championLine: (n) => `Lựa chọn nhà vô địch: ${n}.`,
    gradeLine: (g) => `Điểm bracket: ${g}.`,
    ctaComplete: "Bạn nghĩ mình thắng được bracket của tôi không?",
    ctaIncomplete:
      "Hoàn thành lựa chọn trước khi khoá và xem có thắng tôi được không.",
  },
}

/**
 * Builds a share message for the user's own finalized bracket. Prefers the
 * AI Share Card text when available; otherwise composes a deterministic
 * message from champion + grade + pool name.
 *
 * Locale-aware (Phase 4) — defaults to English when unset. The optional
 * `prebuiltShareText` path bypasses locale templates (the caller is
 * expected to have already localized it).
 */
export function buildWorldCupBracketShareMessage(
  input: WorldCupBracketShareInput
): WorldCupBracketShareResult {
  const {
    poolName,
    entryName,
    championName,
    gradeLabel,
    isComplete = false,
    poolUrl,
    prebuiltShareText,
    locale,
  } = input

  const lang = getWorldCupLocale(locale)
  const tpl = BRACKET_SHARE_TEMPLATES[lang] ?? BRACKET_SHARE_TEMPLATES.en
  const poweredBy = POWERED_BY_BY_LOCALE[lang] ?? POWERED_BY

  if (prebuiltShareText && prebuiltShareText.trim().length > 0) {
    const cleaned = sanitize(prebuiltShareText)
    return {
      status: isComplete ? "ready" : "incomplete",
      message: cleaned,
      lines: cleaned.split("\n"),
    }
  }

  const lines: string[] = []
  lines.push(tpl.heading(poolName))
  if (entryName) {
    lines.push(tpl.entryLine(entryName, isComplete))
  } else {
    lines.push(tpl.noEntryLine(isComplete))
  }
  if (championName) {
    lines.push(tpl.championLine(championName))
  }
  if (gradeLabel) {
    lines.push(tpl.gradeLine(gradeLabel))
  }
  lines.push(isComplete ? tpl.ctaComplete : tpl.ctaIncomplete)
  if (poolUrl) {
    lines.push(poolUrl)
  }
  lines.push(poweredBy)

  return {
    status: isComplete ? "ready" : "incomplete",
    message: sanitize(lines.join("\n")),
    lines,
  }
}

// ── 3. Social Caption Helper ────────────────────────────────────────────────

type WorldCupSocialCaptionInput = WorldCupBracketShareInput & {
  /**
   * Optional tone scaffolding (Phase 6). Defaults to "friendly". Tone
   * variants stay sports-centered and pass the existing `sanitize()`
   * blocklist (no wagering/betting/sportsbook/odds/DFS). No visible UI
   * mounts a selector yet — this parameter is reserved for future surfaces.
   */
  tone?: WorldCupShareTone
}

export type WorldCupSocialCaptions = {
  twitter: string
  instagram: string
  discord: string
  facebook: string
  reddit: { title: string; body: string }
}

/**
 * Per-locale, per-tone caption templates. Each template returns the body
 * (without the required hashtag block, which is appended by the builder).
 *
 * Tone guardrails (enforced by tests):
 *   - sports-centered — focuses on picks, brackets, matchups, not on people.
 *   - no hate / slurs / threats / personal attacks.
 *   - no wagering / betting / sportsbook / odds / DFS — caught by sanitize().
 *
 * Placeholders:
 *   {{pool}}      — pool name (or locale-specific generic "World Cup pool")
 *   {{championLn}} — "Champion: Brazil." or "" (already locale-translated)
 *   {{gradeLn}}    — "Grade: B+." or "" (already locale-translated)
 *   {{ctaTail}}    — pool URL with leading space, or ""
 *   {{poolUrl}}    — pool URL bare (no leading space), or ""
 */
type CaptionContext = {
  pool: string
  championLn: string
  gradeLn: string
  ctaTail: string
  poolUrl: string
}

type CaptionTemplates = {
  twitter: (c: CaptionContext) => string
  instagram: (c: CaptionContext) => string
  discord: (c: CaptionContext) => string
  facebook: (c: CaptionContext) => string
  redditTitle: (c: CaptionContext) => string
  redditBody: (c: CaptionContext) => string
}

const GENERIC_POOL_BY_LOCALE: Record<string, string> = {
  en: "World Cup pool",
  es: "grupo de la Copa del Mundo",
  zh: "世界盃對戰群組",
  fil: "World Cup pool",
  vi: "pool World Cup",
}

const CHAMPION_LABEL_BY_LOCALE: Record<string, (n: string) => string> = {
  en: (n) => `Champion: ${n}.`,
  es: (n) => `Campeón: ${n}.`,
  zh: (n) => `冠軍:${n}。`,
  fil: (n) => `Champion: ${n}.`,
  vi: (n) => `Nhà vô địch: ${n}.`,
}

const GRADE_LABEL_BY_LOCALE: Record<string, (g: string) => string> = {
  en: (g) => `Grade: ${g}.`,
  es: (g) => `Calificación: ${g}.`,
  zh: (g) => `評分:${g}。`,
  fil: (g) => `Grade: ${g}.`,
  vi: (g) => `Điểm: ${g}.`,
}

const CAPTION_TEMPLATES: Record<
  string,
  Record<WorldCupShareTone, CaptionTemplates>
> = {
  en: {
    friendly: {
      twitter: (c) =>
        `My ${c.pool} World Cup bracket is locked in on AllFantasy. ${c.championLn} ${c.gradeLn} Think you can beat it?${c.ctaTail}`,
      instagram: (c) =>
        [
          `My AllFantasy World Cup bracket is locked in.`,
          `Pool: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `AI Bracket Report says it's ready for the field.`,
          `Make your picks and try to beat it.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Locked in my ${c.pool} World Cup bracket on AllFantasy. ${c.championLn} ${c.gradeLn} Think you can beat it? Pool link below. ${c.poolUrl}`,
      facebook: (c) =>
        `Just locked in my World Cup bracket on AllFantasy for ${c.pool}. ${c.championLn} ${c.gradeLn} Make your picks and see if you can beat mine.${c.ctaTail}`,
      redditTitle: (c) =>
        `My ${c.pool} World Cup bracket is locked in — think you can beat it?`,
      redditBody: (c) =>
        [
          `Made my picks on AllFantasy for ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Pool link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    hype: {
      twitter: (c) =>
        `Bracket locked. ${c.pool}. World Cup ${new Date().getFullYear()}. AllFantasy. ${c.championLn} ${c.gradeLn} Bring it on.${c.ctaTail}`,
      instagram: (c) =>
        [
          `Bracket. Locked. In.`,
          `Pool: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `World Cup mode: engaged.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Bracket LOCKED for ${c.pool}. ${c.championLn} ${c.gradeLn} Get in or get left out. ${c.poolUrl}`,
      facebook: (c) =>
        `Bracket locked in for ${c.pool} World Cup pool. ${c.championLn} ${c.gradeLn} Bring your A-game.${c.ctaTail}`,
      redditTitle: (c) =>
        `Bracket locked for ${c.pool} — World Cup mode engaged`,
      redditBody: (c) =>
        [
          `Picks are in for ${c.pool} on AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Pool link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    trash_talk: {
      twitter: (c) =>
        `My ${c.pool} bracket is locked. ${c.championLn} ${c.gradeLn} Your picks look like a Wikipedia rough draft. Try to keep up.${c.ctaTail}`,
      instagram: (c) =>
        [
          `Locked it in for ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Bring your best bracket — mine already grades higher than yours will.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Bracket in for ${c.pool}. ${c.championLn} ${c.gradeLn} Your bracket is going to need a refund. ${c.poolUrl}`,
      facebook: (c) =>
        `Locked the bracket for ${c.pool}. ${c.championLn} ${c.gradeLn} Friendly reminder: your picks will be studied as a cautionary tale.${c.ctaTail}`,
      redditTitle: (c) =>
        `My ${c.pool} bracket is locked — yours is cooked`,
      redditBody: (c) =>
        [
          `Picks are in for ${c.pool} on AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Sit your bracket down. Pool link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
  },
  es: {
    friendly: {
      twitter: (c) =>
        `Mi bracket del ${c.pool} está confirmado en AllFantasy. ${c.championLn} ${c.gradeLn} ¿Crees que puedes vencerlo?${c.ctaTail}`,
      instagram: (c) =>
        [
          `Mi bracket de la Copa del Mundo en AllFantasy está confirmado.`,
          `Grupo: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `El Informe IA dice que está listo para la cancha.`,
          `Haz tus picks y trata de vencerme.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Confirmé mi bracket del ${c.pool} en AllFantasy. ${c.championLn} ${c.gradeLn} ¿Crees que lo puedes vencer? Enlace abajo. ${c.poolUrl}`,
      facebook: (c) =>
        `Confirmé mi bracket de la Copa del Mundo en AllFantasy para ${c.pool}. ${c.championLn} ${c.gradeLn} Haz tus picks y mira si me ganas.${c.ctaTail}`,
      redditTitle: (c) =>
        `Mi bracket de ${c.pool} está confirmado — ¿crees que puedes vencerlo?`,
      redditBody: (c) =>
        [
          `Hice mis picks en AllFantasy para ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Enlace del grupo: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    hype: {
      twitter: (c) =>
        `Bracket confirmado. ${c.pool}. Copa del Mundo. AllFantasy. ${c.championLn} ${c.gradeLn} A darle.${c.ctaTail}`,
      instagram: (c) =>
        [
          `Bracket. Confirmado.`,
          `Grupo: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `Modo Copa del Mundo: activado.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Bracket CONFIRMADO para ${c.pool}. ${c.championLn} ${c.gradeLn} Entra o quédate fuera. ${c.poolUrl}`,
      facebook: (c) =>
        `Bracket confirmado para ${c.pool}. ${c.championLn} ${c.gradeLn} Trae tu mejor juego.${c.ctaTail}`,
      redditTitle: (c) =>
        `Bracket confirmado para ${c.pool} — modo Copa del Mundo activado`,
      redditBody: (c) =>
        [
          `Picks listos para ${c.pool} en AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Enlace del grupo: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    trash_talk: {
      twitter: (c) =>
        `Mi bracket de ${c.pool} está confirmado. ${c.championLn} ${c.gradeLn} Tus picks parecen un primer borrador. Trata de seguir el paso.${c.ctaTail}`,
      instagram: (c) =>
        [
          `Confirmado para ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Trae tu mejor bracket — el mío ya tiene mejor calificación que el tuyo.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Bracket listo para ${c.pool}. ${c.championLn} ${c.gradeLn} Tu bracket va a pedir reembolso. ${c.poolUrl}`,
      facebook: (c) =>
        `Bracket confirmado para ${c.pool}. ${c.championLn} ${c.gradeLn} Recordatorio amistoso: tus picks se van a estudiar como caso de advertencia.${c.ctaTail}`,
      redditTitle: (c) =>
        `Mi bracket de ${c.pool} está confirmado — el tuyo está cocinado`,
      redditBody: (c) =>
        [
          `Picks listos para ${c.pool} en AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Siéntate, bracket. Enlace: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
  },
  zh: {
    friendly: {
      twitter: (c) =>
        `我在 AllFantasy 的 ${c.pool} 世界盃對戰表已鎖定。${c.championLn} ${c.gradeLn} 覺得你能贏過我嗎?${c.ctaTail}`,
      instagram: (c) =>
        [
          `我在 AllFantasy 的世界盃對戰表已鎖定。`,
          `群組:${c.pool}`,
          c.championLn,
          c.gradeLn,
          `AI 對戰表報告說已經準備好出戰。`,
          `做出你的選擇,試著贏過我。`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `已在 AllFantasy 鎖定 ${c.pool} 的世界盃對戰表。${c.championLn} ${c.gradeLn} 覺得你能贏嗎?群組連結在下方。${c.poolUrl}`,
      facebook: (c) =>
        `剛剛在 AllFantasy 鎖定 ${c.pool} 的世界盃對戰表。${c.championLn} ${c.gradeLn} 做出你的選擇,看看能不能贏過我。${c.ctaTail}`,
      redditTitle: (c) =>
        `我的 ${c.pool} 世界盃對戰表已鎖定 — 覺得你能贏嗎?`,
      redditBody: (c) =>
        [
          `已在 AllFantasy 為 ${c.pool} 做好選擇。`,
          c.championLn,
          c.gradeLn,
          `群組連結:${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    hype: {
      twitter: (c) =>
        `對戰表已鎖定。${c.pool}。世界盃。AllFantasy。${c.championLn} ${c.gradeLn} 來吧!${c.ctaTail}`,
      instagram: (c) =>
        [
          `對戰表已鎖定。`,
          `群組:${c.pool}`,
          c.championLn,
          c.gradeLn,
          `世界盃模式:啟動。`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `${c.pool} 對戰表已鎖定。${c.championLn} ${c.gradeLn} 加入或被甩開。${c.poolUrl}`,
      facebook: (c) =>
        `${c.pool} 對戰表已鎖定。${c.championLn} ${c.gradeLn} 拿出你的最佳水準。${c.ctaTail}`,
      redditTitle: (c) =>
        `${c.pool} 對戰表已鎖定 — 世界盃模式啟動`,
      redditBody: (c) =>
        [
          `已在 AllFantasy 為 ${c.pool} 鎖定選擇。`,
          c.championLn,
          c.gradeLn,
          `群組連結:${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    trash_talk: {
      twitter: (c) =>
        `我的 ${c.pool} 對戰表已鎖定。${c.championLn} ${c.gradeLn} 你的選擇看起來像草稿。試著跟上吧。${c.ctaTail}`,
      instagram: (c) =>
        [
          `已為 ${c.pool} 鎖定。`,
          c.championLn,
          c.gradeLn,
          `拿出你最好的對戰表 — 我的評分已經比你的高了。`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `${c.pool} 對戰表已交。${c.championLn} ${c.gradeLn} 你的對戰表該申請退款了。${c.poolUrl}`,
      facebook: (c) =>
        `${c.pool} 對戰表已鎖定。${c.championLn} ${c.gradeLn} 友情提醒:你的選擇將成為反面教材。${c.ctaTail}`,
      redditTitle: (c) =>
        `我的 ${c.pool} 對戰表已鎖定 — 你的已經涼了`,
      redditBody: (c) =>
        [
          `已在 AllFantasy 為 ${c.pool} 做好選擇。`,
          c.championLn,
          c.gradeLn,
          `對戰表先冷靜一下。連結:${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
  },
  fil: {
    friendly: {
      twitter: (c) =>
        `Naka-lock na ang World Cup bracket ko sa AllFantasy para sa ${c.pool}. ${c.championLn} ${c.gradeLn} Sa tingin mo matatalo mo ba?${c.ctaTail}`,
      instagram: (c) =>
        [
          `Naka-lock na ang AllFantasy World Cup bracket ko.`,
          `Pool: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `Sabi ng AI Bracket Report handa na para sa laban.`,
          `Mag-pick ka at subukang talunin ako.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Naka-lock na ang ${c.pool} World Cup bracket ko sa AllFantasy. ${c.championLn} ${c.gradeLn} Sa tingin mo matatalo mo ba? Link sa baba. ${c.poolUrl}`,
      facebook: (c) =>
        `Kakalock-in lang ng World Cup bracket ko sa AllFantasy para sa ${c.pool}. ${c.championLn} ${c.gradeLn} Mag-pick ka at tingnan kung matatalo mo ako.${c.ctaTail}`,
      redditTitle: (c) =>
        `Naka-lock na ang ${c.pool} World Cup bracket ko — kaya mo bang talunin?`,
      redditBody: (c) =>
        [
          `Nag-pick na ako sa AllFantasy para sa ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Pool link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    hype: {
      twitter: (c) =>
        `Bracket locked. ${c.pool}. World Cup. AllFantasy. ${c.championLn} ${c.gradeLn} Tara na!${c.ctaTail}`,
      instagram: (c) =>
        [
          `Bracket. Locked.`,
          `Pool: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `World Cup mode: ON.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `LOCKED ang bracket para sa ${c.pool}. ${c.championLn} ${c.gradeLn} Sumali ka o iiwan ka. ${c.poolUrl}`,
      facebook: (c) =>
        `Bracket locked na para sa ${c.pool}. ${c.championLn} ${c.gradeLn} Bring your A-game.${c.ctaTail}`,
      redditTitle: (c) =>
        `Bracket locked para sa ${c.pool} — World Cup mode ON`,
      redditBody: (c) =>
        [
          `Tapos na ang picks para sa ${c.pool} sa AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Pool link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    trash_talk: {
      twitter: (c) =>
        `Locked na ang ${c.pool} bracket ko. ${c.championLn} ${c.gradeLn} Mukhang draft lang ang picks mo. Subukan mong abutan ako.${c.ctaTail}`,
      instagram: (c) =>
        [
          `Locked na para sa ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Bring your best bracket — mas mataas na ang grade ko kaysa sa iyo.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Locked ang bracket para sa ${c.pool}. ${c.championLn} ${c.gradeLn} Mag-refund ka na lang ng bracket mo. ${c.poolUrl}`,
      facebook: (c) =>
        `Locked ang bracket para sa ${c.pool}. ${c.championLn} ${c.gradeLn} Friendly reminder: ang picks mo ay magiging cautionary tale.${c.ctaTail}`,
      redditTitle: (c) =>
        `Locked na ang ${c.pool} bracket ko — luto na ang sa iyo`,
      redditBody: (c) =>
        [
          `Tapos ang picks para sa ${c.pool} sa AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Sit your bracket down. Link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
  },
  vi: {
    friendly: {
      twitter: (c) =>
        `Bracket World Cup của tôi đã khoá trên AllFantasy cho ${c.pool}. ${c.championLn} ${c.gradeLn} Bạn nghĩ mình thắng được không?${c.ctaTail}`,
      instagram: (c) =>
        [
          `Bracket World Cup của tôi trên AllFantasy đã khoá.`,
          `Pool: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `Báo cáo AI nói đã sẵn sàng ra sân.`,
          `Hoàn thành lựa chọn và thử thắng tôi đi.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Đã khoá bracket ${c.pool} trên AllFantasy. ${c.championLn} ${c.gradeLn} Bạn nghĩ mình thắng được không? Link pool bên dưới. ${c.poolUrl}`,
      facebook: (c) =>
        `Vừa khoá bracket World Cup trên AllFantasy cho ${c.pool}. ${c.championLn} ${c.gradeLn} Hoàn thành lựa chọn và xem có thắng tôi được không.${c.ctaTail}`,
      redditTitle: (c) =>
        `Bracket ${c.pool} World Cup của tôi đã khoá — bạn nghĩ mình thắng được?`,
      redditBody: (c) =>
        [
          `Đã chọn xong trên AllFantasy cho ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Link pool: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    hype: {
      twitter: (c) =>
        `Bracket đã khoá. ${c.pool}. World Cup. AllFantasy. ${c.championLn} ${c.gradeLn} Chiến!${c.ctaTail}`,
      instagram: (c) =>
        [
          `Bracket. Đã khoá.`,
          `Pool: ${c.pool}`,
          c.championLn,
          c.gradeLn,
          `World Cup mode: BẬT.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Bracket ĐÃ KHOÁ cho ${c.pool}. ${c.championLn} ${c.gradeLn} Tham gia hoặc bỏ qua. ${c.poolUrl}`,
      facebook: (c) =>
        `Bracket đã khoá cho ${c.pool}. ${c.championLn} ${c.gradeLn} Mang phong độ tốt nhất.${c.ctaTail}`,
      redditTitle: (c) =>
        `Bracket đã khoá cho ${c.pool} — World Cup mode BẬT`,
      redditBody: (c) =>
        [
          `Đã chọn xong cho ${c.pool} trên AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Link pool: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
    trash_talk: {
      twitter: (c) =>
        `Bracket ${c.pool} của tôi đã khoá. ${c.championLn} ${c.gradeLn} Bracket của bạn trông như bản nháp. Cố theo kịp nhé.${c.ctaTail}`,
      instagram: (c) =>
        [
          `Đã khoá cho ${c.pool}.`,
          c.championLn,
          c.gradeLn,
          `Mang bracket tốt nhất — bracket của tôi đã chấm cao hơn rồi.`,
          c.poolUrl,
        ]
          .filter(Boolean)
          .join("\n"),
      discord: (c) =>
        `Bracket nộp xong cho ${c.pool}. ${c.championLn} ${c.gradeLn} Bracket của bạn cần được hoàn tiền. ${c.poolUrl}`,
      facebook: (c) =>
        `Bracket đã khoá cho ${c.pool}. ${c.championLn} ${c.gradeLn} Lời nhắc nhẹ: lựa chọn của bạn sẽ được nghiên cứu như bài học cảnh báo.${c.ctaTail}`,
      redditTitle: (c) =>
        `Bracket ${c.pool} của tôi đã khoá — của bạn xong rồi`,
      redditBody: (c) =>
        [
          `Đã chọn xong cho ${c.pool} trên AllFantasy.`,
          c.championLn,
          c.gradeLn,
          `Bracket ngồi xuống đi. Link: ${c.poolUrl}`,
        ]
          .filter(Boolean)
          .join("\n"),
    },
  },
}

function resolveTone(tone: WorldCupShareTone | string | null | undefined): WorldCupShareTone {
  if (tone === "friendly" || tone === "hype" || tone === "trash_talk") return tone
  return WORLD_CUP_DEFAULT_SHARE_TONE
}

/**
 * Returns platform-friendly deterministic captions. Each platform respects
 * its own length norms; the required hashtag block is appended to every
 * caption per product preference.
 *
 * Phase 6:
 *   - All 5 locales supported (en / es / zh / fil / vi).
 *   - Optional `tone` parameter: friendly (default), hype, trash_talk.
 *   - Adds facebook + reddit captions alongside twitter / instagram / discord.
 *   - All output passes through `sanitize()` so wagering/betting/sportsbook/
 *     odds/DFS language is scrubbed.
 */
export function buildWorldCupSocialCaptions(
  input: WorldCupSocialCaptionInput
): WorldCupSocialCaptions {
  // We don't use the deterministic share message here, but call it so any
  // downstream change to the canonical share copy stays observable.
  void buildWorldCupBracketShareMessage(input)

  const lang = getWorldCupLocale(input.locale)
  const tone = resolveTone(input.tone)

  const championLn = input.championName
    ? (CHAMPION_LABEL_BY_LOCALE[lang] ?? CHAMPION_LABEL_BY_LOCALE.en)(input.championName)
    : ""
  const gradeLn = input.gradeLabel
    ? (GRADE_LABEL_BY_LOCALE[lang] ?? GRADE_LABEL_BY_LOCALE.en)(input.gradeLabel)
    : ""
  const poolUrl = input.poolUrl ?? ""
  const pool = input.poolName ? input.poolName : (GENERIC_POOL_BY_LOCALE[lang] ?? GENERIC_POOL_BY_LOCALE.en)
  const ctaTail = poolUrl ? ` ${poolUrl}` : ""

  const ctx: CaptionContext = { pool, championLn, gradeLn, ctaTail, poolUrl }
  const tpl = (CAPTION_TEMPLATES[lang] ?? CAPTION_TEMPLATES.en)[tone]

  // Twitter/X — keep under ~280 chars including hashtags. Critically, the
  // hashtag block must survive trimming (locale-invariant tests assert it
  // appears verbatim at the end), so we budget body length around it.
  const twitterHashtagTail = ` ${WORLD_CUP_SOCIAL_HASHTAGS}`
  const twitterBudget = Math.max(0, 270 - twitterHashtagTail.length)
  const twitterBody = sanitize(tpl.twitter(ctx)).slice(0, twitterBudget).trimEnd()
  const twitter = `${twitterBody}${twitterHashtagTail}`

  // Instagram/TikTok — line-broken, longer.
  const instagram = sanitize(
    `${tpl.instagram(ctx)}\n\n${WORLD_CUP_SOCIAL_HASHTAGS}`
  )

  // Discord / group chat — single-paragraph friendly.
  const discord = sanitize(`${tpl.discord(ctx)} ${WORLD_CUP_SOCIAL_HASHTAGS}`)

  // Facebook — paragraph form, comparable length to Instagram.
  const facebook = sanitize(`${tpl.facebook(ctx)}\n\n${WORLD_CUP_SOCIAL_HASHTAGS}`)

  // Reddit — split title + body. Title stays untagged (subreddit hashtags
  // aren't conventional). Body includes the hashtag block at the end.
  const reddit = {
    title: sanitize(tpl.redditTitle(ctx)),
    body: sanitize(`${tpl.redditBody(ctx)}\n\n${WORLD_CUP_SOCIAL_HASHTAGS}`),
  }

  return { twitter, instagram, discord, facebook, reddit }
}
