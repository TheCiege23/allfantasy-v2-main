import { describe, expect, it } from "vitest"
import {
  getWorldCupOriginOpsStatus,
  getWorldCupProviderOpsStatus,
  isWorldCupBestThirdMappingConfigured,
} from "@/lib/world-cup/worldCupOperationsReadiness"

describe("World Cup operations readiness helpers", () => {
  it("detects configured API-Football provider without exposing keys", () => {
    const status = getWorldCupProviderOpsStatus({
      WORLD_CUP_DATA_PROVIDER: "apifootball",
      API_SPORTS_KEY: "secret-value",
    } as NodeJS.ProcessEnv)

    expect(status).toEqual({
      name: "apifootball",
      configured: true,
      apiKeyPresent: true,
    })
    expect(JSON.stringify(status)).not.toContain("secret-value")
  })

  it("does not treat mock provider as production configured", () => {
    expect(getWorldCupProviderOpsStatus({ WORLD_CUP_DATA_PROVIDER: "mock" } as NodeJS.ProcessEnv)).toEqual({
      name: "mock",
      configured: false,
      apiKeyPresent: false,
    })
  })

  it("rejects localhost production origins", () => {
    const status = getWorldCupOriginOpsStatus({
      NEXTAUTH_URL: "http://localhost:3010",
      NEXT_PUBLIC_APP_URL: "http://localhost:3010",
      APP_URL: "http://localhost:3010",
    } as NodeJS.ProcessEnv)

    expect(status.productionSafe).toBe(false)
  })

  it("accepts aligned HTTPS production origins", () => {
    const status = getWorldCupOriginOpsStatus({
      NEXTAUTH_URL: "https://www.allfantasy.ai",
      NEXT_PUBLIC_APP_URL: "https://www.allfantasy.ai",
      APP_URL: "https://www.allfantasy.ai",
      PUBLIC_SITE_URL: "https://www.allfantasy.ai",
    } as NodeJS.ProcessEnv)

    expect(status.productionSafe).toBe(true)
  })

  it("requires explicit best-third mapping confirmation", () => {
    expect(isWorldCupBestThirdMappingConfigured({ WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED: "false" } as NodeJS.ProcessEnv)).toBe(false)
    expect(isWorldCupBestThirdMappingConfigured({ WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED: "true" } as NodeJS.ProcessEnv)).toBe(true)
  })
})
