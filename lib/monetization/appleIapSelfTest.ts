import { createPrivateKey, X509Certificate } from "node:crypto"
import { Environment } from "@apple/app-store-server-library"
import { appleServerApiClient, verifyAppleNotification } from "@/lib/monetization/appleStore"

/**
 * Is the Apple In-App Purchase configuration on THIS server right, not merely present?
 *
 * `appleIapConfigured()` only asks whether six variables are non-empty. This checks what each one
 * must be — and reports only shapes, IDs Apple prints in App Store Connect, and certificate names.
 * 🛑 It never returns the private key or a certificate body: the result is shown to an admin in a
 * browser and may be pasted into a chat.
 */

/** The App Store Connect record the iOS app ships under (ios-app/capacitor.config.json). */
export const EXPECTED_APPLE_BUNDLE_ID = "ai.allfantasy.app"
/** That record's numeric Apple ID (App Store Connect → App Information). */
export const EXPECTED_APPLE_APP_ID = "6815778932"
/** The root Apple signs StoreKit 2 transactions and V2 notifications under. */
const APPLE_JWS_ROOT_CN = "Apple Root CA - G3"

export type CheckStatus = "ok" | "wrong" | "missing"
export type ConfigCheck = { name: string; status: CheckStatus; detail: string }

type Env = Record<string, string | undefined>

function check(name: string, status: CheckStatus, detail: string): ConfigCheck {
  return { name, status, detail }
}

function commonName(dn: string): string {
  const cn = dn.split("\n").find((line) => line.startsWith("CN="))
  return cn ? cn.slice(3) : dn.replace(/\n/g, ", ")
}

export function checkAppleIapConfig(env: Env = process.env): ConfigCheck[] {
  const value = (name: string) => env[name]?.trim() || ""
  const out: ConfigCheck[] = []

  const bundleId = value("APPLE_IAP_BUNDLE_ID")
  out.push(
    !bundleId
      ? check("APPLE_IAP_BUNDLE_ID", "missing", "not set")
      : bundleId === EXPECTED_APPLE_BUNDLE_ID
        ? check("APPLE_IAP_BUNDLE_ID", "ok", bundleId)
        : check("APPLE_IAP_BUNDLE_ID", "wrong", `"${bundleId}" — must be ${EXPECTED_APPLE_BUNDLE_ID}; Apple rejects every transaction signed for another bundle`)
  )

  const appId = value("APPLE_IAP_APP_APPLE_ID")
  out.push(
    !appId
      ? check("APPLE_IAP_APP_APPLE_ID", "missing", "not set")
      : appId === EXPECTED_APPLE_APP_ID
        ? check("APPLE_IAP_APP_APPLE_ID", "ok", appId)
        : check("APPLE_IAP_APP_APPLE_ID", "wrong", `"${appId}" — must be ${EXPECTED_APPLE_APP_ID}, the app's numeric Apple ID`)
  )

  // Key ID and issuer ID are identifiers App Store Connect displays openly, not secrets.
  const keyId = value("APPLE_IAP_KEY_ID")
  out.push(
    !keyId
      ? check("APPLE_IAP_KEY_ID", "missing", "not set")
      : /^[A-Z0-9]{10}$/.test(keyId)
        ? check("APPLE_IAP_KEY_ID", "ok", keyId)
        : check("APPLE_IAP_KEY_ID", "wrong", `not a 10-character Apple key ID (${keyId.length} characters)`)
  )

  const issuerId = value("APPLE_IAP_ISSUER_ID")
  out.push(
    !issuerId
      ? check("APPLE_IAP_ISSUER_ID", "missing", "not set")
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuerId)
        ? check("APPLE_IAP_ISSUER_ID", "ok", issuerId)
        : check("APPLE_IAP_ISSUER_ID", "wrong", `not a UUID (${issuerId.length} characters)`)
  )

  const privateKey = value("APPLE_IAP_PRIVATE_KEY").replace(/\\n/g, "\n")
  if (!privateKey) {
    out.push(check("APPLE_IAP_PRIVATE_KEY", "missing", "not set"))
  } else {
    try {
      const key = createPrivateKey(privateKey)
      const curve = key.asymmetricKeyDetails?.namedCurve
      out.push(
        key.asymmetricKeyType === "ec" && curve === "prime256v1"
          ? check("APPLE_IAP_PRIVATE_KEY", "ok", "parses as an EC P-256 private key (the .p8 format Apple issues)")
          : check("APPLE_IAP_PRIVATE_KEY", "wrong", `parses, but as ${key.asymmetricKeyType ?? "unknown"} ${curve ?? ""} — Apple keys are EC P-256`)
      )
    } catch {
      out.push(
        check(
          "APPLE_IAP_PRIVATE_KEY",
          "wrong",
          "does not parse as a private key — paste the whole .p8 file, BEGIN/END lines included"
        )
      )
    }
  }

  const certsRaw = value("APPLE_IAP_ROOT_CERTIFICATES_BASE64")
  if (!certsRaw) {
    out.push(check("APPLE_IAP_ROOT_CERTIFICATES_BASE64", "missing", "not set"))
  } else {
    const names: string[] = []
    const problems: string[] = []
    certsRaw.split(",").forEach((part, i) => {
      try {
        const cert = new X509Certificate(Buffer.from(part.trim(), "base64"))
        const expired = Date.parse(cert.validTo) < Date.now()
        names.push(`${commonName(cert.subject)} (valid to ${cert.validTo}${expired ? " — EXPIRED" : ""})`)
        if (expired) problems.push(`certificate ${i + 1} has expired`)
      } catch {
        problems.push(`certificate ${i + 1} is not a base64-encoded DER certificate`)
      }
    })
    if (!names.some((n) => n.startsWith(APPLE_JWS_ROOT_CN))) {
      problems.push(`none is "${APPLE_JWS_ROOT_CN}", the root Apple signs StoreKit 2 and V2 notifications with`)
    }
    out.push(
      check(
        "APPLE_IAP_ROOT_CERTIFICATES_BASE64",
        problems.length ? "wrong" : "ok",
        [names.length ? `certificates: ${names.join("; ")}` : "no readable certificates", ...problems].join(" — ")
      )
    )
  }

  return out
}

export type TestNotificationResult = {
  environment: "sandbox" | "production"
  requested: boolean
  /** Apple accepted our signed API call: the key, key ID, issuer ID and bundle ID match. */
  error?: string
  sendAttempts: Array<{ at: string | null; result: string }>
  /** The notification Apple sent passed our own verifier (root chain, bundle, app Apple ID). */
  verified: boolean | null
  verifyError?: string
}

/**
 * Asks Apple to send a TEST notification to the URL configured in App Store Connect, then reads
 * back Apple's own record of delivering it. Exercises the whole path: Apple authenticates our key,
 * signs a V2 notification, POSTs it to /api/monetization/apple/notifications, and records the HTTP
 * outcome; we then verify the same signed payload with the production verifier.
 */
export async function sendAppleTestNotification(
  target: "sandbox" | "production",
  { waitMs = 15_000 }: { waitMs?: number } = {}
): Promise<TestNotificationResult> {
  const environment = target === "production" ? Environment.PRODUCTION : Environment.SANDBOX
  const result: TestNotificationResult = { environment: target, requested: false, sendAttempts: [], verified: null }
  const client = appleServerApiClient(environment)

  let token: string | undefined
  try {
    token = (await client.requestTestNotification()).testNotificationToken
    result.requested = Boolean(token)
  } catch (error) {
    result.error = describeAppleError(error)
    return result
  }
  if (!token) {
    result.error = "Apple returned no test notification token"
    return result
  }

  const deadline = Date.now() + waitMs
  let signedPayload: string | undefined
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    try {
      const status = await client.getTestNotificationStatus(token)
      signedPayload = status.signedPayload
      result.sendAttempts = (status.sendAttempts ?? []).map((a) => ({
        at: a.attemptDate ? new Date(a.attemptDate).toISOString() : null,
        result: String(a.sendAttemptResult ?? "unknown"),
      }))
      if (result.sendAttempts.length) break
    } catch (error) {
      // 404 until Apple has recorded an attempt; keep waiting.
      result.error = describeAppleError(error)
    }
  }
  if (result.sendAttempts.length) delete result.error

  if (signedPayload) {
    try {
      const { payload } = await verifyAppleNotification(signedPayload)
      result.verified = payload.notificationType === "TEST"
      if (!result.verified) result.verifyError = `unexpected notification type ${payload.notificationType}`
    } catch (error) {
      result.verified = false
      // verifyAppleNotification wraps the library's VerificationException; its `status` is what
      // separates a bad root certificate (INVALID_CHAIN…) from a wrong bundle or app ID.
      const cause = (error as { cause?: { status?: unknown } })?.cause
      const status = cause && cause.status !== undefined ? ` (verification status ${String(cause.status)})` : ""
      result.verifyError = (error instanceof Error ? error.message : String(error)) + status
    }
  }
  return result
}

/** Apple API errors carry an HTTP status and an Apple error code; nothing secret. */
function describeAppleError(error: unknown): string {
  const e = error as { httpStatusCode?: number; apiError?: number; errorMessage?: string; message?: string }
  const parts = [
    e.httpStatusCode ? `HTTP ${e.httpStatusCode}` : null,
    e.apiError ? `Apple error ${e.apiError}` : null,
    e.errorMessage ?? e.message ?? null,
  ].filter(Boolean)
  return parts.join(" — ") || "Apple request failed"
}
