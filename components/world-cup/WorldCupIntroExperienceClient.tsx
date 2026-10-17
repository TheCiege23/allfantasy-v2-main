"use client"

import dynamicImport from "next/dynamic"

/**
 * Client-only mount of the World Cup intro. Next 15 refuses `ssr: false` in a
 * Server Component (a build error, not a warning), so the dynamic() call lives
 * here, inside a client boundary, and the page imports this instead.
 */
const WorldCupIntroExperience = dynamicImport(
  () => import("@/components/world-cup/WorldCupIntroExperience"),
  { ssr: false }
)

export default function WorldCupIntroExperienceClient() {
  return <WorldCupIntroExperience />
}
