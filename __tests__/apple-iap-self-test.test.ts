// @vitest-environment node
import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  checkAppleIapConfig,
  EXPECTED_APPLE_APP_ID,
  EXPECTED_APPLE_BUNDLE_ID,
} from "@/lib/monetization/appleIapSelfTest"

/*
 * Self-signed TEST certificates made with openssl — not Apple's. Only their names and dates matter
 * here: "Apple Root CA - G3" valid to 2036, an unrelated root, and an expired "Apple Root CA - G3".
 */
const CERT_G3 =
  "MIIBvTCCAWOgAwIBAgIUMMDoYDE74L7J7zDr4HCIpm+n6lgwCgYIKoZIzj0EAwIwNDEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMRUwEwYDVQQKDAxUZXN0IEZpeHR1cmUwHhcNMjYxMDA2MDEzNTU4WhcNMzYxMDAzMDEzNTU4WjA0MRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxFTATBgNVBAoMDFRlc3QgRml4dHVyZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABLZMat4sDTElXSVS76l7TmiGKnjI7h9JzOYq9BKzNgxrZtQ/F1yjCd/SVhie1AOgUEZ+HbzH+DdnAaFsf4qLVWajUzBRMB0GA1UdDgQWBBQxQRg9py0WLLxNg6vB/PZXI/ETHDAfBgNVHSMEGDAWgBQxQRg9py0WLLxNg6vB/PZXI/ETHDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQDmxjKNl6O8+7fxdyTqbhUzQMK/HumcK1wtm3iXylRn+QIgT36BEVMhoQnl9f8l62WO8r8SdY3WGdV9YF4EsVkHB1I="
const CERT_OTHER =
  "MIIBtjCCAV2gAwIBAgIUG2uiUQGEP/FqF+dNJj0JSgG8mFowCgYIKoZIzj0EAwIwMTEYMBYGA1UEAwwPU29tZSBPdGhlciBSb290MRUwEwYDVQQKDAxUZXN0IEZpeHR1cmUwHhcNMjYxMDA2MDEzNTU4WhcNMzYxMDAzMDEzNTU4WjAxMRgwFgYDVQQDDA9Tb21lIE90aGVyIFJvb3QxFTATBgNVBAoMDFRlc3QgRml4dHVyZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABLAfqtHNkSsa9JSR0CKn6NkJjD5ilYoWDs87PptJHdzL58kzVEW1o1AX1S7XPGbJvFhnlweI7imWhaYyoelG66mjUzBRMB0GA1UdDgQWBBROeeWkzAgYKkLB6jnySdUynCHScTAfBgNVHSMEGDAWgBROeeWkzAgYKkLB6jnySdUynCHScTAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIDvA2HKJTO9Hl3ILkqNXG7WTTSKyCMKn+YZ16G/rQT8nAiATXk2lAJDhFnTq/xBhrDzKcZBWRzYl8gx6rPPzOTrVyQ=="
const CERT_G3_EXPIRED =
  "MIIBzTCCAXOgAwIBAgIUJagV/4lT3NZXUuhE6Vmy3bO1HwYwCgYIKoZIzj0EAwIwPDEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMR0wGwYDVQQKDBRFeHBpcmVkIFRlc3QgRml4dHVyZTAeFw0yMDAxMDEwMDAwMDBaFw0yMTAxMDEwMDAwMDBaMDwxGzAZBgNVBAMMEkFwcGxlIFJvb3QgQ0EgLSBHMzEdMBsGA1UECgwURXhwaXJlZCBUZXN0IEZpeHR1cmUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQAHr0NEZb8rmDjsd5+Vc2DgX3R138cNH9Q/KBALkn1eSu+gMwYFr0AL1UqxMk36EuAjnT038mXSYA4ztzJlkEso1MwUTAdBgNVHQ4EFgQUZ8bstsGWKaZ44QmJhdBvX90XQwwwHwYDVR0jBBgwFoAUZ8bstsGWKaZ44QmJhdBvX90XQwwwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBwHLEVQU9svr2b/xNZajCXlz/1/9wpOpm+5Sg22mc+LgIhAPW9+w2valjdUKkqNUoSeTAZXPozBajStipzYGeFo/b2"

// Generated per run: no key text lives in this public repo.
const EC_KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString()
const RSA_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString()

const GOOD = {
  APPLE_IAP_BUNDLE_ID: EXPECTED_APPLE_BUNDLE_ID,
  APPLE_IAP_APP_APPLE_ID: EXPECTED_APPLE_APP_ID,
  APPLE_IAP_KEY_ID: "ABC123DEFG",
  APPLE_IAP_ISSUER_ID: "57246542-96fe-1a63-e053-0824d011072a",
  APPLE_IAP_PRIVATE_KEY: EC_KEY,
  APPLE_IAP_ROOT_CERTIFICATES_BASE64: `${CERT_OTHER},${CERT_G3}`,
}

const statusOf = (env: Record<string, string | undefined>) =>
  Object.fromEntries(checkAppleIapConfig(env).map((c) => [c.name, c.status]))
const detailOf = (env: Record<string, string | undefined>, name: string) =>
  checkAppleIapConfig(env).find((c) => c.name === name)?.detail ?? ""

describe("checkAppleIapConfig", () => {
  it("passes a correct configuration", () => {
    expect(Object.values(statusOf(GOOD))).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"])
    expect(detailOf(GOOD, "APPLE_IAP_ROOT_CERTIFICATES_BASE64")).toContain("Apple Root CA - G3")
  })

  it("accepts a private key stored on one line with literal \\n escapes (how Railway often holds it)", () => {
    const env = { ...GOOD, APPLE_IAP_PRIVATE_KEY: EC_KEY.replace(/\n/g, "\\n") }
    expect(statusOf(env).APPLE_IAP_PRIVATE_KEY).toBe("ok")
  })

  it("rejects the PWABuilder bundle ID the old setup doc named", () => {
    expect(statusOf({ ...GOOD, APPLE_IAP_BUNDLE_ID: "ai.allfantasy.www" }).APPLE_IAP_BUNDLE_ID).toBe("wrong")
  })

  it("rejects another app's Apple ID", () => {
    expect(statusOf({ ...GOOD, APPLE_IAP_APP_APPLE_ID: "1234567890" }).APPLE_IAP_APP_APPLE_ID).toBe("wrong")
  })

  it("rejects a key that is not Apple's EC P-256, and text that is not a key at all", () => {
    expect(statusOf({ ...GOOD, APPLE_IAP_PRIVATE_KEY: RSA_KEY }).APPLE_IAP_PRIVATE_KEY).toBe("wrong")
    expect(statusOf({ ...GOOD, APPLE_IAP_PRIVATE_KEY: "MIGTAgEAMBMG-truncated" }).APPLE_IAP_PRIVATE_KEY).toBe("wrong")
  })

  it("rejects root certificates without Apple Root CA - G3, unreadable ones, and expired ones", () => {
    expect(statusOf({ ...GOOD, APPLE_IAP_ROOT_CERTIFICATES_BASE64: CERT_OTHER }).APPLE_IAP_ROOT_CERTIFICATES_BASE64).toBe("wrong")
    expect(
      statusOf({ ...GOOD, APPLE_IAP_ROOT_CERTIFICATES_BASE64: `${CERT_G3},not-a-certificate` })
        .APPLE_IAP_ROOT_CERTIFICATES_BASE64
    ).toBe("wrong")
    const expired = { ...GOOD, APPLE_IAP_ROOT_CERTIFICATES_BASE64: CERT_G3_EXPIRED }
    expect(statusOf(expired).APPLE_IAP_ROOT_CERTIFICATES_BASE64).toBe("wrong")
    expect(detailOf(expired, "APPLE_IAP_ROOT_CERTIFICATES_BASE64")).toContain("EXPIRED")
  })

  it("rejects malformed key and issuer IDs, and reports every missing variable", () => {
    const s = statusOf({ ...GOOD, APPLE_IAP_KEY_ID: "abc", APPLE_IAP_ISSUER_ID: "not-a-uuid" })
    expect(s.APPLE_IAP_KEY_ID).toBe("wrong")
    expect(s.APPLE_IAP_ISSUER_ID).toBe("wrong")
    expect(Object.values(statusOf({}))).toEqual(Array(6).fill("missing"))
  })

  it("never echoes the private key or a certificate body", () => {
    const shown = JSON.stringify(checkAppleIapConfig(GOOD))
    const keyBody = EC_KEY.split("\n").filter((l) => l && !l.startsWith("-----")).join("")
    expect(shown).not.toContain(keyBody.slice(0, 24))
    expect(shown).not.toContain("PRIVATE KEY")
    expect(shown).not.toContain(CERT_G3.slice(0, 24))
    // …and the same holds when the key is wrong, where it is most tempting to show what was found.
    const shownWrong = JSON.stringify(checkAppleIapConfig({ ...GOOD, APPLE_IAP_PRIVATE_KEY: RSA_KEY }))
    expect(shownWrong).not.toContain("PRIVATE KEY")
  })
})
