---
title: CLI Reference
description: Main commands and options
template: docs
---

# CLI Reference

## Main Commands

- `generate` create a song from a prompt
- `expand` add tracks to existing sections
- `analyze` extract song, album, artist, or collection profiles
- `compare` compare a generated set against a source profile or bundle
- `preset generate` create synth presets from preset profiles
- `push` write notes into Ableton Live
- `pull` import material from Live
- `snapshot` save and restore device states

## Generate

```bash
ableton-composer generate "<prompt>" [options]
```

Common options:

- `--tracks "Bass,Drums,Pad,Lead,Chords,FX"`
- `--style <path>`
- `--provider anthropic|openai|codex|claude-cli`
- `--model <model>`
- `--sections <n>`
- `--chunk-size <n>`
- `--continue <set>`
- `--variations <n>`
- `--live-sync`
- `--no-save`

## Analyze

```bash
ableton-composer analyze <targets...> [options]
```

Important options:

- `--scope song|album|artist|collection`
- `--artist <name>`
- `--album <name>`
- `--song <name>`
- `--out <path>`
- `--print`

## Compare

```bash
ableton-composer compare <source-profile-or-bundle> <generated-set>
```

## Expand

```bash
ableton-composer expand <set> --add "Strings,FX" [options]
```

## Presets

```bash
ableton-composer preset generate <profile.json> "<prompt>" --provider openai
```

See [Workflows](/workflows.html) for concrete end-to-end examples.
