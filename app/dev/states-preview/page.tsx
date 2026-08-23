/**
 * Handoff 16c — dev-only preview of the shared empty / loading / error vocabulary.
 *
 * These are primitives rather than a screen, so they otherwise only appear inside
 * authenticated surfaces (settings, notifications, the search overlay) where a
 * reviewer cannot see the whole set side by side. This route mounts every variant
 * with synthetic data so the handoff can be checked against the mock in one look —
 * the same purpose and the same guard as /dev/d6-preview.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it.
 */

import { notFound } from "next/navigation"
import { StatesPreviewClient } from "./StatesPreviewClient"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "State vocabulary preview",
  robots: { index: false, follow: false },
}

export default function StatesPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <StatesPreviewClient />
}
