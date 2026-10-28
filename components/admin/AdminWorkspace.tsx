"use client"

import { useEffect, useState, type ReactNode } from "react"

export type AdminView = "overview" | "audience" | "revenue" | "operations" | "data"

const views: { id: AdminView; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "What needs attention right now" },
  { id: "audience", label: "People & growth", description: "Users, traffic, invitations, and email" },
  { id: "revenue", label: "Revenue", description: "Subscriptions, payments, and tokens" },
  { id: "operations", label: "Product operations", description: "Sports OS, Chimmy, and platform tools" },
  { id: "data", label: "Data & reliability", description: "Providers, freshness, sync, and readiness" },
]

const anchorViews: Record<string, AdminView> = {
  overview: "overview",
  growth: "audience",
  traffic: "audience",
  "user-search": "audience",
  "email-center": "audience",
  "social-campaigns": "audience",
  "beta-invites": "audience",
  "pipeline-freshness": "data",
  providers: "data",
  "provider-health": "data",
  "production-readiness": "data",
  crons: "data",
  env: "data",
  "sports-os": "operations",
  "ai-panels": "operations",
  "platform-os": "operations",
}

function viewFromHash(hash: string, fallback: AdminView): AdminView {
  const id = decodeURIComponent(hash.replace(/^#/, ""))
  if (id.startsWith("view-")) {
    const view = id.slice(5)
    if (views.some((item) => item.id === view)) return view as AdminView
  }
  return anchorViews[id] ?? fallback
}

export function AdminWorkspace({
  children,
  initialView = "overview",
}: {
  children: ReactNode
  initialView?: AdminView
}) {
  const [view, setView] = useState<AdminView>(initialView)
  const selected = views.find((item) => item.id === view) ?? views[0]

  useEffect(() => {
    const syncHash = () => {
      const next = viewFromHash(window.location.hash, initialView)
      setView(next)
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""))
      if (id && !id.startsWith("view-")) {
        const reveal = () => {
          const target = document.getElementById(id)
          let ancestor = target?.parentElement
          while (ancestor) {
            if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
            ancestor = ancestor.parentElement
          }
          target?.scrollIntoView?.({ block: "start" })
        }
        if (window.requestAnimationFrame) window.requestAnimationFrame(reveal)
        else window.setTimeout(reveal, 0)
      }
    }
    syncHash()
    window.addEventListener("hashchange", syncHash)
    return () => window.removeEventListener("hashchange", syncHash)
  }, [initialView])

  function selectView(next: AdminView) {
    setView(next)
    window.history.replaceState(null, "", "#view-" + next)
    document.getElementById("admin-workspace")?.scrollIntoView?.({ block: "start", behavior: "smooth" })
  }

  return (
    <div id="admin-workspace" className="af-cc-workspace" data-view={view}>
      <div className="af-cc-workspace-intro">
        <div>
          <p className="af-cc-eyebrow">Admin workspace</p>
          <h2>{selected.label}</h2>
          <p>{selected.description}</p>
        </div>
        <div className="af-cc-workspace-help">Choose an area to focus on. Detailed reports stay available inside each area.</div>
      </div>
      <nav className="af-cc-workspace-nav" aria-label="Admin areas">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={view === item.id}
            className={view === item.id ? "af-cc-workspace-link af-cc-workspace-link--active" : "af-cc-workspace-link"}
            onClick={() => selectView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {view === "overview" ? (
        <div className="af-cc-shortcuts" aria-label="Common admin tasks">
          <a href="#user-search">Find a user <span aria-hidden="true">→</span></a>
          <a href="#providers">Check providers <span aria-hidden="true">→</span></a>
          <a href="#production-readiness">Review readiness <span aria-hidden="true">→</span></a>
          <a href="#email-center">Open email center <span aria-hidden="true">→</span></a>
        </div>
      ) : null}
      <div className="af-cc-workspace-content">{children}</div>
    </div>
  )
}
