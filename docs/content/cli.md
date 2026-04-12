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
- `plugins scan` build a local AU/VST/VST3/CLAP inventory
- `plugins list` inspect a saved plugin inventory
- `plugins enrich` annotate installed plugins with emulation and historical metadata
- `plugins match` compare installed plugins against a research dossier
- `preset plan` map dossier/palette roles to preset profiles and installed devices
- `palette generate` derive a track-level operational palette from a dossier
- `compare` compare a generated set against a reference profile or bundle
- `validate-roundtrip` measure note/track preservation through MIDI or MusicXML export+import
- `critique` review a set with an AI rubric and structured feedback
- `evaluation-pack` build a thesis/user-study report bundle from one or more sets
- `report` generate a static Markdown song report / lightweight visualizer
- `transcribe` convert an audio sketch to MIDI and optionally to an AbletonSong
- `separate` split a mixed audio file into stems with an optional external engine
- `render-plan` generate an engine-agnostic audio render-chain JSON plan
- `render-audio` mix existing audio stems through ffmpeg using a render plan
- `convert-audio` convert/post-process a single audio file with ffmpeg
- `render-stems` use an optional Pedalboard Python worker on existing audio stems
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

## Plugins

```bash
ableton-composer plugins scan
ableton-composer plugins enrich
ableton-composer plugins match research/synth-pop-80s.json
ableton-composer plugins scan --formats au,vst3,clap
ableton-composer plugins list
ableton-composer plugins list --no-prompt-safe
```

Important options:

- `plugins scan --formats au,vst,vst3,clap` limits the scan to selected formats
- `plugins scan --out <path>` writes the inventory JSON somewhere other than `plugins/inventory.json`
- `plugins scan --print` prints the inventory JSON instead of saving it
- `plugins scan --print --prompt-safe` prints a filtered view with path hashes instead of full paths
- `plugins list --inventory <path>` reads a specific inventory file
- `plugins list --no-prompt-safe` shows full local paths for manual inspection
- `plugins enrich --inventory <path>` reads an existing inventory and adds local enrichment metadata
- `plugins match <dossier>` produces recommended, caution, and avoid buckets against a dossier
- `plugins match --no-prompt-safe` shows full local paths in the printed match report

The inventory stays local by default. The saved JSON can include full paths because it is meant for your machine, but the default list view is prompt-safe and shows hashed paths instead of raw filesystem locations. This keeps later AI-facing integrations able to consume a filtered inventory without exposing unnecessary local path data.

`plugins enrich` is deterministic in this first version: it uses local heuristics and a small catalog of known emulation patterns to add fields such as:

- `emulates`
- `original_release_period`
- `synthesis_type`
- `instrument_families`
- `role_suitability`
- `historical_tags`
- `caution_for_periods`

`plugins match` uses the dossier topic, instrumentation families, and historical guardrails to score installed plugins into `recommended`, `caution`, and `avoid` lists. This is the layer that makes examples like a Juno-style installed substitute show up as a practical recommendation instead of naming plugins that are not installed.

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

## Revise

```bash
ableton-composer revise sets/my-song --critique reports/my-song.critique.json --provider openai
ableton-composer revise sets/my-song --rubric auto --provider openai --out sets/my-song-revised/
```

Important options:

- `--critique <path>` reuses an existing critique JSON instead of generating one inline
- `--rubric <name>` selects the rubric when critique is generated inline
- `--provider anthropic|openai|codex|claude-cli`
- `--model <model>`
- `--out <path>`

This command performs a second-pass structured rewrite of an existing AbletonSong. It feeds the current song plus either a saved critique or an inline-generated critique back into the model and asks for a revised full song JSON, keeping the workflow symbolic rather than audio-derived.

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

Current limitation: this workflow prepares Ableton tracks only. With the current `ableton-js` API surface, `ableton-composer` cannot yet import external audio files into Session View clip slots directly, so loading the actual stem audio still requires manual drag-and-drop in Live or a different host workflow such as the generated REAPER import script.

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

## Render Stems

```bash
ableton-composer render-stems renders/plans/my-song.render-chain.json --dry-run
ableton-composer render-stems renders/plans/my-song.render-chain.json --out renders/my-song/pedalboard/
```

Important options:

- `--engine pedalboard` selects the optional Python/Pedalboard worker
- `--python-bin <path>` points to the Python interpreter to use
- `--worker <path>` overrides the default worker script path
- `--dry-run` prints the worker command without executing it
- `--out <dir>` overrides the output directory for rendered stems

This integration is optional and requires a Python environment with `pedalboard` installed. The current proof of concept is deliberately narrow: it operates on existing external audio stems from a render plan and does not synthesize MIDI or act like a full DAW mixer.

## Report

```bash
ableton-composer report sets/my-song --out reports/my-song.md
ableton-composer report sets/my-song --out docs/content/reports/my-song.md
```

Important options:

- `--out <path>` writes the generated Markdown report to a custom location

The report is Markdown-first so it can live in `reports/` for thesis/demo artifacts or under `docs/content/` for the Minuto site. It includes metadata, section/track tables, role presence, density summaries, and inline SVG visualizations for timeline and energy curve.

## Transcribe

```bash
ableton-composer transcribe audio/idea.wav --engine basic-pitch --out midis/idea.mid
ableton-composer transcribe audio/idea.wav --to-set sets/idea/
ableton-composer transcribe audio/song.wav --separate-first --stem vocals --to-set sets/song-vocal-line/
ableton-composer transcribe audio/piano.wav --engine klangio --out midis/piano.mid --xml-out exports/piano.musicxml
```

Important options:

- `--engine basic-pitch|klangio` selects the transcription backend
- `--basic-pitch-bin <path>` points to an explicit `basic-pitch` CLI
- `--klangio-api-key <key>` or `KLANGIO_API_KEY` enables the optional Klangio service workflow
- `--xml-out <path>` saves MusicXML when the selected engine supports it
- `--prefer-musicxml` imports MusicXML into `--to-set` when available
- `--refresh-cache` forces a fresh Klangio upload instead of reusing cached artifacts
- `--separate-first` runs Demucs before transcription
- `--stem <name>` selects which separated stem to transcribe when `--separate-first` is enabled
- `--demucs-bin <path>` points to an explicit `demucs` CLI for `--separate-first`
- `--separation-out <dir>` overrides where the separated stems are written
- `--out <path>` overrides the MIDI output path
- `--to-set <path>` imports the generated MIDI or MusicXML into an AbletonSong directory or `.json`
- `--dry-run` prints the command without executing it

This workflow is optional and requires the Basic Pitch CLI to be installed separately, typically via `pip install basic-pitch`. It works best on monophonic or lightly polyphonic single-instrument audio. When `--to-set` is used, the imported song carries transcription provenance including source audio path, hash, engine, and generated MIDI path.

If you pass a separated stem file directly, or use `--separate-first --stem <name>`, the provenance also links the transcription back to the original source audio and the `separation.json` metadata. This is the recommended path when you want better transcription quality than a full-mix pass can provide.

`--engine klangio` is an optional online workflow. It uploads the input audio to the Klangio API, caches returned symbolic artifacts under `transcriptions/cache/klangio/`, and can save both MIDI and MusicXML locally. Missing credentials fail cleanly, and `--refresh-cache` lets you bypass the local cache when you want a fresh remote run.

## Separate

```bash
ableton-composer separate audio/song.wav --engine demucs
ableton-composer separate audio/song.wav --out stems/separated/song/
ableton-composer separate audio/song.wav --manifest
```

Important options:

- `--engine demucs` selects the optional source-separation workflow
- `--demucs-bin <path>` points to an explicit `demucs` CLI
- `--model <name>` chooses the Demucs model name
- `--out <dir>` overrides the output directory
- `--manifest` also writes a standard `.stems.json` manifest for the separated output
- `--manifest-out <path>` overrides the manifest path when `--manifest` is enabled
- `--dry-run` prints the command without executing it

This workflow is optional and requires the Demucs CLI to be installed separately, typically via `pip install demucs`. The current MVP writes a normalized output directory with expected stem names such as `drums`, `bass`, `vocals`, and `other`, plus a `separation.json` provenance file that records the source audio path, source hash, engine, model, and output stem paths. When `--manifest` is enabled, the command immediately bridges into the existing stem-manifest workflow by writing a standard `.stems.json` file with separation provenance attached.

## Presets

```bash
ableton-composer preset plan research/synth-pop-80s.json --palette palettes/early-80s-synth-pop-palette.json --installed-only
ableton-composer preset generate <profile.json> "<prompt>" --provider openai
```

Important options:

- `preset plan <dossier>` builds a role-aware preset plan from a dossier
- `preset plan --palette <path>` uses an operational palette instead of only dossier role hints
- `preset plan --inventory <path>` reads a specific plugin inventory
- `preset plan --installed-only` keeps only candidates confirmed by the local inventory
- `preset plan --print` prints the plan JSON instead of saving it

The preset planner connects dossier guardrails, palette roles, preset profiles under `profiles/presets/`, and the enriched plugin inventory. Its output includes:

- per-role preset prompts
- recommended preset profiles
- installed-device preference when available
- rationale and warnings when only weak or off-period candidates exist

See [Workflows](/workflows.html) for concrete end-to-end examples.
