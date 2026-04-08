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
- `compare` compare a generated set against a reference profile or bundle
- `preset generate` create synth presets from preset profiles
- `push` write notes into Ableton Live
- `pull` import material from Live
- `import-xml` convert MusicXML/MXL to AbletonSong JSON
- `stems scan` scan a folder of audio stems into a manifest JSON
- `stems setup` create/reuse Ableton audio tracks from a stem manifest
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
ableton-composer compare <reference-profile-or-bundle> <generated-set>
```

For aggregate bundles, compare emphasizes structure, role presence, and role-level rhythm so album/artist references are not scored like exact song-to-song copies.

## Expand

```bash
ableton-composer expand <set> --add "Strings,FX" [options]
```

## Import MusicXML / MXL

```bash
ableton-composer import-xml score.mxl --chord-track --out sets/imported-song/
```

Important options:

- `--split-every <measures>`
- `--tracks "Part 1:Piano,Part 2:Lead"`
- `--chord-track [name]` generates a MIDI chord track from MusicXML harmony symbols, using `Chords` as the default track name.

When present in the source file, `import-xml` also preserves MusicXML lyrics as section/clip metadata and imports unpitched percussion via MusicXML `midi-unpitched` mappings.

## Stem Scan

```bash
ableton-composer stems scan stems/my-song/
```

Important options:

- `--name <name>` overrides the manifest name
- `--out <path>` writes to a custom file or directory

The scanner writes a structured JSON manifest with one entry per audio file. It applies deterministic filename-based classification for common stem names like `kick`, `snare`, `bass`, `vox`, `lead`, `pad`, and `fx`, and stores standardized `track_name`, `role`, `group`, and `color` fields.

Re-running the scan against the same manifest preserves manual overrides for `track_name`, `role`, `group`, and `color`.

## Stem Setup

```bash
ableton-composer stems setup stems/manifests/my-song.stems.json
```

Important options:

- `--dry-run` previews the track setup without touching Ableton

This command creates missing Ableton audio tracks from the manifest, reuses tracks with matching names, and applies manifest colors when possible.

## Presets

```bash
ableton-composer preset generate <profile.json> "<prompt>" --provider openai
```

See [Workflows](/workflows.html) for concrete end-to-end examples.
