/**
 * The page half of Face ID passkeys INSIDE the iOS app (ios-app/ PasskeyHandler.swift). The app's
 * WKWebView does not reach Face ID through the browser's WebAuthn API, so lib/auth/passkey-client
 * asks the app instead — same protocol as lib/auth/apple-native-client: post to
 * `messageHandlers["passkey"]`, the answer arrives as an `allfantasy:passkey` event matched by
 * `requestId`.
 *
 * The converters below are PURE: they turn the server's WebAuthn options into the app's message,
 * and the app's raw (base64url) answer into the exact JSON @simplewebauthn/server verifies — the
 * same JSON the browser path produces, so the server cannot tell the two apart and checks both the
 * same way (lib/auth/passkeys.ts).
 */

type Handler = { postMessage: (message: Record<string, string>) => void }

type RegistrationOptions = { challenge: string; rp: { id?: string }; user: { id: string; name: string } }
type AuthenticationOptions = { challenge: string; rpId?: string }

export type NativeRegistration = {
  requestId: string
  kind?: 'registration'
  credentialId?: string
  clientDataJSON?: string
  attestationObject?: string
  cancelled?: boolean
  error?: string
}

export type NativeAssertion = {
  requestId: string
  kind?: 'assertion'
  credentialId?: string
  clientDataJSON?: string
  authenticatorData?: string
  signature?: string
  userHandle?: string
  cancelled?: boolean
  error?: string
}

function handler(): Handler | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as typeof window & { webkit?: { messageHandlers?: { passkey?: Handler } } }).webkit?.messageHandlers?.passkey
}

/** True only in an iOS app build that ships passkeys (the `passkeys` build input). */
export function hasNativePasskeys(): boolean {
  return Boolean(handler())
}

export function registrationMessage(options: RegistrationOptions): Record<string, string> {
  return {
    action: 'register',
    challenge: options.challenge,
    rpId: options.rp.id ?? '',
    userId: options.user.id,
    userName: options.user.name,
  }
}

export function authenticationMessage(options: AuthenticationOptions): Record<string, string> {
  return { action: 'authenticate', challenge: options.challenge, rpId: options.rpId ?? '' }
}

/** The app's registration answer as RegistrationResponseJSON, or null if it is incomplete. */
export function toRegistrationResponseJSON(answer: NativeRegistration) {
  if (!answer.credentialId || !answer.clientDataJSON || !answer.attestationObject) return null
  return {
    id: answer.credentialId,
    rawId: answer.credentialId,
    type: 'public-key' as const,
    response: {
      clientDataJSON: answer.clientDataJSON,
      attestationObject: answer.attestationObject,
      // A passkey made on an iPhone lives in iCloud Keychain: this device, and others by QR.
      transports: ['internal', 'hybrid'],
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform' as const,
  }
}

/** The app's sign-in answer as AuthenticationResponseJSON, or null if it is incomplete. */
export function toAuthenticationResponseJSON(answer: NativeAssertion) {
  if (!answer.credentialId || !answer.clientDataJSON || !answer.authenticatorData || !answer.signature) return null
  return {
    id: answer.credentialId,
    rawId: answer.credentialId,
    type: 'public-key' as const,
    response: {
      clientDataJSON: answer.clientDataJSON,
      authenticatorData: answer.authenticatorData,
      signature: answer.signature,
      ...(answer.userHandle ? { userHandle: answer.userHandle } : {}),
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform' as const,
  }
}

/** Posts one request to the app and waits for its answer (2 minutes: Face ID is a sheet the person may sit on). */
export function askNativePasskey<T extends { requestId: string }>(message: Record<string, string>, timeoutMs = 120_000): Promise<T> {
  const bridge = handler()
  if (!bridge) return Promise.reject(new Error('Update the AllFantasy app to use Face ID.'))
  const requestId = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('allfantasy:passkey', listener)
      reject(new Error('Face ID did not respond. Please try again.'))
    }, timeoutMs)
    function listener(event: Event) {
      const detail = (event as CustomEvent<T>).detail
      if (detail?.requestId !== requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener('allfantasy:passkey', listener)
      resolve(detail)
    }
    window.addEventListener('allfantasy:passkey', listener)
    bridge.postMessage({ ...message, requestId })
  })
}
