import { AppStoreServerAPIClient, Environment, SignedDataVerifier } from "@apple/app-store-server-library"
import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library"

type AppleEnvironment = Environment.PRODUCTION | Environment.SANDBOX

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for Apple in-app purchases`)
  return value
}

function rootCertificates(): Buffer[] {
  const encoded = required("APPLE_IAP_ROOT_CERTIFICATES_BASE64")
  const certificates = encoded.split(",").map((certificate) =>
    Buffer.from(certificate.trim(), "base64")
  )
  if (certificates.some((certificate) => certificate.length === 0)) {
    throw new Error("APPLE_IAP_ROOT_CERTIFICATES_BASE64 contains an empty certificate")
  }
  return certificates
}

function verifier(environment: AppleEnvironment): SignedDataVerifier {
  const appAppleId = Number(process.env.APPLE_IAP_APP_APPLE_ID)
  if (environment === Environment.PRODUCTION && (!Number.isSafeInteger(appAppleId) || appAppleId <= 0)) {
    throw new Error("APPLE_IAP_APP_APPLE_ID must be the App Store Connect numeric Apple ID")
  }
  return new SignedDataVerifier(
    rootCertificates(),
    true,
    environment,
    required("APPLE_IAP_BUNDLE_ID"),
    environment === Environment.PRODUCTION ? appAppleId : undefined
  )
}

// Apple signs sandbox and production purchases with the same certificate chain.
// The library validates the bundle ID, environment, signature, and production Apple ID.
export async function verifyAppleTransaction(
  signedTransactionInfo: string
): Promise<JWSTransactionDecodedPayload> {
  let lastError: unknown
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX] as const) {
    try {
      return await verifier(environment).verifyAndDecodeTransaction(signedTransactionInfo)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error("Apple transaction verification failed", { cause: lastError })
}

export async function getCurrentAppleTransaction(
  transactionId: string,
  environment: AppleEnvironment
): Promise<JWSTransactionDecodedPayload> {
  const client = new AppStoreServerAPIClient(
    required("APPLE_IAP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    required("APPLE_IAP_KEY_ID"),
    required("APPLE_IAP_ISSUER_ID"),
    required("APPLE_IAP_BUNDLE_ID"),
    environment
  )
  const response = await client.getTransactionInfo(transactionId)
  if (!response.signedTransactionInfo) throw new Error("Apple returned no signed transaction")
  return verifier(environment).verifyAndDecodeTransaction(response.signedTransactionInfo)
}

export async function verifyAppleNotification(
  signedPayload: string
): Promise<{ payload: ResponseBodyV2DecodedPayload; environment: AppleEnvironment }> {
  let lastError: unknown
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX] as const) {
    try {
      const payload = await verifier(environment).verifyAndDecodeNotification(signedPayload)
      return { payload, environment }
    } catch (error) {
      lastError = error
    }
  }
  throw new Error("Apple notification verification failed", { cause: lastError })
}

export function appleIapConfigured(): boolean {
  return Boolean(
    process.env.APPLE_IAP_BUNDLE_ID?.trim() &&
    process.env.APPLE_IAP_APP_APPLE_ID?.trim() &&
    process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64?.trim() &&
    process.env.APPLE_IAP_PRIVATE_KEY?.trim() &&
    process.env.APPLE_IAP_KEY_ID?.trim() &&
    process.env.APPLE_IAP_ISSUER_ID?.trim()
  )
}
