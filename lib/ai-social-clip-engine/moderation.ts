/**
 * AI Social Clip Engine — output moderation (PROMPT 146).
 * Blocklist check; no PII or harmful content in public clip copy.
 */

/** Words/phrases that must not appear in public clip copy. */
const BLOCKLIST: readonly string[] = [
  "internal only",
  "confidential",
  "do not share",
  "draft",
  "[placeholder]",
  "[insert",
  "TODO:",
  "FIXME:",
];

interface ModerationResult {
  passed: boolean;
  reason?: string;
}

/**
 * Check clip text for blocklist and basic safety. Returns passed: false if blocklist hit or empty.
 */
function moderateClipOutput(text: string): ModerationResult {
  if (!text || typeof text !== "string") {
    return { passed: false, reason: "Empty or invalid text" };
  }
  const lower = text.toLowerCase();
  for (const term of BLOCKLIST) {
    if (lower.includes(term.toLowerCase())) {
      return { passed: false, reason: `Blocklist: "${term}"` };
    }
  }
  if (text.length > 5000) {
    return { passed: false, reason: "Text exceeds max length" };
  }
  return { passed: true };
}

/**
 * Run moderation on the full structured clip result (all copy fields).
 */
export function moderateAIClipResult(result: {
  shortCaption?: string;
  headline?: string;
  ctaText?: string;
  socialCardCopy?: string;
  clipTitle?: string;
  thread?: string[];
}): ModerationResult {
  const parts = [
    result.shortCaption,
    result.headline,
    result.ctaText,
    result.socialCardCopy,
    result.clipTitle,
    ...(result.thread ?? []),
  ].filter(Boolean) as string[];

  for (const p of parts) {
    const r = moderateClipOutput(p);
    if (!r.passed) return r;
  }
  return { passed: true };
}
