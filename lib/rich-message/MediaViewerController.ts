import { getSafeMessageMediaUrl } from "./safeMedia"

export function resolveMediaViewerUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null
  return getSafeMessageMediaUrl(candidate)
}

