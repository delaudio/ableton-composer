---
title: Profiles
description: Hierarchical style profiles and bundles
template: docs
---

# Profiles

## Scopes

Profiles can be saved as:

- `song`
- `album`
- `artist`
- `collection`

## Directory Layout

```text
profiles/
  songs/
  albums/
  artists/
  collections/
```

Example:

```text
profiles/
  albums/
    depeche-mode/
      violator/
        core.json
        harmony.json
        rhythm.json
        arrangement.json
        prompt.json
        bundle.json
```

## Domains

- `core.json` key, tempo, structure, arrangement, pitch summaries
- `harmony.json` harmonic rhythm, chord vocabulary, progressions, bass motion
- `rhythm.json` onset density, syncopation, step patterns
- `arrangement.json` energy curve, layer combinations, entry order, section-level role signals
- `prompt.json` compact prompt-ready profile distilled from the domains above
- `bundle.json` manifest that links the profile domains together

## Why `prompt.json` Exists

Album bundles can be too large for clean prompting. `prompt.json` compresses the useful musical signals into a smaller context:

- role presence
- role constraints
- section-level active/inactive role signals
- section-position archetypes for aggregate bundles
- harmonic behavior
- rhythmic fingerprints
- arrangement hints

`generate --style bundle.json` automatically prefers `prompt.json`.
