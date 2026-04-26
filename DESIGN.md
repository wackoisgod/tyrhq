# TYR HQ Design System

## 1. Source Of Truth

TYR HQ must align to the official Tyr branding pack maintained outside this repo.

Imported implementation assets live here:

- `static/brand/fonts`
- `static/brand/logos`

Core implementation files:

- `src/app.css`
- `src/routes/+layout.svelte`
- `src/routes/+page.svelte`

Do not introduce alternate logos, substitute fonts, or unapproved accent colors. The site should feel like a tactical companion product made by the same team as the game, not a fan skin layered on top.

## 2. Brand Character

The Tyr brand is severe, technical, and left-anchored. It is not rounded, soft, or “clean SaaS.” The visual tone should read as:

- Tactical
- Mechanical
- High-contrast
- Slightly cold
- Information-dense

The screenshot reference is the target mood: off-black field, purple structural layers, seafoam primary interaction, condensed uppercase headlines, and mono telemetry details.

## 3. Typography

Only three font families are approved:

| Role | Font | Usage | Case |
| --- | --- | --- | --- |
| Display | Big Shoulders Black | Headlines, nav, major CTA labels, oversized section titles | ALL CAPS |
| Utility | JetBrains Mono Regular/Bold/ExtraBold | Eyebrows, metadata, telemetry straps, small controls | ALL CAPS |
| Body | Inter Medium/Bold | Paragraphs, descriptions, sentence-case UI copy | Sentence case |

Rules:

- Big Shoulders and JetBrains Mono must not be used in sentence case.
- Inter must carry all explanatory copy and longer reading blocks.
- Large headings should feel compressed and stacked, with tight line-height and visible letter spacing.
- Utility labels should look like instrumentation, not editorial text.

## 4. Color System

Never use pure white `#FFFFFF` or pure black `#000000`.

### Base Palette

| Token | Hex | Purpose |
| --- | --- | --- |
| Off Black | `#0D111A` | Page field, deepest insets |
| Off White | `#E7E7FF` | Primary text |
| Purple100 | `#BDC6F2` | Bright support text, soft strokes |
| Purple200 | `#A0AAD9` | Secondary text |
| Purple300 | `#868FBF` | Tertiary text, metadata |
| Purple400 | `#54628C` | Structural accents |
| Purple500 | `#3D4766` | Mid surfaces, muted controls |
| Purple600 | `#2A334D` | Elevated panels |
| Purple700 | `#1A2233` | Primary panel surface |
| Seafoam | `#99F7FF` | Primary brand action |
| Lime | `#D5FF01` | Highlight, status, star emphasis |
| Ally Green | `#00FFD4` | Secondary highlight and active detail |
| XP Gold | `#D8A361` | Reward and progression accent |
| XP Purple | `#BE6CFF` | Program/rarity accent |
| Energy Blue | `#0080FF` | Energy/system states |
| Enemy Red | `#FF265C` | Destructive or hostile states |

### Site Token Mapping

The shared CSS token layer in `src/app.css` should stay aligned to these meanings:

- `--hud-surface`: page background
- `--hud-panel`: primary panel body
- `--hud-panel-mid`: secondary card tone
- `--hud-panel-high`: emphasized or elevated module
- `--hud-inset`: recessed subsystem surface
- `--hud-text`: primary copy
- `--hud-muted`: secondary copy
- `--hud-dim`: telemetry and tertiary data
- `--hud-teal`: primary interactive accent, mapped to Seafoam
- `--hud-ally`: secondary bright accent
- `--hud-lime`: warning or featured highlight

## 5. Layout Principles

### Left-Anchored Hierarchy

Major content should start from a deliberate left edge. Avoid centered hero blocks and generic symmetric marketing layouts.

### Tactical Strap + Command Row

The site shell should keep two distinct zones:

- A compact telemetry strap for brand, tagline, and publisher.
- A larger command row with the Tyr logomark, oversized nav labels, utility links, and the primary playtest CTA.

### Asymmetry

Cards should feel weighted to one side. Common pattern:

- Dense text block on the left
- Supporting media or glow on the right
- A vertical seafoam notch or subtle inset line to define the panel

### Hard Geometry

- No pill shapes
- No soft “product card” rounding
- No floating white panels
- Use square corners and inset strokes

## 6. Surface And Panel Rules

Use tonal separation before borders.

Preferred treatment:

- Dark panel body
- Slight purple lift toward the top edge
- Inset 1px low-opacity stroke
- Optional 2px seafoam notch on the left

Avoid:

- Bright outline borders around entire modules
- Card drop shadows that look soft or material-design-like
- Flat single-color sections without hierarchy

## 7. Components

### Primary CTA

- Fill: Seafoam
- Text: Off Black
- Font: Big Shoulders
- Case: ALL CAPS
- Shape: square
- Presence: should carry a subtle glow, never a glossy gradient

Used for:

- `Join The Playtest`
- Highest-priority conversion moments

### Secondary CTA

- Fill: Purple600/Purple500 range
- Text: Off White or Purple100
- Font: Big Shoulders
- Case: ALL CAPS

Used for:

- `Wishlist On Steam`
- `Read More`
- Secondary major navigation actions

### Ghost / Utility CTA

- Dark transparent fill
- Mono label
- Low-contrast stroke
- Reserved for archive links, utility actions, and low-priority commands

### Eyebrows And Telemetry

- JetBrains Mono only
- Uppercase only
- Tight, consistent tracking
- Use for dates, source labels, status strips, and small utility commands

### Cards

Cards should feel like tactical modules, not content tiles.

Required traits:

- Hard edges
- Inset linework
- Dense content grouping
- Strong vertical rhythm
- Hover states that brighten structure, not just scale the whole card

## 8. Homepage Composition

The homepage should follow this order:

1. Mission briefing / latest official signal
2. Community builds feed
3. Official video updates + community relay

### Mission Briefing

This is the homepage hero. It should resemble the reference screenshot:

- Mono source/date row at the top
- Very large Big Shoulders headline
- Inter summary copy beneath
- Action row containing playtest, wishlist, and read-more actions

### Community Builds

Build cards should feel like tactical dossiers:

- Author and metadata in mono
- Vehicle or build identity prominent
- Tank art drifting to the right edge
- Loadout icons grouped like equipment blocks

### Community Relay

The right-side support rail should handle Discord and secondary official actions. It should feel like a command module, not a sidebar ad.

## 9. Motion

Motion should be brief and purposeful.

Allowed:

- Small vertical lift on hover
- CTA glow surge
- Image scale shifts under 4%
- Accent line reveals

Avoid:

- Bouncy easing
- Long fades
- Decorative parallax
- Generic SaaS micro-interactions

## 10. Copy And Case Rules

- Headlines: ALL CAPS
- Eyebrows: ALL CAPS
- Nav: ALL CAPS
- Body copy: sentence case
- Brand voice: concise, tactical, direct

Do not mix editorial sentence-case headers with the Tyr shell. If a line is acting as a visual heading, it should usually be Big Shoulders uppercase.

## 11. Do / Don’t

### Do

- Use the provided logos directly
- Keep primary actions seafoam
- Let purple tones carry structural depth
- Use mono metadata to create the “instrument panel” feel
- Preserve strong contrast between headline, utility, and body layers

### Don’t

- Reintroduce Space Grotesk or other substitute display fonts
- Use pure white backgrounds or black text blocks
- Round cards into pills or consumer-app bubbles
- Center the whole UI like a marketing landing page
- Use colorful gradients that are not in the brand palette

## 12. Accessibility

Brand fidelity matters, but readability is not optional.

- Maintain at least AA contrast for interactive text.
- Keep body copy in Inter with comfortable line-height.
- Do not reduce important metadata below legibility just to mimic a HUD.
- If a color treatment becomes ambiguous, favor Off White text and Seafoam emphasis.
