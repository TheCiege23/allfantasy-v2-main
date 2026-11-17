"use client"

import { useEffect, useMemo } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { buildMetaEventPayload } from "@/lib/meta-events"
import { ensureMetaPixel, mirrorMetaEventServerSide, trackMetaEventAndMirror } from "@/lib/meta-client"

function resolveAiChimmyContent(pathname: string): { name: string; category: string } | null {
  if (pathname === "/ai-chat" || pathname.startsWith("/ai-chat/")) {
    return { name: "Chimmy Chat", category: "Chimmy" }
  }
  if (pathname === "/ai" || pathname.startsWith("/ai/")) {
    return { name: "Chimmy", category: "Chimmy" }
  }
  if (pathname.toLowerCase().includes("/chimmy")) {
    return { name: "Chimmy", category: "Chimmy" }
  }
  return null
}

export function MetaPixelPageViewTracker({ pixelId }: { pixelId: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeKey = useMemo(() => {
    if (!pathname) return ""
    const qs = searchParams?.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    ensureMetaPixel(pixelId)
  }, [pixelId])

  useEffect(() => {
    if (!pathname || typeof window === "undefined") return
    const sourceUrl = window.location.href
    const title = document.title || pathname
    const pageViewCustomData = {
      content_name: title,
      content_category: "Page",
      page_path: pathname,
    }

    if (
      window.__afMetaBasePageViewEventId &&
      window.__afMetaBasePageViewFired &&
      !window.__afMetaBasePageViewMirrorKey
    ) {
      const event = buildMetaEventPayload("PageView", pageViewCustomData, {
        eventId: window.__afMetaBasePageViewEventId,
        sourceId: routeKey,
      })
      window.__afMetaBasePageViewMirrorKey = routeKey
      void mirrorMetaEventServerSide(event, { sourceUrl })
    } else {
      trackMetaEventAndMirror("PageView", pageViewCustomData, { sourceId: routeKey, sourceUrl })
    }

    const chimmy = resolveAiChimmyContent(pathname)
    if (chimmy) {
      trackMetaEventAndMirror(
        "ViewContent",
        {
          content_name: chimmy.name,
          content_category: chimmy.category,
          page_path: pathname,
        },
        { sourceId: `chimmy:${routeKey}`, sourceUrl }
      )
    }
  }, [pathname, routeKey])

  return null
}
