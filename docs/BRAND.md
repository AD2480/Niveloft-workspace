# Niveloft brand guide

> **Working name.** "Niveloft" hasn't been checked for trademark, domain or social-handle availability. Do that before any public launch. Internal identifiers (the `dev.projectflow` Java package, the `projectflow` database, `projectflow.*` storage keys) keep the original name on purpose.

## The idea

**See what will finish, when, and what’s in the way.**

Niveloft is for small software and student teams who share work and reviews. It gives their work a home and answers the questions a team actually asks about delivery: what will finish, when, and what is holding it up. **It reads a project the way an avalanche forecaster reads snow: in layers.** A forecaster digs a snow pit and reads the wall: fresh snow on top, layers still settling, firm snow at the base, and the one weak layer that will give way. In Niveloft every task is a slice of the layer of its state:

| Layer | State | Colour token |
| --- | --- | --- |
| Fresh snow on top | Not started | `--strata-todo` |
| Settling | In progress | `--strata-progress` |
| Waiting for a decision | In review | `--strata-review` |
| Firm at the base | Approved | `--strata-done` |
| **The weak layer** | Late, and holding other work up | `--strata-weak` |

The same five colours, in the same order, carry meaning everywhere: the front page's block, the blocks on Today and on each Overview, the strata bars, the charts and the 3D model. Nothing else in the product is coloured for decoration.

| | |
| --- | --- |
| **Name** | Niveloft (from *nivel*, snow and level, and *loft*, a place up high to work in) |
| **Promise (headline)** | See what will finish, when, and what’s in the way. |
| **Descriptor** | A project workspace for small software and student teams. |
| **Audience line** | For small software and student teams. |
| **Spelling** | Always *Niveloft* (*niveloft* in the wordmark). Artwork that says anything else, such as the ice render spelling "NIVELOGT", isn't used until it's corrected. |
| **The assistant** | Flurry. Its call to action is *Ask Flurry*. |

### Voice

- Plain, calm and specific. Say what happens, in the order it happens.
- Name the thing, not the feeling: "2 open tasks have no owner", not "Some things might need attention!"
- Never overclaim. Estimates are called estimates. What isn't recorded is "not in the records", never a finding.
- No invented customers, testimonials, logos or numbers. Examples are labelled as samples.
- Buttons are verbs: *Open the sample project*, *Create your free workspace*, *Log in*, *Ask Flurry*. One primary action per screen.
- Sentence case everywhere, with no exceptions: headings, labels, tabs, tags and table heads. Nothing is set in capitals by CSS.
- Plain punctuation for metadata: commas, colons and parentheses (*Due 18 Oct, likely 22 Oct*; *No AI model: built-in answers*), not strings joined with middle dots.
- Forecasts are windows, not dates: *likely 22–28 Oct*, with the chance of the deadline and what it assumes. Never rank people.

## Colour

Light is a bright snowfield: a cool off-white canvas, white surfaces, night-blue ink, and glacier blue for actions, links, focus and the selected item, nothing else. Dark is the same mountain at night. Every text colour is at least 4.5:1 on the canvas and on every surface, in both themes.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--canvas` | `#F2F5F8` | `#0A131B` | Page background |
| `--surface` / `-2` / `-3` | `#FFFFFF` / `#F7F9FB` / `#EAEFF3` | `#101B24` / `#14202B` / `#1B2834` | Cards and panels; insets; hover and pressed |
| `--ink` / `--ink-2` | `#0D1B27` / `#2A3946` | `#E7EEF4` / `#C3CEDA` | Text |
| `--muted` | `#53616E` | `#97A6B5` | Secondary text (≥ 4.5:1 on every surface) |
| `--brand` | `#1B4B73` (white text, 9.1:1) | `#93C5EA` (dark text, 10:1) | Primary buttons, links, focus rings, the selected item, the logo's cap |
| `--line` / `--line-strong` | `#DDE4EA` / `#C2CCD5` | `#233140` / `#344659` | Lines, used sparingly |
| `--plate-top` → `--plate-bottom` | `#F5F8FA` → `#E3EAF0` | `#0F1A24` → `#15242F` | The plate a block of snowpack stands on (`.bg-plate`) |
| `--frost` | `#A9CDE3` | `#5C8EAF` | Decorative light only (the wash behind the app's pages, Flurry's glow) |

The snowpack (checked with a colour-blind palette validator against each theme's surface; every neighbouring pair in the bar's order stays apart):

| Token | Light | Dark |
| --- | --- | --- |
| `--strata-todo` | `#8B9AA8` | `#9AA5AF` |
| `--strata-progress` | `#2F7BC0` | `#3A86CC` |
| `--strata-review` | `#D4952A` | `#D0A046` |
| `--strata-done` | `#2A8462` | `#2B9670` |
| `--strata-weak` | `#D9432B` | `#D23F29` |

The 3D blocks use their own lit versions of these (`frontend/src/three/snowPalette.ts`), tuned so that, once lit, they read as the same five colours.

Rules:
- Components use the semantic tokens (`bg-surface`, `text-muted`, `border-line`, `text-accent`, `bg-brand`, `bg-strata-review`), never raw palette colours for chrome. The tokens live in `frontend/src/index.css`.
- Primary buttons are flat: no gradients, no glow. Shadows only lift things that float (menus, dialogs, Flurry's card, the labels over a block).
- The weak layer's red means one thing: *late, and holding work up*. It's also used for destructive actions and errors, never for decoration.
- Text never wears a series colour: values and labels stay in ink, muted or secondary text, with a coloured swatch beside them carrying the identity.
- Status colours (success, warning, danger, info) are separate from the snowpack and are always paired with an icon or a word.

## Type

Two faces, both SIL Open Font License and self-hosted (Fontsource), so no font request leaves the site:
- **Archivo** (variable, with its width axis: `@fontsource-variable/archivo/wdth.css`), set wide and heavy, for headlines and the big readings: like layers of snow laid flat. `.display-poster` (width 125, weight 800) is for the front page's headline only; `.display-wide` (width 118, weight 760) for the public pages' headings and the big numbers; `.reading` (width 112, weight 700, tabular figures) for a number or date that is the answer.
- **Geist** (variable, `@fontsource-variable/geist`) for everything else: the product, body text, buttons, forms, labels and task keys (with tabular figures wherever numbers are compared).

Code, commands and keyboard keys use the system monospace. Nothing else does: there are no monospaced labels.

| Level | Size | Weight |
| --- | --- | --- |
| Front page headline (Archivo, widest) | 42 px on phones, 60 px on tablets, 76 px on wide screens | 800 |
| Public section headings (Archivo, wide) | 34–48 px | 760 |
| App page title (Archivo, width 108) | 28–32 px | 650 |
| Card and section titles | 15–20 px | SemiBold |
| Body | 14–17 px | Regular |
| Labels and captions | 12–13 px | Medium |

## Logo

**The mark** is a peak drawn as three layers of snow: a cap of fresh snow on top (glacier blue) and two settled layers beneath it (ink), with a clear gap between each, the way Niveloft reads a project. The gaps keep the three parts readable at favicon size, even in one colour. Paths are in `frontend/src/components/layout/Logo.tsx` (`MARK_PATHS`, 32 × 32 grid) and `public/favicon.svg`.

**The wordmark** is *niveloft* in Archivo, set a little wide (112), bold, lowercase and tight. Its one detail: the dot of the i is a small glacier-blue diamond, a flake landing.

| Variant | Use |
| --- | --- |
| Mark + wordmark | Headers, footers, emails |
| Mark alone | Favicon, app icons, the collapsed sidebar, social avatars |
| Inverted | Always-dark backgrounds: snow layers with a frost cap |
| Mono | One-colour print and embossing |

Keep clear space of one layer's height around the mark. Don't recolour the cap outside the palette, add effects, or set the wordmark in another face.

Generated files: `public/favicon.svg` (switches with the system theme), `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (a night tile with snow layers and a frost cap, readable on light and dark home screens) and `og-image.png` (1200 × 630: the headline in Archivo beside the front page's block, rendered from the real scene).

## Shape and layout

- **Spacing:** a 4 px base, with 8, 12, 16, 24, 32 and 48 px steps.
- **Radii:** 8 px for inputs and small controls, 12 px for cards, menus and panels, 16 px for the big frames (the sample workspace). Pills are fully round.
- **Buttons:** primary is glacier blue with white text (ice blue with dark text in the dark theme); secondary is white with a line; quiet is text only. Main actions are 48 px tall; everyday buttons are 40 px with a mouse and 44 px on touch screens. While a button works, its label keeps its place under a spinner, so nothing jumps.
- **Width:** public pages up to 1320 px; the app's pages up to 1600 px beside a 256 px sidebar.
- **Focus:** a 2 px glacier-blue ring, always visible for keyboard users.
- **Saved indicators** appear only after a save succeeded, and disappear when you try again.

## Glyphs for status and priority

Drawn for Niveloft (`frontend/src/components/glyphs.tsx`), not taken from an icon set, so a task's state reads the same way as the snowpack:

- **Status** is a small round gauge that fills from the bottom as work moves through its layers: empty for not started, a third for in progress, two thirds for in review, full with a tick for approved. Each fill uses the layer's colour, and a red pip at the top right means the task is late. It's always paired with the word (*In review*) except where the word is already beside it, such as a column heading.
- **Priority** is three bars that fill one to three (low, medium, high), in ink, never coloured; urgent is the one exception, a red tile with white bars.
- At 14 px they stay distinct in one colour, in both themes and for colour-blind readers, because they differ in shape and fill, not only in hue.

## Writing in Niveloft

Descriptions, comments, review feedback and notes share one light syntax: `**bold**`, `*italic*`, `` `code` ``, lists, checklists (`- [ ]`), quotes and links. A task key (*ONB-9*) becomes a link with its status glyph; `@` and a member's name is a mention, highlighted (more strongly when it's you). Text is always drawn from a parsed tree, never inserted as HTML.

## The snowpack in 3D

One shape, drawn in three places, all from the records:

1. **The front page** (`frontend/src/features/public/home/`, scene in `frontend/src/three/SnowpackScene.ts`): the sample project as a block cut away like a snow pit, on a stone plinth, lit like a product shot, with snow falling around it. The headline beside it, and three readings from the sample. Scrolling lifts the layers apart and reads them top down, one per screen, then closes the block again. The layers carry their names and real counts; the weak layer (*ONB-9, 2 days late*) has its own red label.
2. **Each project's Overview**: the same block made from the project's tasks, with every late task in red and the weak layer called out; the layers listed beside it.
3. **Today**: one small block per active project, in a single 3D scene placed behind the project tiles (`frontend/src/three/PortfolioSnowpack.ts`), with late work as a red band above the approved base.

Why a block of snow and not a dashboard: a team's work arrives unevenly and settles in layers; the thickness of a layer reads as the amount of work in that state without a chart, and one red slice in white snow is impossible to miss. The block earns trust by being the product's own data, not by claiming it.

Requirements it keeps:
- The words are ordinary page content; the block is decoration (`aria-hidden`), and the page says the same things in words beside it.
- three.js loads after the first paint (`whenIdle`). Until then, and without WebGL, a **still** is shown: the same block drawn in SVG, projected with the scene's own camera (`frontend/src/three/snowpackFrame.ts`, checked against three.js in its tests), so it fades into the scene in place, labels included.
- Reduced motion: no falling snow, no sway, and the layers jump instead of gliding. The scene renders only when something changes in the workspace, and pauses off screen and in hidden tabs. Slow hardware gets no shadows and less snow.
- Pointing at a slice names its task, layer, lateness and owner; clicking opens it; dragging turns the block a little.

## Flurry

**Flurry** is Niveloft's AI project assistant: a small floating snow creature with a rounded body, two expressive graphite eyes, tiny arms, a swept snow tuft and a soft icy-blue glow. Its silhouette (a round body with a tuft and two dark eyes) has to read at 16 px, so nothing important lives in fine detail. The detailed artwork (`docs/brand/flurry-source.png`, published as `public/flurry/flurry-*.webp`) is for marketing; the app uses a light vector version (`FlurryFigure.tsx`) that's sharp at any size and cheap to animate. **`/flurry` (Meet Flurry) is its reference sheet:** the anatomy, every size in both themes, each behaviour running live and a sandbox.

| Expression | When |
| --- | --- |
| Idle | Floats gently, blinks, looks around |
| Listening | The "Hey Flurry" wake phrase is on and the microphone is live |
| Thinking | A real request is being processed (two flakes circling, nothing more) |
| Success | Something you did worked: a brief happy hop, then back to idle |
| Error | Something failed (the message says what) |
| Settled | You're typing elsewhere; it sinks a little and fades back |
| Curious | You're pointing at it (or near it): it leans in and its eyes widen |
| Carried | Being dragged: arms up, swaying, trailing the pointer a little |
| Pointing | Beside a task or a milestone it was asked about, one arm towards it |
| Attention | Something needs you: a small indicator beside it, never a pop-up |
| Wave | It has just arrived at the conversation you called it to |
| Asleep | A quiet spell, or dismissed to the sidebar: small *z*s drifting up |

| Behaviour | What it does |
| --- | --- |
| Idle | Floats near an edge, looks around, now and then settles on the sidebar |
| Roaming | Moves between a few safe resting spots, only after 30 s without keyboard or mouse |
| Dragged | Follows the pointer with a slight trail, then settles exactly where it's let go |
| Clicked | Turns towards you; a compact menu: *Ask Flurry*, *My next task* and *Delivery outlook*, then *Roam*, *Stay here* and *Hide* |
| Working | The restrained thinking look, only while a real request runs |
| Task completed | A brief happy reaction, then idle |
| Attention needed | A small indicator; clicking names the actual blocker or pending review |
| Dismissed | Retreats into its sidebar item, asleep, with *Call back* |

Personality: calm, curious and quietly useful. It suggests; people decide. It never approves work, never assigns people or changes deadlines on its own, and never claims to have opened a link or file. Everything it changes is previewed first, saved only when you confirm, and can be undone. It answers the question asked (a question about ONB-9 gets an answer about ONB-9), always shows its scope, and never guesses why something is late.

Words: notes are one or two sentences that name the thing and offer one move, ending in a question when it's an offer: *"This review is holding up ONB-10. Open it?"*, with one button, *Open the review*. They appear when asked (its menu, a milestone you select); it speaks up on its own only if *Let Flurry speak up* is on, once per new thing.

Motion: a gentle float and a blink; its eyes follow the pointer; it flies between spots in a soft arc and banks into turns. Three levels: *Full*, *Calm* (reacts but doesn't float or fly; moves by a short fade) and *Off*; reduced motion always means still. Sizes: small (44), medium (56), large (72). The figure is decorative (`aria-hidden`); whatever it expresses is also said in words.

Presence: present but out of the way. It keeps clear of buttons, fields, text and chart labels, pauses while you type, drag tasks or use a menu, never lands under the pointer, and naps when things are quiet. *Roam*, *Stay here* and *Hide* are always one click away. On phones it has one fixed spot on the bottom edge. It lives inside the Niveloft page only; roaming the desktop would need a separate desktop companion.

In the workspace, a faint wash of cold light sits behind every page; a light snowfall can be turned on in *Settings → Appearance*.

## Imagery

- Real product screens and the sample project, labelled as samples.
- The snowpack block (made from the sample project's tasks, or a project's own), and Flurry.
- Everything is built from code and the records: no bought or borrowed models, textures or illustrations.
- No stock photos of people, no fabricated dashboards with invented numbers, no customer logos until there are customers.
