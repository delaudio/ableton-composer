---
title: Workflows
description: Practical end-to-end flows for generation, analysis, presets, and comparison.
template: docs
---

# Workflows

## 1. Generate From a Prompt

```bash
ableton-composer generate "dusty trip-hop with smoky keys and slow drums" \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai
```

Use this when you want a fast prompt-to-set workflow without prior analysis.

## 2. Analyze an Album

```bash
ableton-composer analyze sets/violator \
  --scope album \
  --artist "Depeche Mode" \
  --album "Violator"
```

This writes a hierarchical album bundle with:

- `core.json`
- `harmony.json`
- `rhythm.json`
- `arrangement.json`
- `prompt.json`
- `bundle.json`

## 3. Generate From an Album Bundle

```bash
ableton-composer generate "dark synth-pop with restrained hooks" \
  --style profiles/albums/depeche-mode/violator/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2
```

Use chunking for larger prompts or album-scale style bundles.

## 4. Generate a Preset

```bash
ableton-composer preset generate \
  profiles/presets/arturia/jun-6-v/bass.json \
  "deep analog bass" \
  --provider openai
```

This uses a preset profile plus `preset-generate.md` to create a structured parameter map.

## 5. Expand an Existing Set

```bash
ableton-composer expand sets/my-song \
  --add "Strings,FX" \
  --provider openai
```

Useful when you already have a harmonic structure and only want new supporting parts.

## 6. Compare Fidelity

```bash
ableton-composer compare \
  profiles/albums/depeche-mode/violator/bundle.json \
  sets/my-generated-song
```

This reports:

- key agreement
- BPM drift
- rhythm by role
- role presence drift

## 7. Typical Album-Style Loop

```bash
# analyze
ableton-composer analyze sets/source-album --scope album --artist "Artist" --album "Album"

# generate
ableton-composer generate "prompt" \
  --style profiles/albums/artist/album/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2

# compare
ableton-composer compare \
  profiles/albums/artist/album/bundle.json \
  sets/generated-output
```
