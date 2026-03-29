# @totus/design-system

Totus brand tokens, Tailwind v4 theme integration, and React components.

## Structure

```
src/
├── tokens.ts        — TypeScript constants (colors, semantic, fonts, spacing, radius, shadows)
├── tokens.css       — CSS custom properties (--totus-*) with light + dark mode
├── fonts.css        — Google Fonts import (DM Sans 400/500/600, DM Mono 400)
├── theme.css        — Tailwind v4 @theme block (brand + semantic utilities)
├── components/
│   └── Logo.tsx     — <Logo> and <SignalBars> React components
└── index.ts         — Public TypeScript API
```

## Installation

Already a workspace dependency in `apps/web`. For any new app in the monorepo:

```json
{ "dependencies": { "@totus/design-system": "workspace:*" } }
```

## CSS setup (Tailwind CSS v4)

In your root CSS file (e.g. `globals.css`):

```css
@import "@totus/design-system/fonts.css";   /* DM Sans + DM Mono */
@import "@totus/design-system/tokens.css";  /* --totus-* custom properties */
@import "tailwindcss";

/* Optional: register brand + semantic Tailwind utilities */
/* (already included in apps/web/globals.css via @theme inline block) */
/* @import "@totus/design-system/theme.css"; */
```

## Token layers

### 1. Appearance tokens — raw brand values

```css
var(--totus-ocean)      /* #1e5b7b */
var(--totus-emerald)    /* #2fa87b */
var(--totus-coral)      /* #e8845a */
var(--totus-ink)        /* #1a2332 */
var(--totus-slate)      /* #64748b */
var(--totus-mist)       /* #e2e8f0 */
var(--totus-cloud)      /* #f8f9fb */
```

### 2. Semantic tokens — function-named aliases

Semantic tokens flip in dark mode automatically. Use these in feature code.

```css
var(--totus-primary)          /* ocean in light, lighter ocean in dark */
var(--totus-cta)              /* coral — always */
var(--totus-success)          /* emerald — always */
var(--totus-danger)           /* coral — always */
var(--totus-background)       /* cloud → dark bg */
var(--totus-surface)          /* white → ink */
var(--totus-text)             /* ink → cloud */
var(--totus-text-muted)       /* slate → #94a3b8 */
var(--totus-border-color)     /* mist → #2a3a4a */
```

### 3. Tailwind utilities (after importing theme.css)

```html
<!-- Appearance -->
<div class="bg-brand-ocean text-brand-cloud">...</div>
<button class="bg-brand-coral text-white">CTA</button>

<!-- Semantic (dark-mode-aware) -->
<div class="bg-semantic-background text-semantic-text">...</div>
<p class="text-semantic-text-muted">Secondary text</p>
<hr class="border-semantic-border">

<!-- Fonts -->
<p class="font-sans">DM Sans body text</p>
<code class="font-mono">DM Mono — metrics: 94 mg/dL</code>

<!-- Shadows -->
<div class="shadow-brand-sm">Card</div>
<div class="shadow-brand-md">Modal</div>
<div class="shadow-brand-lg">Featured share link</div>
```

## TypeScript tokens

For JS/TS contexts where CSS variables aren't available (Recharts, canvas, emails):

```ts
import { colors, semantic, fonts, spacing, radius, shadows, chartColors } from '@totus/design-system';

// Recharts stroke
<Line stroke={colors.emerald} />

// Semantic — use in feature code for rebrand-safety
<Line stroke={semantic.success} />

// Chart palette (ordered sequence)
chartColors.map((color, i) => <Line key={i} stroke={color} />)

// Spacing / radius
style={{ gap: spacing['4'], borderRadius: radius.card }}
```

## Logo component

```tsx
import { Logo, SignalBars } from '@totus/design-system';

// Full color lockup (light background)
<Logo />

// White lockup (dark/ocean background)
<Logo variant="white" />

// Auto — adapts color/white based on nearest .dark ancestor
<Logo variant="auto" />

// Icon only
<Logo height={20} wordmark={false} />
<SignalBars height={16} variant="mono" />
```

### Logo variants

| Variant | When to use |
|---|---|
| `color` | Light backgrounds (default) |
| `white` | Dark or Deep Ocean backgrounds |
| `mono` | Single-color print, emboss, favicon fallback |
| `auto` | When the logo may appear on either background — respects `.dark` class |

## Updating brand values

Edit `src/tokens.css` (for CSS/Tailwind consumers) and `src/tokens.ts` (for TS consumers) in tandem. The `semantic` layer means most feature code won't need changes — only the mapping at the top of each file.
