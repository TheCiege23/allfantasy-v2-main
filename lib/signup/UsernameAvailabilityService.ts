type UsernameAvailabilityResult =
  | {
      ok: true
      available: true
      reason: "ok" | "unchecked"
      status?: "ok" | "unchecked"
      verified?: boolean
    }
  | {
      ok: boolean
      available: false
      reason:
        | "taken"
        | "profanity"
        | "length"
        | "charset"
        | "empty"
        | "db_unavailable"
        | "error"
      status?: string
    }

export async function checkUsernameAvailability(
  username: string
): Promise<UsernameAvailabilityResult> {
  const res = await fetch(
    `/api/auth/check-username?username=${encodeURIComponent(username)}`
  )
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!raw || typeof raw !== "object" || !("available" in raw)) {
    return { ok: false, available: false, reason: "error" }
  }

  const available = Boolean(raw.available)
  const reason =
    typeof raw.reason === "string"
      ? raw.reason
      : available
        ? "ok"
        : "error"
  const status = typeof raw.status === "string" ? raw.status : undefined

  if (status === "unchecked" || reason === "unchecked") {
    return {
      ok: true,
      available: true,
      reason: "unchecked",
      status: "unchecked",
      verified: raw.verified === true,
    }
  }

  if (!available) {
    if (
      reason === "taken" ||
      reason === "profanity" ||
      reason === "length" ||
      reason === "charset" ||
      reason === "empty" ||
      reason === "db_unavailable" ||
      reason === "error"
    ) {
      return { ok: raw.ok !== false, available: false, reason, status }
    }
    return { ok: raw.ok !== false, available: false, reason: "error" }
  }

  return {
    ok: true,
    available: true,
    reason: "ok",
    status: "ok",
    verified: raw.verified === true,
  }
}

export async function suggestUsername(base: string): Promise<string | null> {
  const res = await fetch(
    `/api/auth/suggest-username?base=${encodeURIComponent(base)}`
  )
  const data = (await res.json().catch(() => ({}))) as { suggestion?: string }
  return typeof data?.suggestion === "string" ? data.suggestion : null
}
