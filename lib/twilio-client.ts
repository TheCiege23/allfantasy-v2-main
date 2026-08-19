import "server-only"
import twilio from "twilio"

let twilioClient: ReturnType<typeof twilio> | undefined

/**
 * Twilio SID type prefixes. Every Twilio SID encodes its own type in the first two characters, and
 * mixing them up is silent: an `SK` (API Key) pasted into TWILIO_ACCOUNT_SID leaves every env var
 * "present", so a presence-only health check reports green while the client cannot even be built.
 * That exact swap shipped to production and stayed invisible — hence these are checked, not assumed.
 */
const SID_PREFIX = {
  account: 'AC',
  apiKey: 'SK',
  verifyService: 'VA',
} as const

function startsWithPrefix(value: string | undefined, prefix: string): boolean {
  return Boolean(value?.trim().startsWith(prefix))
}

export type TwilioRuntimeStatus = {
  hasAccountSid: boolean
  hasAuthToken: boolean
  hasApiKey: boolean
  hasApiSecret: boolean
  hasFromNumber: boolean
  hasVerifyServiceSid: boolean
  /** TWILIO_ACCOUNT_SID is present AND actually an Account SID (`AC…`), not some other SID type. */
  accountSidWellFormed: boolean
  /** TWILIO_API_KEY is present AND actually an API Key SID (`SK…`). */
  apiKeyWellFormed: boolean
  /** TWILIO_VERIFY_SERVICE_SID is present AND actually a Verify Service SID (`VA…`). */
  verifyServiceSidWellFormed: boolean
  canUseAuthTokenMode: boolean
  canUseApiKeyMode: boolean
  canUseRawSms: boolean
  canUseVerify: boolean
}

/** Result of a live, read-only auth probe against the Twilio API. */
export type TwilioAuthProbe = {
  ok: boolean
  mode: 'api_key' | 'auth_token' | 'none'
  /** Present when ok === false. */
  reason?: 'not_configured' | 'client_init_failed' | 'auth_failed'
  error?: SanitizedTwilioError
}

export type SanitizedTwilioError = {
  code?: string | number
  status?: string | number
  message: string
  moreInfo?: string
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(
      `${name} is not set. Add it to your local environment and Vercel project settings.`
    )
  }

  return value
}

export function getTwilioRuntimeStatus(): TwilioRuntimeStatus {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const apiKey = process.env.TWILIO_API_KEY?.trim()
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim()

  const hasAccountSid = Boolean(accountSid)
  const hasAuthToken = Boolean(process.env.TWILIO_AUTH_TOKEN?.trim())
  const hasApiKey = Boolean(apiKey)
  const hasApiSecret = Boolean(process.env.TWILIO_API_SECRET?.trim())
  const hasFromNumber = Boolean(process.env.TWILIO_PHONE_NUMBER?.trim())
  const hasVerifyServiceSid = Boolean(verifyServiceSid)

  // Presence is not validity. These gate on the SID actually being the type the var name claims,
  // so a swapped SID surfaces as "not configured" instead of a green light over a broken client.
  const accountSidWellFormed = startsWithPrefix(accountSid, SID_PREFIX.account)
  const apiKeyWellFormed = startsWithPrefix(apiKey, SID_PREFIX.apiKey)
  const verifyServiceSidWellFormed = startsWithPrefix(verifyServiceSid, SID_PREFIX.verifyService)

  const canUseAuthTokenMode = accountSidWellFormed && hasAuthToken
  const canUseApiKeyMode = accountSidWellFormed && apiKeyWellFormed && hasApiSecret
  const canAuthenticate = canUseAuthTokenMode || canUseApiKeyMode

  return {
    hasAccountSid,
    hasAuthToken,
    hasApiKey,
    hasApiSecret,
    hasFromNumber,
    hasVerifyServiceSid,
    accountSidWellFormed,
    apiKeyWellFormed,
    verifyServiceSidWellFormed,
    canUseAuthTokenMode,
    canUseApiKeyMode,
    canUseRawSms: canAuthenticate && hasFromNumber,
    canUseVerify: canAuthenticate && verifyServiceSidWellFormed,
  }
}

/**
 * Live, read-only auth probe: builds the client and fetches the account record.
 *
 * This exists because config-shape checks cannot detect a *credential* that is well-formed but not
 * authorized. An invalid API key builds a client perfectly happily and only fails when a request is
 * actually made — so every static check reported healthy while real sends returned
 * `Authorization Error: actor doesn't have any assertions`. Fetching the account is the cheapest
 * request that proves the credentials are accepted: it sends no SMS and costs nothing.
 */
export async function verifyTwilioAuth(): Promise<TwilioAuthProbe> {
  const status = getTwilioRuntimeStatus()
  const mode: TwilioAuthProbe['mode'] = status.canUseApiKeyMode
    ? 'api_key'
    : status.canUseAuthTokenMode
      ? 'auth_token'
      : 'none'

  if (mode === 'none') return { ok: false, mode, reason: 'not_configured' }

  let client: ReturnType<typeof twilio>
  try {
    client = getTwilioClient()
  } catch (error) {
    return { ok: false, mode, reason: 'client_init_failed', error: sanitizeTwilioError(error) }
  }

  try {
    await client.api.accounts(process.env.TWILIO_ACCOUNT_SID!.trim()).fetch()
    return { ok: true, mode }
  } catch (error) {
    return { ok: false, mode, reason: 'auth_failed', error: sanitizeTwilioError(error) }
  }
}

export function sanitizeTwilioError(error: unknown): SanitizedTwilioError {
  if (error && typeof error === "object") {
    const record = error as {
      code?: unknown
      status?: unknown
      statusCode?: unknown
      message?: unknown
      moreInfo?: unknown
      more_info?: unknown
    }

    return {
      code:
        typeof record.code === "string" || typeof record.code === "number"
          ? record.code
          : undefined,
      status:
        typeof record.status === "string" || typeof record.status === "number"
          ? record.status
          : typeof record.statusCode === "string" || typeof record.statusCode === "number"
            ? record.statusCode
            : undefined,
      message:
        typeof record.message === "string" && record.message.trim()
          ? record.message
          : "Twilio request failed.",
      moreInfo:
        typeof record.moreInfo === "string"
          ? record.moreInfo
          : typeof record.more_info === "string"
            ? record.more_info
            : undefined,
    }
  }

  return {
    message: error instanceof Error ? error.message : "Twilio request failed.",
  }
}

export function getTwilioClient() {
  if (twilioClient) {
    return twilioClient
  }

  const accountSid = getRequiredEnv("TWILIO_ACCOUNT_SID")
  const apiKey = process.env.TWILIO_API_KEY?.trim()
  const apiKeySecret = process.env.TWILIO_API_SECRET?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()

  // Fail with the actual diagnosis. Twilio's own error ("accountSid must start with AC") is correct
  // but doesn't say which var to move the value to, which is the whole question when an SK ends up
  // in TWILIO_ACCOUNT_SID.
  if (!accountSid.startsWith(SID_PREFIX.account)) {
    throw new Error(
      `TWILIO_ACCOUNT_SID must be an Account SID starting with "${SID_PREFIX.account}" but starts ` +
        `with "${accountSid.slice(0, 2)}". An "${SID_PREFIX.apiKey}" value is an API Key SID — it ` +
        `belongs in TWILIO_API_KEY, not TWILIO_ACCOUNT_SID.`
    )
  }

  if (apiKey && apiKeySecret) {
    twilioClient = twilio(apiKey, apiKeySecret, { accountSid })
    return twilioClient
  }

  if (authToken) {
    twilioClient = twilio(accountSid, authToken)
    return twilioClient
  }

  throw new Error(
    "Twilio credentials missing. Set TWILIO_API_KEY + TWILIO_API_SECRET, or TWILIO_AUTH_TOKEN."
  )
}

export function getTwilioFromPhoneNumber() {
  return getRequiredEnv("TWILIO_PHONE_NUMBER")
}

/**
 * Send an SMS. Returns false if Twilio is not configured or send fails (no throw).
 */
export async function sendSms(toPhone: string, body: string): Promise<boolean> {
  const status = getTwilioRuntimeStatus()
  const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim()
  if (!status.canUseRawSms || !fromNumber) {
    console.error("[twilio] SMS send skipped", {
      reason: "raw_sms_not_configured",
      status,
    })
    return false
  }

  try {
    const client = getTwilioClient()
    await client.messages.create({
      from: fromNumber,
      to: toPhone,
      body: body.slice(0, 1600),
    })
    return true
  } catch (error) {
    console.error("[twilio] SMS send failed", sanitizeTwilioError(error))
    return false
  }
}
