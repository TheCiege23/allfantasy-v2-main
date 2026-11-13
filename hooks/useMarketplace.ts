"use client"

import { useEffect, useCallback, useState } from "react"

export interface MarketplaceItemRow {
  itemId: string
  itemName: string
  description: string | null
  price: number
  cosmeticCategory: string
  cosmeticCategoryLabel: string
  sportRestriction: string | null
}

export interface WalletRow {
  managerId: string
  currencyBalance: number
  earnedLifetime: number
  spentLifetime: number
}

export interface InventoryItemRow {
  itemId: string
  itemName: string
  cosmeticCategory: string
  cosmeticCategoryLabel: string
  count: number
}

interface ResolvedCosmeticRow {
  category: string
  itemId: string | null
  itemName: string | null
}

export function useResolvedCosmetics(enabled: boolean) {
  const [cosmetics, setCosmetics] = useState<ResolvedCosmeticRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCosmetics([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/marketplace/cosmetics", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? "Failed to load cosmetics")
        setCosmetics([])
        return
      }
      setCosmetics(Array.isArray(data?.cosmetics) ? data.cosmetics : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cosmetics")
      setCosmetics([])
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { cosmetics, loading, error, refresh }
}
