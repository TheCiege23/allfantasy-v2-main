type C2CSlotDef = { slot: string; position: string; side: 'campus' | 'canton' }

export const NFL_CFB_DEFAULTS = {
  campusStarterSlots: [
    { slot: 'CFB_QB', position: 'QB', side: 'campus' as const },
    { slot: 'CFB_RB1', position: 'RB', side: 'campus' as const },
    { slot: 'CFB_RB2', position: 'RB', side: 'campus' as const },
    { slot: 'CFB_WR1', position: 'WR', side: 'campus' as const },
    { slot: 'CFB_WR2', position: 'WR', side: 'campus' as const },
    { slot: 'CFB_WR3', position: 'WR', side: 'campus' as const },
    { slot: 'CFB_TE', position: 'TE', side: 'campus' as const },
    { slot: 'CFB_FLEX', position: 'FLEX', side: 'campus' as const },
  ] satisfies C2CSlotDef[],
  cantonStarterSlots: [
    { slot: 'NFL_QB', position: 'QB', side: 'canton' as const },
    { slot: 'NFL_RB1', position: 'RB', side: 'canton' as const },
    { slot: 'NFL_RB2', position: 'RB', side: 'canton' as const },
    { slot: 'NFL_WR1', position: 'WR', side: 'canton' as const },
    { slot: 'NFL_WR2', position: 'WR', side: 'canton' as const },
    { slot: 'NFL_WR3', position: 'WR', side: 'canton' as const },
    { slot: 'NFL_TE', position: 'TE', side: 'canton' as const },
    { slot: 'NFL_FLEX', position: 'FLEX', side: 'canton' as const },
  ] satisfies C2CSlotDef[],
  benchSlots: 8,
  taxiSlots: 4,
  devySlots: 6,
  irSlots: 2,
}

export const NBA_CBB_DEFAULTS = {
  campusStarterSlots: [
    { slot: 'CBB_G1', position: 'G', side: 'campus' as const },
    { slot: 'CBB_G2', position: 'G', side: 'campus' as const },
    { slot: 'CBB_F1', position: 'F', side: 'campus' as const },
    { slot: 'CBB_F2', position: 'F', side: 'campus' as const },
    { slot: 'CBB_C', position: 'C', side: 'campus' as const },
    { slot: 'CBB_UTIL', position: 'UTIL', side: 'campus' as const },
  ] satisfies C2CSlotDef[],
  cantonStarterSlots: [
    { slot: 'NBA_G1', position: 'G', side: 'canton' as const },
    { slot: 'NBA_G2', position: 'G', side: 'canton' as const },
    { slot: 'NBA_F1', position: 'F', side: 'canton' as const },
    { slot: 'NBA_F2', position: 'F', side: 'canton' as const },
    { slot: 'NBA_C', position: 'C', side: 'canton' as const },
    { slot: 'NBA_UTIL', position: 'UTIL', side: 'canton' as const },
  ] satisfies C2CSlotDef[],
  benchSlots: 8,
  taxiSlots: 4,
  devySlots: 4,
  irSlots: 2,
}
