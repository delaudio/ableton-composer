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
- `research genre` create structured historical/production dossiers for prompt guidance
- `palette generate` derive a track-level operational palette from a dossier
- `compare` compare a generated set against a reference profile or bundle
- `validate-roundtrip` measure note/track preservation through MIDI or MusicXML export+import
- `critique` review a set with an AI rubric and structured feedback
- `evaluation-pack` build a thesis/user-study report bundle from one or more sets
- `report` generate a static Markdown song report / lightweight visualizer
- `render-plan` generate an engine-agnostic audio render-chain JSON plan
- `render-audio` mix existing audio stems through ffmpeg using a render plan
- `convert-audio` convert/post-process a single audio file with ffmpeg
- `preset generate` create synth presets from preset profiles
- `push` write notes into Ableton Live
- `pull` import material from Live
- `import-xml` convert MusicXML/MXL to AbletonSong JSON
- `export-xml` export an AbletonSong set to MusicXML/MXL
- `export-midi` export an AbletonSong set to Standard MIDI File
- `stems scan` scan a folder of audio stems into a manifest JSON
- `stems setup` create/reuse Ableton audio tracks from a stem manifest
- `stems reaper` generate a REAPER ReaScript from a stem manifest
- `snapshot` save and restore device states

## Generate

```bash
ableton-composer generate "<prompt>" [options]
```

Common options:

- `--tracks "Bass,Drums,Pad,Lead,Chords,FX"`
- `--style <path>`
- `--dossier <path>`
- `--palette <path>`
- `--historical-strictness strict|loose|hybrid|modern`
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

`--dossier` adds a separate knowledge layer for historical context, instrumentation families, production traits, facts, inferences, sources, and historical guardrails. It complements a style profile instead of replacing it.

`--palette` adds a track-level operational layer derived from a dossier. Use it when you want concrete per-track guidance such as instrument family, register, articulation, rhythmic behavior, and role-specific guardrails.

## Research Dossiers

```bash
ableton-composer research genre "early 80s synth-pop"
ableton-composer research genre "krautrock 1968-1976" --out research/krautrock.json
ableton-composer generate "motorik instrumental with gradual synth lift" \
  --dossier research/krautrock.json \
  --historical-strictness strict \
  --tracks "Drums,Bass,Organ,Synth,FX"
```

Important options:

- `--out <path>` writes the dossier JSON to a custom location
- `--print` prints the dossier JSON without saving
- `--historical-strictness <mode>` is used by `generate` to decide how strongly the model should obey dossier guardrails

The dossier format separates factual claims, creative inferences, source notes, and historical caveats so generation can use historically informed guardrails without collapsing into artist cloning.

Each dossier can now also include a structured `historical_guardrails` block with:

- `target_period`
- `allowed_instrument_families`
- `caution_instruments`
- `avoid_by_default`
- `historically_plausible_substitutes`
- `anachronism_policy`

These guardrails are advisory by default. They are meant to bias generation away from obvious anachronisms without turning every dossier into a rigid reconstruction.

Strictness modes:

- `strict` obey avoid/caution lists strongly and stay within period-plausible choices unless explicitly overridden
- `loose` prefer period-plausible choices but allow practical modern equivalents
- `hybrid` start from the historical palette but allow deliberate modern/anachronistic choices
- `modern` use the dossier as inspiration without enforcing period discipline

## Operational Palettes

```bash
ableton-composer palette generate research/synth-pop-80s.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX"

ableton-composer generate "melancholic pop pulse with restrained hooks" \
  --dossier research/synth-pop-80s.json \
  --palette palettes/early-80s-synth-pop-palette.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX"
```

Important options:

- `--tracks <names>` defines which tracks receive palette guidance
- `--historical-strictness <mode>` adjusts how hard the palette should lean into dossier guardrails
- `--out <path>` writes the palette JSON to a custom location
- `--print` prints the palette JSON instead of saving

The operational palette is not a preset file and not a style profile. It is a prompt-safe per-track guidance layer intended to make sound-role decisions more concrete during generation.

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
ableton-composer export-xml sets/my-song --target logic
```

Important options:

- `--out <path>` chooses `.musicxml` or `.mxl` output
- `--target <name>` enables export presets like `logic`

The exporter concatenates sections into a single score timeline, emits one MusicXML part per track, writes harmony and lyrics when present, prefers preserved `notation` metadata for pitch spelling, clef, and note typing when available, and falls back to best-effort note spelling from the song key when notation metadata is not available.

With `--target logic`, part names are prefixed in a stable import order and the default output path becomes `exports/<name>-logic.musicxml` unless you override it.

## Export MIDI

```bash
ableton-composer export-midi sets/my-song --out exports/my-song.mid
ableton-composer export-midi sets/my-song --target logic
ableton-composer export-midi sets/my-song --target reaper
```

Important options:

- `--out <path>` chooses the output `.mid` file
- `--target <name>` enables export presets like `logic` and `reaper`

Use MIDI export for DAW interoperability when you care about notes, timing, tempo, and track separation more than notation fidelity.

With `--target logic`, the exporter adds section markers, writes key signature metadata when the song scale is a simple major/minor key, reserves channel 10 for drum-like tracks, and prefixes track names with their import order for cleaner Logic sessions.

With `--target reaper`, the exporter keeps original track names, adds section markers, and still reserves channel 10 for drum-like tracks so imported MIDI lands in a cleaner REAPER session by default.

## Stem Scan

```bash
ableton-composer stems scan stems/my-song/
```

Important options:

- `--name <name>` overrides the manifest name
- `--out <path>` writes to a custom file or directory

The scanner writes a structured JSON manifest with one entry per audio file. It applies deterministic filename-based classification for common stem names like `kick`, `snare`, `bass`, `vox`, `lead`, `pad`, and `fx`, and stores standardized `track_name`, `role`, `group`, and `color` fields.

It also writes default organization metadata such as `display_name` and `order`, so track layout stays predictable across Ableton and REAPER workflows while remaining easy to override manually in the manifest.

Re-running the scan against the same manifest preserves manual overrides for `track_name`, `display_name`, `role`, `group`, `color`, and `order`.

## Stem Setup

```bash
ableton-composer stems setup stems/manifests/my-song.stems.json
```

Important options:

- `--prefix-groups` prefixes track names with their group, e.g. `[Drums] Kick`
- `--dry-run` previews the track setup without touching Ableton

This command creates missing Ableton audio tracks from the manifest, reuses tracks with matching names, and applies manifest colors when possible. Track order follows manifest organization rules, and `--prefix-groups` makes group buckets visible even without true Ableton folder tracks.

## Stem Reaper

```bash
ableton-composer stems reaper stems/manifests/my-song.stems.json
```

Important options:

- `--bpm <n>` sets the REAPER project tempo in the generated script
- `--time-signature <sig>` sets the project time signature
- `--flat` creates one flat track list instead of group folders
- `--out <path>` writes the generated `.lua` script to a custom path

This command does not require REAPER to be running. It writes a Lua ReaScript that you can run inside REAPER to create tracks, preserve stem grouping/colors, and import the referenced audio files at timeline start.

## Render Plan

```bash
ableton-composer render-plan sets/my-song
ableton-composer render-plan sets/my-song --stems stems/manifests/my-song.stems.json
```

Important options:

- `--stems <manifest>` attaches external audio stem paths to matching tracks when available
- `--sample-rate <n>` sets render sample rate in the plan
- `--bit-depth <n>` sets target bit depth
- `--channels <n>` sets channel count
- `--out <path>` writes the render-chain JSON to a custom location

The render plan is a portable contract, not a renderer. It distinguishes per-track source/instrument/effects/mix settings from the master chain and final mixdown output so future engines like ffmpeg or Pedalboard can consume the same plan.

## Render Audio

```bash
ableton-composer render-audio renders/plans/my-song.render-chain.json --dry-run
ableton-composer render-audio renders/plans/my-song.render-chain.json --normalize
```

Important options:

- `--ffmpeg-bin <path>` points to an explicit ffmpeg binary when it is not on `PATH`
- `--normalize` adds a loudness normalization stage to the mixdown
- `--dry-run` prints the ffmpeg command without executing it
- `--out <path>` overrides the mixdown target path from the plan

This is a post-processing and mixdown fallback only. It works on existing audio stems referenced by the render plan and does not synthesize MIDI or render plugins.

## Convert Audio

```bash
ableton-composer convert-audio renders/mixdown.wav --out renders/mixdown.mp3
```

Important options:

- `--ffmpeg-bin <path>` points to an explicit ffmpeg binary
- `--codec <name>` selects an ffmpeg audio codec
- `--sample-rate <n>` resamples the output
- `--channels <n>` changes channel count
- `--normalize` applies loudness normalization
- `--dry-run` prints the ffmpeg command without executing it

## Report

```bash
ableton-composer report sets/my-song --out reports/my-song.md
ableton-composer report sets/my-song --out docs/content/reports/my-song.md
```

Important options:

- `--out <path>` writes the generated Markdown report to a custom location

The report is Markdown-first so it can live in `reports/` for thesis/demo artifacts or under `docs/content/` for the Minuto site. It includes metadata, section/track tables, role presence, density summaries, and inline SVG visualizations for timeline and energy curve.

## Presets

```bash
ableton-composer preset generate <profile.json> "<prompt>" --provider openai
```

See [Workflows](/workflows.html) for concrete end-to-end examples.
