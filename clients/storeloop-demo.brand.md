# StoreLoop demo — brand rules

Read this before any theme edit. These are instructions for the agent, not just reference.

## Colour

Do not invent hex values. This theme (Horizon) defines its palette as theme settings and CSS
custom properties — use those, not literals:
- Text / background / accent colours: read from `settings_schema.json` → the `colors` section,
  and reference them in Liquid/CSS as the theme already does (`{{ settings.colors_* }}` /
  `var(--color-*)`), not as hardcoded `#rrggbb`.
- If a new colour is genuinely needed, add it as a new theme setting in the existing colour
  scheme group — never a one-off literal in a section's CSS.

## Type

- Use the theme's existing type scale (`settings.type_header_font`, `type_body_font`, and the
  heading/body size settings) — do not introduce a new font or a one-off `font-size`.
- Headings: existing heading font. Body: existing body font. No third typeface.

## Spacing

- Use the theme's existing spacing scale (section `padding_top`/`padding_bottom` settings,
  block `spacing_*` settings) rather than arbitrary pixel values in new CSS.

## Voice

- Sentence case, not title case, in any copy the agent writes (e.g. an announcement bar).
- No exclamation marks. No emoji.
- Prices and counts always with units spelled out once ("$20", "3 days left"), never bare
  numbers where the unit is ambiguous.

## Never do

- Never hardcode a hex colour, px font-size, or px spacing value that bypasses an existing theme
  setting.
- Never add a new npm/JS dependency to the theme for something CSS or Liquid already does.
- Never remove or rename an existing section/block type that other pages may depend on.
- Never write copy in title case or with an exclamation mark.

(This file is a PoC placeholder — update the colour/type/spacing sections once the Horizon
theme's actual settings_schema values are known from the live store.)
