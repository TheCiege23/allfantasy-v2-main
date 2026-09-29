/**
 * Shared moderation constants safe for client/server imports.
 */

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "violence",
  "nudity",
  "self_harm",
  "impersonation",
  "other",
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

/** What a person reads when choosing a reason — one list for every chat that offers Report. */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech",
  violence: "Violence or threats",
  nudity: "Nudity or sexual content",
  self_harm: "Self-harm",
  impersonation: "Pretending to be someone",
  other: "Something else",
}

export const REPORT_STATUS = ["pending", "reviewed", "resolved", "dismissed"] as const
