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
- `validate-roundtrip` measure note/track preservation through MIDI or MusicXML export+import
- `critique` review a set with an AI rubric and structured feedback
- `evaluation-pack` build a thesis/user-study report bundle from one or more sets
- `preset generate` create synth presets from preset profiles
- `push` write notes into Ableton Live
- `pull` import material from Live
- `import-xml` convert MusicXML/MXL to AbletonSong JSON
- `export-xml` export an AbletonSong set to MusicXML/MXL
- `export-midi` export an AbletonSong set to Standard MIDI File
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
- `--evaluate`
- `--rubric <name>`
- `--eval-out <path>`
- `--live-sync`
- `--no-save`

When `--evaluate` is enabled, `generate` saves the set first and then runs the critique pipeline against the saved output. If `--eval-out` is omitted, the report is written next to the saved set as `<saved-path>.critique.json`.

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

## Validate Round-Trip

```bash
ableton-composer validate-roundtrip sets/my-song --via midi
ableton-composer validate-roundtrip sets/my-song --via musicxml
ableton-composer validate-roundtrip sets/my-song --via mxl
```

Important options:

- `--via midi|musicxml|mxl`
- `--out <path>` saves the report JSON

This command exports the set, re-imports it, and reports what survived: note counts, track names, BPM, time signature, and note-level drift.

## Critique

```bash
ableton-composer critique sets/my-song --rubric general --provider openai
```

Important options:

- `--rubric general|string-quartet|synth-pop|chicago-house`
- `--rubric auto|general|string-quartet|synth-pop|chicago-house`
- `--provider anthropic|openai|codex|claude-cli`
- `--model <model>`
- `--out <path>`

If you want the same critique step immediately after generation, use `generate --evaluate` with the same `--rubric` flag.

The critique command returns structured guidance, not objective truth. It does not modify the source set.

Named rubrics are loaded from `prompts/critique/`. Add a new Markdown file there to introduce a new critique context without changing the command implementation.

## Evaluation Pack

```bash
ableton-composer evaluation-pack sets/my-song \
  --reference profiles/albums/example-artist/midnight-signals/bundle.json \
  --roundtrip midi,musicxml
```

Important options:

- `--reference <path>`
- `--critique`
- `--rubric auto|general|string-quartet|synth-pop|chicago-house`
- `--provider anthropic|openai|codex|claude-cli`
- `--model <model>`
- `--roundtrip midi|musicxml|mxl` or comma-separated list
- `--out <dir>`

This command writes an `evaluation-pack.json` plus a Markdown summary. It is meant for thesis work, demos, and repeatable user-study material, not just console inspection.

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

When present in the source file, `import-xml` also preserves MusicXML lyrics as section/clip metadata, imports unpitched percussion via MusicXML `midi-unpitched` mappings, and writes optional `notation` metadata on the song, sections, tracks, and notes for later MusicXML round-trips.

## Export MusicXML / MXL

```bash
ableton-composer export-xml sets/my-song --out exports/my-song.musicxml
ableton-composer export-xml sets/my-song --out exports/my-song.mxl
```

Important options:

- `--out <path>` chooses `.musicxml` or `.mxl` output

The exporter concatenates sections into a single score timeline, emits one MusicXML part per track, writes harmony and lyrics when present, prefers preserved `notation` metadata for pitch spelling, clef, and note typing when available, and falls back to best-effort note spelling from the song key when notation metadata is not available.

## Export MIDI

```bash
ableton-composer export-midi sets/my-song --out exports/my-song.mid
```

Important options:

- `--out <path>` chooses the output `.mid` file

Use MIDI export for DAW interoperability when you care about notes, timing, tempo, and track separation more than notation fidelity.

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
