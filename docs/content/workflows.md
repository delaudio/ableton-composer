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

Use this workflow with your own material, licensed material, or synthetic/example sets. The reference bundle is meant to capture structural signals for your workflow, not to recreate a protected recording.

```bash
ableton-composer analyze sets/reference-collection \
  --scope album \
  --artist "Example Artist" \
  --album "Midnight Signals"
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
ableton-composer generate "moody electronic sketch with restrained hooks" \
  --style profiles/albums/example-artist/midnight-signals/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2
```

Use chunking for larger prompts or album-scale style bundles.

## 4. Generate a Preset

```bash
ableton-composer preset generate \
  profiles/presets/generic-analog-poly/bass.json \
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

## 6. Import MusicXML With Chord Symbols

```bash
ableton-composer import-xml score.mxl \
  --chord-track \
  --out sets/imported-score/
```

When the MusicXML/MXL file contains harmony symbols, the importer stores them as section-level harmony metadata. With `--chord-track`, it also creates a MIDI `Chords` track and names the chord clip from the imported progression.

When the source file contains lyrics, the importer preserves them as section/clip metadata. Unpitched percussion parts are imported through MusicXML `midi-unpitched` mappings when available.

Use a custom track name when your Ableton set already has a dedicated harmony track:

```bash
ableton-composer import-xml score.mxl \
  --chord-track "Harmony" \
  --out sets/imported-score/
```

## 7. Compare Drift

```bash
ableton-composer compare \
  profiles/albums/example-artist/midnight-signals/bundle.json \
  sets/my-generated-song
```

This reports:

- key agreement
- BPM drift
- rhythm by role
- role presence drift

## 8. Typical Album-Style Loop

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
