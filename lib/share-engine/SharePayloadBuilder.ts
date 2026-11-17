import { getPublicSiteOrigin } from "@/lib/site-public-origin";
import type {
  SharePayload,
  SharePayloadRequest,
  ShareVisibility,
  ShareableKind,
} from "./types";

function baseUrlFallback(): string {
  return getPublicSiteOrigin();
}

function textOrUndefined(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function stringArray(value: unknown, maxItems = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 40))
    .slice(0, maxItems);
}

function normalizeVisibility(value: unknown): ShareVisibility {
  if (value === "invite_only" || value === "private") return value;
  return "public";
}

function normalizeUrl(url: string, baseUrl = baseUrlFallback()): string {
  const trimmed = url.trim();
  if (!trimmed) return baseUrl.replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = baseUrl.replace(/\/$/, "");
  if (trimmed.startsWith("/")) return `${base}${trimmed}`;
  return `${base}/${trimmed}`;
}

function toStartCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function defaultTitle(kind: ShareableKind, context: { leagueName?: string; bracketName?: string; creatorName?: string }) {
  switch (kind) {
    case "league_invite":
      return context.leagueName ? `${context.leagueName} invite` : "AllFantasy league invite";
    case "bracket_invite":
      return context.bracketName ? `${context.bracketName} bracket invite` : "AllFantasy bracket invite";
    case "ai_result_card":
      return "AllFantasy Chimmy analysis";
    case "matchup_result":
      return "AllFantasy matchup result";
    case "power_rankings":
      return context.leagueName ? `${context.leagueName} power rankings` : "AllFantasy power rankings";
    case "story_recap":
      return context.leagueName ? `${context.leagueName} story recap` : "AllFantasy story recap";
    case "creator_league_promo":
      if (context.creatorName && context.leagueName) return `${context.creatorName}: ${context.leagueName}`;
      if (context.creatorName) return `${context.creatorName} creator league`;
      return "Creator league promo";
    case "player_comparison":
      return "AllFantasy player comparison";
    default:
      return "AllFantasy share";
  }
}

function defaultDescription(
  kind: ShareableKind,
  input: {
    sport?: string;
    leagueName?: string;
    bracketName?: string;
    creatorName?: string;
    visibility: ShareVisibility;
    safeForPublic: boolean;
  }
) {
  const sportLabel = input.sport ? `${input.sport} ` : "";
  const showNames = input.visibility === "public" && input.safeForPublic;

  switch (kind) {
    case "league_invite":
      return showNames && input.leagueName
        ? `Join this ${sportLabel}league on AllFantasy.`
        : "A commissioner shared an AllFantasy league invite.";
    case "bracket_invite":
      return showNames && input.bracketName
        ? `Join this ${sportLabel}bracket challenge on AllFantasy.`
        : "An AllFantasy bracket invite is ready to open.";
    case "ai_result_card":
      return "Share a public-safe AllFantasy Chimmy analysis card.";
    case "matchup_result":
      return "Share a matchup result card with AllFantasy context and sport-aware styling.";
    case "power_rankings":
      return showNames && input.leagueName
        ? `See the latest power rankings from ${input.leagueName}.`
        : "See the latest AllFantasy power rankings.";
    case "story_recap":
      return showNames && input.leagueName
        ? `Read the latest recap from ${input.leagueName}.`
        : "Read the latest AllFantasy story recap.";
    case "creator_league_promo":
      return showNames && input.creatorName
        ? `Compete in ${input.creatorName}'s creator community on AllFantasy.`
        : "Share a creator league promo without exposing private league details.";
    case "player_comparison":
      return "Compare player outlooks with an AllFantasy result card.";
    default:
      return "Open this AllFantasy share.";
  }
}

function defaultCta(kind: ShareableKind): string {
  switch (kind) {
    case "league_invite":
    case "bracket_invite":
      return "Open invite";
    case "creator_league_promo":
      return "Join creator league";
    case "matchup_result":
      return "View matchup";
    case "power_rankings":
      return "See rankings";
    case "story_recap":
      return "Read recap";
    case "player_comparison":
      return "Compare players";
    case "ai_result_card":
    default:
      return "Open in AllFantasy";
  }
}

function defaultEyebrow(kind: ShareableKind): string {
  return toStartCase(kind);
}

function buildHelperText(visibility: ShareVisibility, safeForPublic: boolean): string {
  if (!safeForPublic || visibility !== "public") {
    return "This share keeps private league details hidden until the link is opened.";
  }
  return "Only public-safe details are included in this share preview.";
}

function buildChips(input: {
  kind: ShareableKind;
  sport?: string;
  weekOrRound?: string;
  visibility: ShareVisibility;
  safeForPublic: boolean;
}) {
  const chips: string[] = [];
  chips.push(toStartCase(input.kind));
  if (input.sport) chips.push(input.sport);
  if (input.weekOrRound) chips.push(input.weekOrRound);
  chips.push(input.visibility === "public" && input.safeForPublic ? "Public safe" : "Invite safe");
  return chips.slice(0, 4);
}

function buildHashtags(input: {
  kind: ShareableKind;
  sport?: string;
  hashtags?: string[];
}) {
  const tags = new Set<string>(["AllFantasy"]);
  if (input.sport) {
    const normalizedSport = input.sport.replace(/[^A-Za-z0-9]/g, "");
    if (normalizedSport) tags.add(normalizedSport);
  }
  const kindTag = input.kind.replace(/[^A-Za-z0-9]/g, "");
  if (kindTag) tags.add(kindTag);
  for (const tag of input.hashtags ?? []) {
    const normalized = tag.replace(/[^A-Za-z0-9]/g, "");
    if (normalized) tags.add(normalized);
  }
  return Array.from(tags).slice(0, 4);
}

export function buildSharePayload(
  request: SharePayloadRequest,
  options?: { baseUrl?: string }
): SharePayload {
  const visibility = normalizeVisibility(request.visibility);
  const requestedSafeForPublic = request.safeForPublic !== false;
  const safeForPublic = requestedSafeForPublic && visibility === "public";
  const publicLeagueName = safeForPublic ? textOrUndefined(request.leagueName, 120) : undefined;
  const publicBracketName = safeForPublic ? textOrUndefined(request.bracketName, 120) : undefined;
  const publicCreatorName = safeForPublic ? textOrUndefined(request.creatorName, 120) : undefined;
  const safeTitle = textOrUndefined(request.title, 120);
  const sport = textOrUndefined(request.sport, 24);
  const safeDescription = textOrUndefined(request.description, 220);
  const title = safeForPublic
    ? safeTitle ??
      defaultTitle(request.kind, {
        leagueName: publicLeagueName,
        bracketName: publicBracketName,
        creatorName: publicCreatorName,
      })
    : defaultTitle(request.kind, {});
  const description = safeForPublic
    ? safeDescription ??
      defaultDescription(request.kind, {
        sport,
        leagueName: publicLeagueName,
        bracketName: publicBracketName,
        creatorName: publicCreatorName,
        visibility,
        safeForPublic,
      })
    : defaultDescription(request.kind, {
        sport,
        visibility,
        safeForPublic,
      });

  return {
    kind: request.kind,
    url: normalizeUrl(request.url, options?.baseUrl),
    title,
    description,
    imageUrl: textOrUndefined(request.imageUrl, 1024),
    sport,
    shareId: textOrUndefined(request.shareId, 64),
    leagueName: publicLeagueName,
    bracketName: publicBracketName,
    weekOrRound: textOrUndefined(request.weekOrRound, 64),
    hashtags: buildHashtags({
      kind: request.kind,
      sport,
      hashtags: stringArray(request.hashtags),
    }),
    cta: textOrUndefined(request.cta, 60) ?? defaultCta(request.kind),
    creatorName: publicCreatorName,
    eyebrow: defaultEyebrow(request.kind),
    chips: buildChips({
      kind: request.kind,
      sport,
      weekOrRound: textOrUndefined(request.weekOrRound, 64),
      visibility,
      safeForPublic,
    }),
    helperText: buildHelperText(visibility, safeForPublic),
    visibility,
    safeForPublic,
  };
}
