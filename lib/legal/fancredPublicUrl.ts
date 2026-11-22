/** Default FanCred destination for league dues & payouts (override with `NEXT_PUBLIC_FANCRED_URL`). */
const DEFAULT_FANCRED_APP_URL = "https://fancred.app"

export function getFanCredPublicUrl(): string {
  const env =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_FANCRED_URL
      ? process.env.NEXT_PUBLIC_FANCRED_URL.trim()
      : ""
  return env || DEFAULT_FANCRED_APP_URL
}
