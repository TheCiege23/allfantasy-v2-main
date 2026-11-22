import { NextResponse } from 'next/server'
import type { LegacyPatchParse } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import type { SlotConflict } from '@/lib/legacy-specialty-settings/legacySettingsLocks'

/** 400 / 409 for a body that failed the allowlist; the panels read `code` and the lists. */
export function legacyParseError(parsed: Exclude<LegacyPatchParse, { ok: true }>) {
  const { ok: _ok, status, ...rest } = parsed
  const error =
    parsed.code === 'UNKNOWN_FIELDS'
      ? `Unknown fields: ${parsed.unknown.join(', ')}`
      : parsed.code === 'FIELD_LOCKED'
        ? parsed.locked.map((l) => `${l.field}: ${l.reason}`).join(' ')
        : parsed.code === 'INVALID_FIELDS'
          ? parsed.invalid.map((i) => `${i.field} ${i.reason}`).join('; ')
          : 'No updatable fields in body'
  return NextResponse.json({ error, ...rest }, { status })
}

/** 409 when a slot count would drop below what a team already holds. */
export function slotConflictResponse(conflicts: SlotConflict[]) {
  return NextResponse.json(
    {
      error: conflicts.map((c) => `${c.field} cannot go below ${c.held}: a team holds ${c.held} there now.`).join(' '),
      code: 'SLOT_BELOW_HELD',
      conflicts,
    },
    { status: 409 },
  )
}
