/**
 * Quiet hours, evaluated in the USER's timezone.
 *
 * 🛑 THE IMPLEMENTATION THIS REPLACES ACCEPTED A TIMEZONE AND THEN IGNORED IT.
 * `lib/chimmy-alerts/types.ts` declares `quietHours: { startHour, endHour, timezone?,
 * allowCritical? }`, `app/api/ai/alerts/preferences/route.ts` accepts and stores the
 * timezone, and `ChimmyAlertDeliveryRouter.isWithinQuietHours` then calls
 * `now.getHours()` — the SERVER's local hour, which on Vercel is UTC. Nothing anywhere
 * read the field.
 *
 * The consequence is not subtle and it is silent: a user in US Eastern who sets quiet
 * hours 22:00–07:00 gets them applied 17:00–02:00 their time. Their evening goes quiet
 * and 3am does not. The setting appears to work — it just silences the wrong half of
 * the day, and no error is ever produced.
 *
 * ⚠ SO THE TIMEZONE IS NOT OPTIONAL HERE EVEN THOUGH THE FIELD IS. When none is
 * recorded the caller passes the profile's timezone, and only if that is also absent do
 * we fall back to server-local — which is at least honest about being a guess rather
 * than presenting a stored preference we never read.
 */

export interface QuietHoursPreference {
  /** 0-23, inclusive. */
  startHour: number
  /** 0-23, exclusive. */
  endHour: number
  /** IANA zone, e.g. "America/New_York". */
  timezone?: string | null
  /** Let severity: "high" through anyway. Default false. */
  allowCritical?: boolean
  /** A stored-but-off window keeps its hours; this is the switch. */
  enabled?: boolean
}

/**
 * The local hour in an IANA zone.
 *
 * ⚠ `hour12: false` CAN YIELD "24" AT MIDNIGHT in some ICU builds, which is why the
 * result is taken modulo 24. A raw 24 compares wrong against every window and would
 * make midnight behave like no hour at all.
 */
export function hourInZone(now: Date, timezone?: string | null): number {
  if (!timezone) return now.getHours()
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(now)
    const parsed = Number.parseInt(formatted, 10)
    if (!Number.isFinite(parsed)) return now.getHours()
    return parsed % 24
  } catch {
    // An invalid or unknown zone must not take notifications down with it.
    return now.getHours()
  }
}

/**
 * Is `now` inside the window, in the user's zone?
 *
 * ⚠ THE WINDOW WRAPS MIDNIGHT AND THAT IS THE NORMAL CASE, not the edge case — almost
 * every real quiet-hours setting looks like 22 → 7. When `start > end` the window is
 * the UNION of [start, 24) and [0, end), not an empty range.
 */
export function isWithinQuietHours(
  quiet: QuietHoursPreference | null | undefined,
  now: Date,
  fallbackTimezone?: string | null,
): boolean {
  if (!quiet) return false
  if (quiet.enabled === false) return false

  const { startHour, endHour } = quiet
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return false
  if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) return false
  // A zero-width window is "off", not "always on" — the latter would silence everything.
  if (startHour === endHour) return false

  const hour = hourInZone(now, quiet.timezone ?? fallbackTimezone)
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour
}

/**
 * Which channels quiet hours actually suppress.
 *
 * 🛑 IT SUPPRESSES THE ONES THAT BUZZ A PHONE, AND NOTHING ELSE. Push and SMS wake
 * someone up; that is the entire point of the setting. The in-app row is a LOG and must
 * still be written, or the user wakes to no record that anything happened and the
 * notifications screen lies about their night. Email sits in an inbox and does not
 * interrupt, so it goes too.
 *
 * ⚠ Suppressing the in-app row would also break the unread badge, which counts stored
 * rows — quiet hours would silently delete history rather than defer a buzz.
 */
export function quietHoursSuppression(
  quiet: QuietHoursPreference | null | undefined,
  now: Date,
  severity: "low" | "medium" | "high",
  fallbackTimezone?: string | null,
): { push: boolean; sms: boolean } {
  if (!isWithinQuietHours(quiet, now, fallbackTimezone)) {
    return { push: false, sms: false }
  }
  if (quiet?.allowCritical && severity === "high") {
    return { push: false, sms: false }
  }
  return { push: true, sms: true }
}
