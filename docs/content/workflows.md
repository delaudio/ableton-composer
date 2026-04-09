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

## 7. Export a Set Back to MusicXML / MXL

```bash
ableton-composer export-xml sets/imported-score \
  --out exports/imported-score.musicxml

ableton-composer export-xml sets/imported-score \
  --out exports/imported-score.mxl
```

This is the inverse interoperability path for MuseScore, Logic, and other notation-aware tools. The exporter:

- concatenates sections into one score timeline
- writes one part per track
- includes harmony symbols and lyrics when present
- packages compressed `.mxl` output when requested

## 8. Export a Set as MIDI for DAW Interoperability

```bash
ableton-composer export-midi sets/imported-score \
  --out exports/imported-score.mid
```

Use MIDI export when the target is a DAW rather than notation software. The exporter:

- writes one MIDI track per AbletonSong track
- preserves track names
- preserves tempo and time signature
- concatenates section-relative notes into one absolute song timeline

## 9. Validate a Round-Trip

```bash
ableton-composer validate-roundtrip examples/ableton-song/chord-progression.song.json --via midi
ableton-composer validate-roundtrip examples/ableton-song/chord-progression.song.json --via musicxml
```

Use this when you want to measure what is preserved across interchange formats. The report highlights:

- note match percentage
- track-name overlap
- BPM and time-signature preservation
- section-count drift
- pitch/timing/duration mismatches

## 10. Critique a Generated Set

```bash
ableton-composer critique sets/my-song \
  --rubric general \
  --provider openai \
  --out reports/my-song-critique.json
```

Use this when you want structured feedback before revising a piece. The critique is advisory rather than objective and can help identify:

- structural weaknesses
- role-balance problems
- idiomatic issues for a target instrumentation
- weak contrast or continuity between sections

Rubrics are file-based under `prompts/critique/`, so extending the system is mostly a prompt-authoring task rather than a code change.

If you want critique automatically after generation:

```bash
ableton-composer generate "moody electronic sketch with restrained hooks" \
  --style profiles/albums/example-artist/midnight-signals/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2 \
  --evaluate \
  --rubric auto
```

## 11. Compare Drift

```bash
ableton-composer compare \
  profiles/albums/example-artist/midnight-signals/bundle.json \
  sets/my-generated-song
```

This reports:

- component scores for key, BPM, structure, role presence, and rhythm
- key agreement
- BPM drift
- rhythm by role
- role presence drift

When the source is an album, artist, or collection bundle, compare weights role presence, structure, and role-level rhythm more heavily than exact track-name matches.

## 12. Scan a Stem Folder

```bash
ableton-composer stems scan /path/to/song-stems \
  --out stems/manifests/song-stems.stems.json
```

This creates a versioned stem manifest with:

- source root
- relative audio file paths
- default track names derived from filenames
- deterministic `role`, `group`, and `color` classification for common stem names
- default `display_name` and `order` fields for stable organization
- preserved manual overrides when rescanning into the same manifest

Use this as the first step before building audio-track setup and Ableton stem loading workflows.

## 13. Prepare Ableton Audio Tracks From a Stem Manifest

```bash
ableton-composer stems setup stems/manifests/song-stems.stems.json
```

Use this after scanning/classifying stems and before actual audio clip loading. The setup step:

- creates missing audio tracks
- reuses tracks when the manifest name already exists
- applies track colors from the manifest when possible

Preview only:

```bash
ableton-composer stems setup stems/manifests/song-stems.stems.json --dry-run
ableton-composer stems setup stems/manifests/song-stems.stems.json --prefix-groups
```

You can also edit `display_name` and `order` in the manifest directly when you want to override the default grouping/order rules without changing the source filenames.

## 14. Prepare a REAPER Import Script From a Stem Manifest

```bash
ableton-composer stems reaper stems/manifests/song-stems.stems.json \
  --bpm 120 \
  --time-signature 4/4
```

Use this when the next step is comping, editing, or mixing in REAPER rather than Ableton. The generated Lua script:

- creates one track per stem and imports the audio file at timeline start
- optionally groups tracks into REAPER folder tracks by stem group
- applies track colors derived from the stem manifest
- sets the target project tempo and time signature before import

Run the generated `.lua` file from REAPER's action list or script editor.

## 15. Typical Album-Style Loop

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

## 16. Export for Logic Pro

```bash
ableton-composer export-midi sets/my-song --target logic
ableton-composer export-xml sets/my-song --target logic
```

Use this when the next step is arranging or scoring in Logic Pro rather than round-tripping back into Ableton. The Logic target preset:

- prefixes part and track names with stable import order
- adds MIDI section markers from set section names
- writes MIDI key signature metadata when `meta.scale` is a simple major/minor key
- reserves channel 10 for drum-like tracks during MIDI export

## 17. Generate a Static Song Report

```bash
ableton-composer report sets/example --out reports/example-report.md
ableton-composer report sets/example --out docs/content/reports/example-report.md
```

Use this when you want a lightweight inspection page for demos, thesis material, or internal review. The report includes:

- metadata snapshot for BPM, scale, signature, sections, tracks, and notes
- section timeline SVG
- energy curve SVG
- section, track, and role presence tables
- density summaries derived from notes per bar

When saved under `docs/content/`, the generated Markdown becomes part of the Minuto docs build automatically.

## 18. Export MIDI for REAPER

```bash
ableton-composer export-midi sets/my-song --target reaper
```

Use this when the next step is arranging or editing MIDI directly in REAPER. The REAPER target preset:

- keeps original track names instead of renaming them for score import order
- adds MIDI section markers from set section names
- reserves channel 10 for drum-like tracks during MIDI export
- writes to `exports/<name>-reaper.mid` unless you override `--out`

## 19. Build an Evaluation Pack for Thesis or User Studies

```bash
ableton-composer evaluation-pack \
  sets/generated-a \
  sets/generated-b \
  --reference profiles/albums/example-artist/midnight-signals/bundle.json \
  --roundtrip midi,musicxml \
  --out reports/session-01
```

Add critique when you want qualitative feedback in the same bundle:

```bash
ableton-composer evaluation-pack \
  sets/generated-a \
  --reference profiles/albums/example-artist/midnight-signals/bundle.json \
  --roundtrip midi \
  --critique \
  --rubric auto \
  --provider openai \
  --out reports/session-02
```

The command writes:

- `evaluation-pack.json` with structured per-target results
- `README.md` with a quick human-readable summary

This is the intended bridge between generation, compare, critique, and interoperability validation when you need repeatable evaluation artifacts.

## Format Versioning

New full AbletonSong JSON outputs include a format marker:

```json
{
  "_format": {
    "name": "AbletonSong",
    "version": "0.3"
  },
  "meta": {},
  "sections": []
}
```

Set directories store the same marker in `meta.json`; loaders lift it back to the full-song level. Older unversioned files still load normally and are upgraded to the current marker the next time they are saved by a command.

## Notation Metadata Layer

MusicXML-oriented workflows can now persist an optional `notation` layer without affecting Ableton push. Typical locations are:

- `meta.notation` for key/time signature details from MusicXML
- `section.notation` for original measure bounds
- `track.notation` for part ids, source names, and clef hints
- `note.notation` for pitch spelling, note type, voice/staff, ties, and unpitched percussion display data

This keeps the core format MIDI-friendly while allowing better MusicXML export and future notation-aware features.

## Provenance Metadata

New generated and imported songs also include optional `meta.provenance` metadata. This is reproducibility context, not musical content, and Ableton push ignores it.

Typical fields include:

- `source_type`, such as `generated`, `imported-musicxml`, `imported-midi`, or `pulled-ableton`
- `source_path` and `source_format` for imports
- `provider`, `model`, `prompt_summary`, and `prompt_hash` for AI generation
- `style_profile` when generation used a profile bundle
- `transforms`, a lightweight history of operations such as `generate`, `import-xml`, `expand`, `split`, or `compile`

Older files without provenance still load normally. Commands that save the song again can add or append provenance history where practical.

## Example Corpus

The repository includes a small synthetic corpus under `examples/` for repeatable demos and smoke tests:

- `examples/ableton-song/*.song.json` for direct analysis and visualization tests
- `examples/musicxml/simple-harmony-lyrics.musicxml` for MusicXML harmony/lyrics import tests
- `examples/midi/simple-melody.mid` for MIDI import tests

Example commands:

```bash
ableton-composer analyze examples/ableton-song/multi-section-song.song.json \
  --scope song \
  --print

ableton-composer import-xml examples/musicxml/simple-harmony-lyrics.musicxml \
  --chord-track \
  --out /tmp/ac-simple-xml/

ableton-composer import-midi examples/midi/simple-melody.mid \
  --out /tmp/ac-simple-midi/
```
