# Survivor share cards: Codex handoff

Share cards turn a league's big moments into images that players post outside the app. Every share brings people back to allfantasy.ai, so this is the growth loop for Survivor leagues.

- `exports/` holds the 15 target PNGs: 5 moments in 3 formats. They are the visual source of truth.
- `source/card.html` and `source/share.css` are the reference renderer used to make those PNGs (`card.html?m=<moment>&f=<format>`).
- `ShareCards.dc.html` and `MobileShare.dc.html` are design mockups of the in-app share UI. Read them for layout and copy, but don't ship them.

## Formats

| Format | Size | Use |
|---|---|---|
| `post` | 1080×1350 (4:5) | Feed posts |
| `story` | 1080×1920 (9:16) | Stories and status. Keep the bottom 250px free of key text for platform UI. |
| `link` | 1200×630 (1.91:1) | The `og:image` for shared links to the moment page |

## Moments

| id | Hero art | Background mood | Offered to | When |
|---|---|---|---|---|
| `immunity` | `weekly/immunity-necklace.svg` | dusk | the immunity winner | when scores go final |
| `out` | `weekly/torch-out.svg` | night | the manager voted out (opt-in) | after the torch-out plays |
| `idol` | the played idol's hero SVG | night | the manager who played the idol | after the scroll reveal shows the idol |
| `exile` | `exile/token-coin-earned.svg` | exile | the manager returning from Exile | at the return |
| `champ` | `late/champion-trophy.svg` | day | the champion, plus the whole league as a recap | after the final jury vote |

The background is always `survivor/bg/{mood}-{sport}.svg` for the league's sport, so a hockey league gets the hockey island.

## Card anatomy, top to bottom

1. **Brand row:** the AllFantasy mark on the left, and the league pill (tribe crest and league name) on the right.
2. **Hero art:** centred, with a radial glow in the moment's accent colour (`--glow`).
3. **Kicker:** an uppercase label with an accent border, e.g. "Immunity · Week 6".
4. **Headline:** Cinzel 84px for post, 100px for story and 54px for link. At most 2 lines in post and link. If the manager name is long, drop to the next size down.
5. **Sub-line:** one sentence of context.
6. **Stats:** 2–3 stat tiles. Link shows at most 2.
7. **Footer:** `allfantasy.ai` on the left, and `Survivor · {Sport} {Season}` on the right.

On link, the hero art sits on the left and the text column on the right.

## Rendering in production

- **Approach:** render the PNGs on the server with `next/og` (`ImageResponse`) at `/api/share/survivor/[momentId]?f=post|story|link`.
  - Port the layout from `card.html` and `share.css`. `ImageResponse` supports flexbox, absolute positioning, gradients and `<img>` with data URLs or absolute URLs.
  - Load Archivo, Cinzel and JetBrains Mono as font buffers.
  - Pass SVGs as absolute URLs.
- **Caching:** cache by `momentId + format`. A moment never changes after it's final, so `Cache-Control: public, max-age=31536000, immutable` is fine.
- **Moment page:** `/l/[leagueSlug]/moment/[momentId]` is a public, read-only page. It sets `og:image` to the `link` render and has a "Join AllFantasy" call to action.

## Share UI

- **Desktop:** a modal with the moment list, a format switch, a live preview and four actions: Share, Save image, Copy link and League chat.
- **Phone:** a bottom sheet over the moment screen.
  - It opens on the Story format and has Story, Post and Link chips.
  - The same four actions sit in a row, plus a "Not now" button.
  - **Share:** uses `navigator.share({ files: [png] })` where it's supported. Otherwise it falls back to downloading the image and copying the link.
- **Copy link:** copies the moment page URL. Show a "Link copied" toast.
- **League chat:** posts the card into the league's chat as a system message.
- **Icons:** generic outline icons only. No third-party social logos.

## Privacy rules (must hold)

- Never show who voted for whom, partial tallies, or anyone's unplayed idols.
- The `out` card is opt-in for the eliminated manager. Never offer it to other players.
- Moment pages show manager display names only: no emails and no real names unless the manager uses one as their display name.
- A private league can turn sharing off (`shareCardsEnabled = false`). The moment page then returns 404.
