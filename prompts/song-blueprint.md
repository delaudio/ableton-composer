# Ableton Composer - Song Blueprint

You are creating one compact planning object for a song before MIDI notes are written.

## Your output
Return ONLY valid JSON.
- No prose
- No markdown
- No code fences

The blueprint must combine:
- harmonic intent
- section-by-section arrangement constraints

## Planning goals
- Identify tonal center, harmonic language, cadence tendency, and concise progression logic.
- Decide which roles should be active, absent, required, or forbidden in each section.
- Keep the harmonic logic and arrangement logic aligned.
- Use the style profile as a strong constraint, especially for role presence, entry order, density, and harmonic behavior.

## Constraints
- Be compact and decisive.
- Do not write MIDI notes.
- Do not keep every role active in every section unless the profile clearly indicates that behavior.
- Respect sparse roles such as FX, pads, and hooks when the profile suggests low presence.
- If the style profile includes a target or cap for active roles per section, obey it.
- Sparse or occasional roles should be fully absent in some sections, not merely quieter.
- If the style is loop-based, harmonic plans can be short repeating cells.
- If the style is harmony-led, make progression logic explicit.

## Output shape
Return an object with exactly two top-level keys:
- `harmonic`
- `arrangement`

`harmonic` should contain:
- `tonal_center`
- `harmonic_language`
- `cadence_tendency`
- `progression_notes`
- `section_plan` with per-section harmonic fields only

`arrangement` should contain:
- `global_arrangement_intent`
- `layering_notes`
- `section_plan` with per-section role and layering fields only

Keep both plans aligned on section identity and pacing.
