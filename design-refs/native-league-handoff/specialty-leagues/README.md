# Specialty leagues: Codex handoff

There are ten format folders. Each one contains:

- `assets/`: emblem, banner and icons
- `screens/`: PNGs at 2× resolution
- `source/`: design mockups
- `README.md`: rules, screens and open decisions

`shared/sp.css` holds the shared styles. `shared/overview.png` shows all ten formats. `tools/gen_a.py`, `gen_b.py` and `gen_c.py` regenerate the art for nine formats: `python3 gen_c.py <outdir>`. `tools/gen_d.py` regenerates the Tournament art: `python3 gen_d.py <outdir>`.

| Folder | Format | Rules source |
|---|---|---|
| `tournament/` | Tournament (cuts, redrafts, bracket) | repo buildout doc |
| `guillotine/` | Guillotine ("Guilly") | repo spec |
| `bigbrother/` | Big Brother | repo PRD |
| `survguil/` | Survivor Guillotine | **proposed** |
| `zombie/` | Zombie | repo spec |
| `salary/` | Salary cap | repo spec |
| `devy/` | Devy dynasty | repo code + docs |
| `c2c/` | C2C, Campus to Canton | repo plan |
| `koth/` | King of the Hill | **proposed** |
| `pirate/` | Pirate | **proposed** |

## Shared design pattern (all formats)

1. **League home:**
   - a hero with the format banner, emblem, chips and a headline for this week
   - a countdown to the next decision point
   - the format's core mechanic panel
   - a right rail: your status, the rules, the feed
2. **Signature moment:** one animated, interactive screen for the event that defines the format. It has a Replay button for QA.
3. **Phone home:** a banner header, your status, the key list, and one main call to action.

## Theme tokens per format

Set `--acc`, `--acc2` and `--accInk` on the page root. Values are in each mockup's root `style` attribute.

| Format | `--acc` | Display font |
|---|---|---|
| Tournament | #e8b84a | Archivo 800/900 |
| Guillotine | #e0402e | Bebas Neue |
| Big Brother | #3b82f6 | Archivo |
| Survivor Guillotine | #e2672a | Cinzel |
| Zombie | #8be03a | Creepster (titles only) |
| Salary cap | #3aa86a | Archivo |
| Devy | #e8701e | Archivo |
| C2C | #c9a24a | Archivo |
| King of the Hill | #8b5cf6 | Cinzel |
| Pirate | #d4a017 | Pirata One (titles only) |

## Gotcha for the mockup runtime

The design runtime wraps every bound value in `<span class="sc-interp">`. Write CSS with child selectors (`.x>span`), not descendant selectors (`.x span`). Otherwise label styles leak into values.
