export function buildFaabSteps(userFaabRemaining?: number): number[] {
  const base = [3, 5, 8, 12];
  if (!userFaabRemaining || userFaabRemaining <= 0) return [];
  return base.filter((n) => n <= userFaabRemaining);
}

export function buildScarcityNotes(scarcity: Record<string, number> | null | undefined): string[] {
  if (!scarcity) return [];
  const notes: string[] = [];
  for (const [pos, v] of Object.entries(scarcity)) {
    const n = Number(v);
    if (n >= 1.25) notes.push(`${pos} scarce (+${Math.round((n - 1) * 100)}%)`);
    else if (n > 20) notes.push(`${pos} scarce (+${n}%)`);
  }
  return notes.slice(0, 3);
}

function resolveId(raw: string, idSet: Set<string>, labelToId: Map<string, string>): string | null {
  if (idSet.has(raw)) return raw;
  const mapped = labelToId.get(raw);
  if (mapped && idSet.has(mapped)) return mapped;
  const lower = raw.toLowerCase();
  for (const [label, id] of labelToId) {
    if (label.toLowerCase() === lower && idSet.has(id)) return id;
  }
  return null;
}

export function buildLabelToIdMap(
  allowedAssets: Array<{ id: string; label: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of allowedAssets) {
    if (a.label && a.label !== a.id) {
      map.set(a.label, a.id);
    }
  }
  return map;
}

export function clampNegotiationToAllowed({
  negotiation,
  allowed,
}: {
  negotiation: any;
  allowed: {
    userAllowedIds: Set<string>;
    partnerAllowedIds: Set<string>;
    userFaabRemaining?: number;
    redLineIds?: Set<string>;
    userLabelToId?: Map<string, string>;
    partnerLabelToId?: Map<string, string>;
  };
}) {
  if (!negotiation) return null;

  const userAllowed = allowed.userAllowedIds;
  const partnerAllowed = allowed.partnerAllowedIds;
  const coreRedLineIds = allowed.redLineIds ?? new Set<string>();
  const userL2I = allowed.userLabelToId ?? new Map<string, string>();
  const partnerL2I = allowed.partnerLabelToId ?? new Map<string, string>();

  const resolveUser = (raw: string) => resolveId(raw, userAllowed, userL2I);
  const resolvePartner = (raw: string) => resolveId(raw, partnerAllowed, partnerL2I);

  const dmMessages = Array.isArray(negotiation.dmMessages) ? negotiation.dmMessages : [];

  const safeCounters = (Array.isArray(negotiation.counters) ? negotiation.counters : [])
    .map((c: any) => {
      const ct = c?.counterTrade ?? {};

      const youAdd = (ct.youAdd ?? [])
        .map((raw: string) => resolveUser(raw))
        .filter((id: string | null): id is string => id !== null && !coreRedLineIds.has(id));
      const youRemove = (ct.youRemove ?? [])
        .map((raw: string) => resolveUser(raw))
        .filter((id: string | null): id is string => id !== null);
      const theyAdd = (ct.theyAdd ?? [])
        .map((raw: string) => resolvePartner(raw))
        .filter((id: string | null): id is string => id !== null);
      const theyRemove = (ct.theyRemove ?? [])
        .map((raw: string) => resolvePartner(raw))
        .filter((id: string | null): id is string => id !== null);

      let faabAdd = ct.faabAdd;
      if (typeof faabAdd === "number") {
        if (!allowed.userFaabRemaining) faabAdd = undefined;
        else if (faabAdd > allowed.userFaabRemaining) faabAdd = allowed.userFaabRemaining;
        else if (faabAdd <= 0) faabAdd = undefined;
      }

      const hasAny =
        youAdd.length || youRemove.length || theyAdd.length || theyRemove.length || faabAdd;

      if (!hasAny) return null;

      return {
        label: String(c.label ?? "Counter"),
        ifTheyObject: String(c.ifTheyObject ?? "Not sure about value"),
        rationale: String(c.rationale ?? "Adjusted to fit preferences."),
        counterTrade: { youAdd, youRemove, theyAdd, theyRemove, ...(faabAdd ? { faabAdd } : {}) },
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  const sweeteners = (Array.isArray(negotiation.sweeteners) ? negotiation.sweeteners : [])
    .map((s: any) => {
      const addOn = s?.addOn ?? {};
      let faab = addOn.faab;
      if (typeof faab === "number") {
        if (!allowed.userFaabRemaining) faab = undefined;
        else if (faab > allowed.userFaabRemaining) faab = allowed.userFaabRemaining;
        else if (faab <= 0) faab = undefined;
      }
      const pickSwap = addOn.pickSwap;
      if (pickSwap && typeof pickSwap === "object") {
        const resolvedAdd = pickSwap.youAddPickId ? resolveUser(pickSwap.youAddPickId) : null;
        const resolvedRemove = pickSwap.youRemovePickId ? resolveUser(pickSwap.youRemovePickId) : null;
        pickSwap.youAddPickId = resolvedAdd ?? undefined;
        pickSwap.youRemovePickId = resolvedRemove ?? undefined;
        if (!pickSwap.youAddPickId && !pickSwap.youRemovePickId) {
          if (!faab) return null;
        }
      }
      const safeAddOn = { ...(faab ? { faab } : {}), ...(pickSwap ? { pickSwap } : {}) };
      if (!Object.keys(safeAddOn).length) return null;

      return {
        label: String(s.label ?? "Sweetener"),
        whenToUse: String(s.whenToUse ?? "If they hesitate."),
        addOn: safeAddOn,
      };
    })
    .filter(Boolean)
    .slice(0, 5);

  const redLines = Array.isArray(negotiation.redLines)
    ? negotiation.redLines.map(String).slice(0, 10)
    : [];

  return { dmMessages, counters: safeCounters, sweeteners, redLines };
}
