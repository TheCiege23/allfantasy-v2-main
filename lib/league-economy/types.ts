/**
 * League Economy + Marketplace — cosmetic-only economy. Never affects competitive balance.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export const COSMETIC_CATEGORIES = [
  'team_upgrade',
  'profile_frame',
  'league_trophy',
  'draft_board_skin',
  'avatar_item',
  'historical_banner',
] as const

export type CosmeticCategory = (typeof COSMETIC_CATEGORIES)[number]

export const COSMETIC_CATEGORY_LABELS: Record<CosmeticCategory, string> = {
  team_upgrade: 'Team Upgrade',
  profile_frame: 'Profile Frame',
  league_trophy: 'League Trophy',
  draft_board_skin: 'Draft Board Skin',
  avatar_item: 'Avatar Item',
  historical_banner: 'Historical Banner',
}

export const ITEM_TYPES = [
  'cosmetic_team_upgrade',
  'cosmetic_profile_frame',
  'cosmetic_league_trophy',
  'cosmetic_draft_skin',
  'cosmetic_avatar',
  'cosmetic_banner',
] as const

export interface MarketplaceItemView {
  itemId: string
  itemType: string
  itemName: string
  description: string | null
  price: number
  sportRestriction: string | null
  cosmeticCategory: string
  cosmeticCategoryLabel: string
  createdAt: Date
}

export interface ManagerWalletView {
  managerId: string
  currencyBalance: number
  earnedLifetime: number
  spentLifetime: number
  updatedAt: Date
}

export interface PurchaseRecordView {
  purchaseId: string
  managerId: string
  itemId: string
  itemName?: string
  price: number
  createdAt: Date
}

export interface InventoryItemView {
  itemId: string
  itemName: string
  cosmeticCategory: string
  cosmeticCategoryLabel: string
  count: number
}
