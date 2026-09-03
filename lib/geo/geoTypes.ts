export interface GeoDetectionResult {
  stateCode: string | null
  country: string | null
  isVpnOrProxy: boolean
  /**
   * Which edge placed this request. `cloudflare_headers` was added when
   * production moved to Railway behind Cloudflare on 2026-09-02; `vercel_headers`
   * is retained so preview deployments still report accurately.
   */
  detectionSource: "cloudflare_headers" | "vercel_headers" | "ip_api" | "unknown"
  rawIp: string | null
}
