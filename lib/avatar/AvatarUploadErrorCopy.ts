/**
 * Server error CODES → a sentence the person reading it can act on.
 *
 * ⚠ THE UPLOAD SURFACES RENDERED THE RAW CODE. Both avatar editors did
 * `setUploadError(data.error)` straight through, so a Play Store tester who could not
 * change their avatar was shown the literal string `AGE_REQUIRED` and reported it as
 * "nothing happened / not clear". Reported 2026-09-01.
 *
 * ⚠ UNRECOGNISED INPUT IS PASSED THROUGH UNCHANGED, DELIBERATELY. The avatar routes also
 * return already-human strings, and collapsing those into a generic "Upload failed" would
 * discard the one detail that tells someone what to do next. This maps the codes it knows
 * and gets out of the way otherwise.
 */

/** Codes this maps. Anything else is returned as-is. */
const ERROR_COPY: Record<string, string> = {
  UNAUTHENTICATED: "Sign in to change your picture.",
  Unauthorized: "Sign in to change your picture.",
  VERIFICATION_REQUIRED:
    "Verify your email before uploading a picture — check your inbox, or resend it from Settings › Account.",
  AGE_REQUIRED: "Confirm your age before uploading a picture.",
  INTERNAL_ERROR: "Something went wrong saving your picture. Try again.",
  "Storage not configured": "Picture uploads are unavailable right now. Try again shortly.",
}

export function describeAvatarUploadError(raw: string | null | undefined): string {
  const code = typeof raw === "string" ? raw.trim() : ""
  if (!code) return "Upload failed. Try again."
  return ERROR_COPY[code] ?? code
}
