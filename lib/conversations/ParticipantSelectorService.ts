/**
 * ParticipantSelectorService — resolve display names for DM/group participants.
 * Thread title may be null for DM; context or separate API can provide other participant name.
 */

export function parseParticipantUsernames(input: string): string[] {
  const raw = input
    .split(/[\s,]+/)
    .map((entry) => entry.trim().replace(/^@+/, ""))
    .filter(Boolean)
  return Array.from(new Set(raw))
}

