## What's wrong with the current chart

Looking at the screenshot, the log-scale fix made things technically correct but visually flat:

- Six near-parallel thin lines that all look identical in slope and color-weight.
- Half the chart is dead space (the area below $10k and above $1M).
- The headline "At age 65: $11.55M" is small text buried at the top — the most important number on the screen is the least visible.
- No visual anchors: you can't instantly tell *when* you cross $1M, *when* you cross $5M, or how much of the future is "growth" vs "what you have today."
- The range band ($3.65M – $35.47M) is a useful number but invisible in the chart.

This is data, not a story. Let's make it a story.

## Redesign

Replace the line-chart view with a **stacked area chart** plus a hero stat strip and milestone markers. This is what a polished personal-finance tool (Wealthfront, Personal Capital, Monarch) actually looks like.

### 1. Hero stat strip (above the chart)

A 3-card row that tells the whole story before you even look at the graph:

```text
┌─────────────────┬───────────────────┬─────────────────────┐
│  TODAY          │  AT AGE 65        │  MULTIPLIER         │
│  $48,200        │  $11.5M           │  239× your money    │
│  4 accounts     │  in 40 years      │  Range: $3.6M–$35M  │
└─────────────────┴───────────────────┴─────────────────────┘
```

- Big numbers (text-2xl), tabular-nums, color-coded.
- Multiplier card uses a subtle gradient background so it pops.
- Eliminates the need to squint at the chart for the headline number.

### 2. Stacked area chart (replaces overlapping lines)

Each account becomes a stacked color band — Gemini on top of Dub on top of S&P, etc. The total height = total wealth at that year. This is dramatically easier to read because:

- You see the **total trajectory** as the top of the stack, no separate "total" line needed.
- You see **each account's contribution** as the thickness of its band — visually obvious which accounts are doing the heavy lifting.
- Crypto's exponential growth becomes a visible "wedge" expanding over time instead of a thin line crossing other thin lines.
- No more spaghetti.

Technical: use Recharts `<Area stackId="acc" />` per account with `linearGradient` defs so each band fades from solid (bottom) to translucent (top) — premium look. Stroke at the top edge in the account color, ~1.5px.

### 3. Range band as a soft shadow above the stack

The optimistic/conservative ±band renders as a single light-gray ribbon **above** the expected stack (showing "upside") and a darker ribbon **below the top edge** (showing downside). Subtle `fillOpacity={0.08}`. So you see the most-likely outcome as solid, and the uncertainty as ghosted halos around it.

### 4. Milestone reference lines

Horizontal dashed lines at meaningful wealth markers, labeled on the right edge:

- `$1M` (financial-independence-lite)
- `$5M` (comfortable retirement)
- `$10M` (generational wealth)

Only show milestones that are within the chart's y-range. Labels in muted-foreground at ~9px, right-aligned. When the total line crosses one, the visual moment is unmistakable.

### 5. "Today" anchor

Vertical reference line on the leftmost year (2026) with a tiny "Today · $48k" label. Establishes the starting point so the growth feels real.

### 6. Crossover dots

For each milestone you cross before age 65, place a small `ReferenceDot` at the (year, milestone) crossover with a subtle pulse. So you see "you hit $1M at age 38" as a literal marker on the curve.

### 7. Drop the linear/log toggle

With the stacked area, log scale becomes meaningless (you can't stack on a log axis). Linear works because the stacked total naturally fills the chart's vertical space. Remove the toggle entirely — fewer knobs, more clarity.

### 8. Cleaner legend pills

Below the chart: rounded pills showing color swatch + account name + "$X.XM at 65" + rate%. Click to toggle visibility. The "at 65" inline number lets you compare account contributions at a glance without hovering.

## Visual polish

- Card uses a subtle `bg-gradient-to-br from-card to-card/60` for depth.
- Hero stat numbers use `font-semibold tabular-nums tracking-tight`.
- Each account color gets a matching CSS gradient (top → bottom fade) defined once in `<defs>`.
- Milestone lines: `strokeDasharray="3 6"`, `stroke="hsl(var(--muted-foreground))"`, `strokeOpacity={0.3}`.
- Today marker: solid `stroke="hsl(var(--primary))"`, `strokeOpacity={0.5}`, with a small label badge.
- Chart height bumped from 300px → 360px to give the visualization room to breathe.
- Tooltip restyled: rounded card, account swatches inline, total at bottom with a subtle divider.

## What you'll see after

Instead of 6 thin parallel lines on a log scale, you'll see:

- A bold "$11.5M" number front and center.
- A rich stacked landscape that grows from a small base in 2026 to a tall colorful mountain by 2066.
- Dashed lines marking $1M, $5M, $10M with the crossover years visible.
- A "Today · $48k" anchor on the left that makes the journey concrete.
- Each account's contribution to your future wealth obvious at a glance from band thickness.

## Files touched

- `src/components/WealthProjectionChart.tsx` — full chart-section rewrite. Hero stat strip, stacked-area Recharts setup with gradient defs, reference lines/dots, restyled legend pills. Remove the linear/log toggle and its state. Keep all the existing simulation math, assumptions panel, live-rate seeding, and clamping logic untouched.

No DB or other component changes.