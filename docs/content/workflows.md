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

- component scores for key, BPM, structure, role presence, and rhythm
- key agreement
- BPM drift
- rhythm by role
- role presence drift

When the source is an album, artist, or collection bundle, compare weights role presence, structure, and role-level rhythm more heavily than exact track-name matches.

## 8. Scan a Stem Folder

```bash
ableton-composer stems scan /path/to/song-stems \
  --out stems/manifests/song-stems.stems.json
```

This creates a versioned stem manifest with:

- source root
- relative audio file paths
- default track names derived from filenames
- placeholder `role`, `group`, and `color` fields for later classification

Use this as the first step before building audio-track setup and Ableton stem loading workflows.

## 9. Typical Album-Style Loop

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

## Format Versioning

New full AbletonSong JSON outputs include a format marker:

```json
{
  "_format": {
    "name": "AbletonSong",
    "version": "0.2"
  },
  "meta": {},
  "sections": []
}
```

Set directories store the same marker in `meta.json`; loaders lift it back to the full-song level. Older unversioned files still load normally and are upgraded to the current marker the next time they are saved by a command.

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
