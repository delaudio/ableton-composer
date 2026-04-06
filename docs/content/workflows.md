---
title: Workflows
description: Practical end-to-end examples
template: docs
---

# Workflows

## Generate From a Prompt

```bash
ableton-composer generate "dusty trip-hop with smoky keys and slow drums" \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai
```

## Analyze an Album

```bash
ableton-composer analyze sets/violator \
  --scope album \
  --artist "Depeche Mode" \
  --album "Violator"
```

## Generate From an Album Bundle

```bash
ableton-composer generate "dark synth-pop with restrained hooks" \
  --style profiles/albums/depeche-mode/violator/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2
```

## Generate a Preset

```bash
ableton-composer preset generate \
  profiles/presets/arturia/jun-6-v/bass.json \
  "deep analog bass" \
  --provider openai
```

## Expand an Existing Set

```bash
ableton-composer expand sets/my-song \
  --add "Strings,FX" \
  --provider openai
```

## Compare Fidelity

```bash
ableton-composer compare \
  profiles/albums/depeche-mode/violator/bundle.json \
  sets/my-generated-song
```
