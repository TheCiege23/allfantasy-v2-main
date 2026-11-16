"use client"

import { useState } from "react"
import { Search } from "lucide-react"

interface DiscoverySearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
}

export function DiscoverySearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = "Search leagues, tournaments, or creators...",
}: DiscoverySearchBarProps) {
  const [focused, setFocused] = useState(false)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="relative flex-1 min-w-[200px] max-w-xl"
    >
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
        style={{ color: focused ? "var(--accent)" : "var(--muted)" }}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        data-testid="discovery-search-input"
        className="w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm transition-colors"
        style={{
          borderColor: focused ? "var(--accent)" : "var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
        }}
        aria-label="Search leagues"
      />
      <button
        type="submit"
        data-testid="discovery-search-submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2.5 text-sm font-medium touch-manipulation"
        style={{ background: "var(--accent)", color: "var(--bg)" }}
        aria-label="Search leagues"
      >
        Search
      </button>
    </form>
  )
}
