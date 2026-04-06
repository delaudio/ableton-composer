# ableton-composer

CLI that uses AI models to generate structured MIDI content for Ableton Live. Describe a song in natural language, get a JSON with notes for every track, push it directly into your Live set. Analyze existing sets to extract style profiles and use them to guide future generations.

```bash
# Generate a set guided by an existing style
ableton-composer generate "melancholic IDM, 12 sections, 8 bars each" \
  --style profiles/saw85-92-a-minor-110bpm.json

# Push into Ableton (creates tracks and scenes automatically)
ableton-composer push sets/idm-110bpm_2026-04-05.json --setup
```

---

## How it works

```
Existing sets / MIDI / MusicXML
      ↓
  analyze / import-midi / import-xml    ingest or extract style profiles
      ↓
  profiles/...        hierarchical song/album/artist profiles plus bundle.json
      ↓
  generate --style    base task prompt + optional genre/harmony overlays + profile context
      ↓
  expand              The selected model adds new tracks to existing sections (harmonic-aware)
      ↓
  sets/*.json         saved to disk
      ↓
  push                writes notes into Live clip slots via ableton-js
      ↓
  Ableton Live        clips ready in session view, one row per section
      ↓
  snapshot            save/restore device parameter states per track
      ↓
  compare             measure how faithful the generation is to the source style
```

Each **section** in the JSON maps to a **scene row** in session view. Trigger a scene to audition that part of the song.

---

## Requirements

- Node.js >=18
- Ableton Live with the **ableton-js MIDI Remote Script** active (see Setup)
- One of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or Claude Code CLI installed (`--provider cli`)

---

## Setup

```bash
git clone https://github.com/delaudio/ableton-composer
cd ableton-composer
npm install

cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY and/or OPENAI_API_KEY, plus optional weather coordinates
```

### Install globally

```bash
npm link
```

This creates a symlink so you can run `ableton-composer` from any directory. To unlink: `npm unlink -g ableton-composer`.

### Install the MIDI Remote Script

`ableton-js` communicates with Live via a Python MIDI Remote Script — not a Max for Live patch.

**1. Copy the script:**

```bash
cp -r node_modules/ableton-js/midi-script \
      ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonJS
```

**2. Activate in Ableton:** `Preferences → Link / MIDI → Control Surfaces` → pick **AbletonJS** in any slot.

Restart Ableton if already open. The script activates automatically on every launch.

---

## Commands

### `generate`

Generate a song JSON from a natural language prompt.

```bash
ableton-composer generate "<prompt>" [options]
```

| Option | Description |
|---|---|
| `-t, --tracks <names>` | Comma-separated track names, e.g. `"Bass,Drums,Chords,Lead"` |
| `-L, --live-sync` | Auto-detect track names from the open Live set |
| `-s, --style <path>` | Style profile JSON to guide generation (from `analyze`) |
| `-c, --continue <file>` | Existing set to extend — new sections are appended |
| `-V, --variations <n>` | Generate N variations and save each one |
| `-S, --sections <n>` | Total number of sections to generate |
| `--chunk-size <n>` | Generate in chunks of N sections per API call (use with `--sections`) |
| `--provider <name>` | `api`/`anthropic` (default), `openai`, `codex`, or `cli`/`claude-cli` |
| `-w, --weather` | Fetch current weather and include as context |
| `-m, --model <model>` | Model override (otherwise uses the provider default env var) |
| `-n, --name <name>` | Name hint for the saved set directory |
| `-o, --output <path>` | Save to a specific path — directory if no `.json` extension, flat file if `.json` |
| `--no-save` | Print JSON to stdout without saving |

OpenAI runtime env vars:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` default `gpt-5.2`
- `OPENAI_TIMEOUT_MS` default `120000`
- `OPENAI_MAX_RETRIES` default `0`

`generate` uses a modular prompt stack:
- base task prompt: [prompts/song-generate.md](/Users/fdg/dev/side/ableton-composer/prompts/song-generate.md)
- optional genre overlay: for example [prompts/genre/idm.md](/Users/fdg/dev/side/ableton-composer/prompts/genre/idm.md)
- optional harmonic/compositional overlay: for example [prompts/harmony/jazz.md](/Users/fdg/dev/side/ableton-composer/prompts/harmony/jazz.md)
- optional harmonic planning stage: [prompts/harmonic-plan.md](/Users/fdg/dev/side/ableton-composer/prompts/harmonic-plan.md)
- optional arrangement planning stage: [prompts/arrangement-plan.md](/Users/fdg/dev/side/ableton-composer/prompts/arrangement-plan.md)
- optional combined planning stage when both are needed: [prompts/song-blueprint.md](/Users/fdg/dev/side/ableton-composer/prompts/song-blueprint.md)
- optional style profile from `--style`
- the full song schema

At the moment, the repo includes:
- an automatic IDM genre overlay for cues like `idm`, `glitch`, `braindance`, or `leftfield`
- an automatic trip-hop genre overlay for cues like `trip-hop`, `trip hop`, `Bristol`, or `downtempo noir`
- an automatic Chicago house genre overlay for cues like `chicago house`, `jackin house`, `warehouse house`, or `classic house`
- an automatic neo-soul harmonic overlay for cues like `neo-soul`, `neo soul`, `soul-jazz`, `modern r&b`, `D'Angelo`, or `Erykah Badu`
- an automatic blues harmonic overlay for cues like `blues`, `blues-rock`, `shuffle blues`, `boogie`, or `12-bar`
- an automatic jazz harmonic overlay for cues like `jazz`, `bebop`, `swing`, `modal jazz`, `ii-v-i`, or `2-5-1`

When a harmonic overlay is active, `generate` now first asks the model for a compact harmonic plan, then includes that plan in the final song-generation request. This gives harmony-led genres more structure than prompt text alone.

**Examples:**

```bash
# Guided by a style profile (track names inferred automatically)
ableton-composer generate "melancholic IDM, 12 sections, 8 bars each" \
  --style profiles/saw85-92-a-minor-110bpm.json

# Generate 3 variations and pick the best one
ableton-composer generate "ambient drone, 4 sections" \
  --style profiles/saw85-92.json --variations 3

# Extend an existing set with 4 more sections
ableton-composer generate "add breakdown, buildup, climax, and fade-out" \
  --continue sets/my-song.json --style profiles/saw85-92.json

# Use Claude Code CLI instead of the API (no API key needed)
ableton-composer generate "trip-hop 90 BPM" --provider cli

# Use OpenAI
ableton-composer generate "glitchy IDM at 118 BPM" --provider openai

# Use Codex via the OpenAI Responses API
ableton-composer generate "minimal techno, 6 sections" --provider codex

# IDM prompt overlay is inferred automatically from the request
ableton-composer generate "braindance with glitchy drums and warped bass" --provider openai

# Trip-hop genre overlay is inferred automatically from the request
ableton-composer generate "dusty trip-hop with smoky keys and slow drums" --provider openai

# Chicago house genre overlay is inferred automatically from the request
ableton-composer generate "classic Chicago house with piano stabs and jackin bass" --provider openai

# Jazz harmonic overlay is inferred automatically from the request
ableton-composer generate "slow jazz ballad with ii-V-I movement" --provider openai

# Neo-soul harmonic overlay is inferred automatically from the request
ableton-composer generate "warm neo-soul with Rhodes chords and laid-back bass" --provider openai

# Blues harmonic overlay is inferred automatically from the request
ableton-composer generate "slow 12-bar blues with shuffle drums and electric piano" --provider openai

# Auto-detect tracks from open Live set
ableton-composer generate "slow cinematic ambient" --live-sync

# Weather as generative seed
ableton-composer generate "reflect today's weather as ambient" \
  --tracks "Pad,Bass,Melody" --weather

# Generate exactly 16 sections in two API calls (avoids token limits)
ableton-composer generate "dark techno, 8 bars each" \
  --sections 16 --chunk-size 8
```

---

### `expand`

Add new accompaniment tracks to an existing set using the selected AI provider. The model receives a harmonic summary (pitch classes per bar) of each section and writes complementary parts for the requested instruments without touching the existing tracks.

```bash
ableton-composer expand <file> --add <tracks> [options]
```

| Option | Description |
|---|---|
| `--add <tracks>` | **Required.** Comma-separated track names to add, e.g. `"Strings,Cello,Bass"` |
| `-s, --style <hint>` | Style description to guide the model, e.g. `"orchestral ambient"` |
| `--sections <names>` | Only expand specific sections (comma-separated) |
| `--overwrite` | Replace tracks that already exist in a section |
| `--dry-run` | Show what would be added without calling the model |
| `-o, --out <path>` | Save to a new file instead of updating the source |
| `--provider <name>` | `api`/`anthropic` (default), `openai`, `codex`, or `cli`/`claude-cli` |
| `-m, --model <model>` | Model override |

**Examples:**

```bash
# Add strings and cello to every section
ableton-composer expand sets/my-song.json --add "Strings,Cello"

# Add bass with an orchestral style hint
ableton-composer expand sets/my-song.json --add "Bass" --style "orchestral ambient"

# Only expand the intro and verse, save to a new file
ableton-composer expand sets/my-song.json --add "Strings,Bass" \
  --sections "intro,verse" --out sets/my-song-orchestrated.json
```

---

### `analyze`

Extract a style profile from one or more sets. The profile captures key/mode, BPM, track presence, rhythm density, pitch ranges, and chord vocabulary — and can be passed directly to `generate --style`.

```bash
ableton-composer analyze <targets...> [options]
```

| Option | Description |
|---|---|
| `--out <path>` | Save profile to a specific path instead of the hierarchical `profiles/` tree |
| `--scope <name>` | Profile scope: `song`, `album`, `artist`, or `collection` |
| `--artist <name>` | Artist label for hierarchical profile output |
| `--album <name>` | Album label for hierarchical profile output |
| `--song <name>` | Song label for hierarchical profile output |
| `--print` | Print JSON to stdout instead of saving |

**Examples:**

```bash
# Single set → profile saved to profiles/
ableton-composer analyze sets/saw85-92-a-minor-110bpm/

# Album-scoped profile bundle
ableton-composer analyze sets/violator/ --scope album --artist "Depeche Mode" --album "Violator"

# Multiple sets passed directly → aggregated profile
ableton-composer analyze sets/song-a.json sets/song-b/ sets/song-c.json

# Collection directory (contains set subdirectories) → aggregated profile
ableton-composer analyze sets/idm-collection/

# Flat JSON file
ableton-composer analyze sets/my-song.json

# Print to stdout
ableton-composer analyze sets/my-song/ --print
```

**Profile output:**

```
 Style Profile — sets/saw85-92-a-minor-110bpm

  Key & Tempo
    Key:            A minor  (confidence: 0.95)
    BPM:            110
    Time signature: 4/4

  Arrangement
    Pad          ██████████  100%
    Arp          ████████░░  75%
    Drums        ███████░░░  67%

  Rhythm  (notes/bar)
    Arp          7.1
    Drums        9.3

  Chords  (most frequent per track)
    Pad          A-C-E-G×2  A-C-F×1
```

Use the saved profile with `generate --style` or `compare`.

By default, `analyze` now saves into a hierarchical tree and writes both `core.json` and `bundle.json`. Example:

```text
profiles/
  albums/
    depeche-mode/
      violator/
        core.json
        harmony.json
        rhythm.json
        arrangement.json
        bundle.json
```

`generate --style` accepts either `core.json` or `bundle.json`.

`bundle.json` is preferred because it can include multiple profile domains. Right now `analyze` writes:
- `core.json`: key, tempo, structure, arrangement, rhythm, pitch summary
- `harmony.json`: harmonic rhythm, top chord vocabulary, common chord transitions, and bass-root motion
- `rhythm.json`: average section density, per-track syncopation, onset histograms, and dominant step patterns
- `arrangement.json`: section energy, track entry order, and recurring layer combinations
- `prompt.json`: compact prompt-ready profile distilled from the domains above for use in `generate`

When you pass `bundle.json` to `generate`, the CLI now prefers `prompt.json` automatically instead of loading the full raw bundle into the prompt. This keeps large album bundles practical for OpenAI and chunked generation.

---

## Prompt Structure

Song generation is now organized as composable prompt files instead of a single monolithic system prompt.

- [prompts/song-generate.md](/Users/fdg/dev/side/ableton-composer/prompts/song-generate.md): base rules for writing full Ableton song JSON
- [prompts/genre/idm.md](/Users/fdg/dev/side/ableton-composer/prompts/genre/idm.md): genre-specific stylistic overlay for IDM and glitch-oriented requests
- [prompts/genre/trip-hop.md](/Users/fdg/dev/side/ableton-composer/prompts/genre/trip-hop.md): genre-specific overlay for slow, dusty, moody trip-hop writing
- [prompts/genre/chicago-house.md](/Users/fdg/dev/side/ableton-composer/prompts/genre/chicago-house.md): genre-specific overlay for classic Chicago house groove, layering, and arrangement logic
- [prompts/harmonic-plan.md](/Users/fdg/dev/side/ableton-composer/prompts/harmonic-plan.md): planning-stage prompt that creates a compact harmonic/compositional plan before note generation
- [prompts/arrangement-plan.md](/Users/fdg/dev/side/ableton-composer/prompts/arrangement-plan.md): planning-stage prompt that creates a compact section-by-section role and layering plan before note generation
- [prompts/song-blueprint.md](/Users/fdg/dev/side/ableton-composer/prompts/song-blueprint.md): planning-stage prompt that combines harmonic and arrangement planning into one compact blueprint when both are needed
- [prompts/harmony/jazz.md](/Users/fdg/dev/side/ableton-composer/prompts/harmony/jazz.md): harmonic grammar overlay for jazz-influenced writing, including ii-V-I style motion
- [prompts/harmony/neo-soul.md](/Users/fdg/dev/side/ableton-composer/prompts/harmony/neo-soul.md): harmonic grammar overlay for neo-soul and modern R&B-influenced chord language
- [prompts/harmony/blues.md](/Users/fdg/dev/side/ableton-composer/prompts/harmony/blues.md): harmonic grammar overlay for 12-bar blues, dominant-function movement, and turnaround-driven writing
- [prompts/preset-generate.md](/Users/fdg/dev/side/ableton-composer/prompts/preset-generate.md): dedicated system prompt for preset generation from preset profiles
- [prompts/expand.md](/Users/fdg/dev/side/ableton-composer/prompts/expand.md): harmonic-aware track expansion prompt

This makes it easier to add more genre behaviors and harmonic grammars later, while also giving harmony-led styles a more explicit intermediate plan before the final MIDI is written.

---

### `compare`

Compare two sets or profiles to measure style fidelity — useful for evaluating how closely a generated set matches the source style.

```bash
ableton-composer compare <source> <generated> [options]
```

Accepts set directories, flat JSON sets, or pre-saved profile JSONs as inputs.

| Option | Description |
|---|---|
| `--out <path>` | Save the comparison report as JSON |

**Example:**

```bash
ableton-composer compare sets/saw85-92-a-minor-110bpm sets/idm-generated.json
```

```
 Style Fidelity Report
  source:    sets/saw85-92-a-minor-110bpm
  generated: sets/idm-generated.json

  Fidelity   ████████░░  80%

  Key
    ✓ A minor  →  A minor

  Rhythm density  (notes/bar: source → generated)
    ✓ Pad          1.2 → 0.9 ×0.75
    ~ Arp          7.1 → 5.1 ×0.72
    ✓ Bass         1.9 → 2.0 ×1.05

  Pitch range overlap
    ✓ Pad          ██████████  100%
    ✓ Arp          ██████████  100%

  Chord vocabulary overlap
    ~ Pad          33% common: B-D-G
```

---

### `push`

Push a saved song JSON into the current Ableton Live set.

```bash
ableton-composer push <file> [options]
```

| Option | Description |
|---|---|
| `--overwrite` | Replace existing clips in target slots |
| `--dry-run` | Show what would be pushed without writing to Live |
| `--sections <names>` | Only push specific sections, e.g. `"intro,verse"` |
| `--setup` | Create any missing MIDI tracks and scenes before pushing |
| `--humanize [profile]` | Apply humanization before writing notes (default profile: `loose`) |

**Examples:**

```bash
# Push into an empty Live set — create tracks and scenes automatically
ableton-composer push sets/my-song.json --setup

# Push with MPC-style swing
ableton-composer push sets/my-song.json --humanize swing

# Push with custom humanization params
ableton-composer push sets/my-song.json --humanize '{"swing":0.6,"timing":0.02}'

# Push everything, replacing existing clips
ableton-composer push sets/my-song.json --overwrite

# Preview first
ableton-composer push sets/my-song.json --dry-run

# Push only one section
ableton-composer push sets/my-song.json --sections drop

# List all humanize profiles
ableton-composer push --humanize list
```

`--setup` reads track names from the song JSON, creates any that are missing, and adds scenes until the Live set has enough rows.

---

### Humanization profiles

Applied at push time — the source JSON is never modified. Drum tracks are excluded from swing but still receive timing and velocity variation.

| Profile | Description | Swing | Timing | Velocity |
|---|---|---|---|---|
| `tight` | Studio — barely noticeable imperfections | — | ±0.01b | ±7% |
| `loose` | Natural — like a good live drummer | — | ±0.025b | ±14% |
| `swing` | MPC light swing — 16th off-beats at ~57% | 0.57 | ±0.01b | ±10% |
| `swing-heavy` | Triplet swing — 16th off-beats at ~65% | 0.65 | ±0.015b | ±12% |
| `vinyl` | Warm vinyl — subtle swing with timing drift | 0.54 | ±0.02b | ±12% |
| `idm` | Glitchy IDM — strong irregular timing | — | ±0.04b | ±22% |

Custom params are also accepted as JSON: `--humanize '{"swing":0.6,"timing":0.015,"velocity":0.1}'`

---

### `pull`

Read clips from the current Ableton Live set and save them as a song JSON. Useful for capturing edits made directly in Live.

```bash
ableton-composer pull [options]
```

| Option | Description |
|---|---|
| `--scene <index>` | Only pull a specific scene row (0-based) |
| `--name <name>` | Label for the pulled section(s) |
| `--out <path>` | Save into a set directory or flat file |
| `--add-to <file>` | Merge pulled sections into an existing flat JSON |
| `--replace` | When merging, replace sections with the same name |
| `--from-arrangement` | Pull from arrangement view, split by cue points (locators) |
| `--split-every <bars>` | Fallback: split every N bars when no cue points exist (default: 8) |

**Examples:**

```bash
# Pull all scenes → new flat JSON in sets/
ableton-composer pull

# Pull scene 2 labelled "bridge"
ableton-composer pull --scene 2 --name bridge

# Import a MIDI arrangement, split by locators
ableton-composer pull --from-arrangement --out sets/my-song/

# Import arrangement with no locators, split every 8 bars
ableton-composer pull --from-arrangement --split-every 8
```

---

### `clear`

Remove clips from the current Ableton Live set.

```bash
ableton-composer clear [options]
```

| Option | Description |
|---|---|
| `--arrangement` | Clear arrangement clips instead of session view |
| `--all` | Clear both session and arrangement |
| `--tracks <names>` | Only clear specific tracks |
| `--scenes <indices>` | Only clear specific scene rows, e.g. `"0,1,2"` |
| `--dry-run` | Preview without making changes |

---

### `arrange`

Place session view clips into the arrangement timeline sequentially.

```bash
ableton-composer arrange <file> [options]
```

| Option | Description |
|---|---|
| `--start <bars>` | Start position in bars (default: `0`) |
| `--gap <bars>` | Gap in bars between sections (default: `0`) |
| `--sections <names>` | Only arrange specific sections |
| `--dry-run` | Preview the layout without writing to Ableton |

```bash
ableton-composer arrange sets/my-song.json
ableton-composer arrange sets/my-song.json --start 8 --gap 2
```

---

### `import-midi`

Convert a `.mid` file directly to an AbletonSong JSON — no Ableton Live required.

```bash
ableton-composer import-midi <file.mid> [options]
```

| Option | Description |
|---|---|
| `-n, --name <name>` | Name hint for the output file and section(s) |
| `-o, --out <path>` | Save to a specific path (directory or `.json` file) |
| `--split-every <bars>` | Split the file into sections every N bars (default: one section) |
| `-t, --tracks <names>` | Rename tracks: positional `"Bass,Drums"` or mapped `"Piano:Pad,Bass:Bass"` |

**Examples:**

```bash
# Convert a MIDI file — saves to sets/ as a flat JSON
ableton-composer import-midi jazz-blues.mid --name "jazz-blues"

# Split a long MIDI file into 8-bar sections
ableton-composer import-midi song.mid --name "my-song" --split-every 8

# Save as a set directory (one file per section)
ableton-composer import-midi song.mid --out sets/my-song/

# Rename MIDI tracks to match Ableton track names (positional)
ableton-composer import-midi song.mid --tracks "Bass,Drums,Chords,Lead"

# Rename by original MIDI track name (mapped)
ableton-composer import-midi song.mid --tracks "Piano Right:Pad,Acoustic Bass:Bass"
```

Once imported, push straight into Ableton:

```bash
ableton-composer push sets/jazz-blues_<timestamp>.json --setup
```

---

### `import-xml`

Convert a MusicXML (`.xml`, `.musicxml`, `.mxl`) file to an AbletonSong JSON — no Ableton Live required. Handles ties, chord notes, grace notes, rests, and multi-part scores.

```bash
ableton-composer import-xml <file> [options]
```

| Option | Description |
|---|---|
| `-n, --name <name>` | Name hint for the output file and section(s) |
| `-o, --out <path>` | Save to a specific path (directory or `.json` file) |
| `--split-every <measures>` | Split into sections every N measures (default: one section) |
| `-t, --tracks <names>` | Rename parts: positional `"Piano,Violin"` or mapped `"Part 1:Lead"` |

**Examples:**

```bash
# Convert a MusicXML file → saves to sets/
ableton-composer import-xml score.musicxml --name "bach-invention"

# Split into 8-measure sections, rename parts
ableton-composer import-xml score.xml --split-every 8 \
  --tracks "Piano Right:Lead,Piano Left:Bass"

# Compressed .mxl format also supported
ableton-composer import-xml score.mxl --name "ensemble"
```

---

### `snapshot`

Save or restore Ableton Live device parameter snapshots. Useful for capturing synth patch states (filter cutoff, resonance, envelopes…) and recalling them later.

```bash
ableton-composer snapshot [options]
```

| Option | Description |
|---|---|
| `-t, --tracks <names>` | Only snapshot specific tracks (comma-separated) |
| `-o, --out <path>` | Save snapshot to a specific path |
| `--restore <file>` | Restore device parameters from a snapshot file |

**Examples:**

```bash
# Save all device params from the open Live set
ableton-composer snapshot

# Snapshot only specific tracks
ableton-composer snapshot --tracks "Bass,Pad,Lead"

# Save to a specific path
ableton-composer snapshot --out snapshots/my-patch.json

# Restore a saved snapshot
ableton-composer snapshot --restore snapshots/my-patch.json
```

Snapshots are stored as JSON and kept local (not committed to git).

---

### `preset`

Save and restore parameter presets for individual devices — native Ableton instruments (Analog, Operator, Wavetable…) and VST/AU plugins. A preset captures one device from one track; unlike `snapshot`, it's named and reusable across any track that has the same device.

Parameters are captured as normalized values (0–1 range) via the Live API, the same mechanism used by automation lanes. System parameters (`Device On`, `Reserved*`) are excluded by default.

```bash
# Save a preset from a track (auto-detects the device)
ableton-composer preset save "Synth 1" --name "warm-pad"

# Save a specific device when a track has multiple
ableton-composer preset save "FX Bus" --device "ValhallaSupermassive" --name "lush-hall"

# List saved presets
ableton-composer preset list

# Apply a preset to a track (targets the device by name from the preset)
ableton-composer preset load presets/warm-pad.json --track "Synth 1"

# Apply to a different track or device
ableton-composer preset load presets/warm-pad.json --track "Synth 2" --device "Wavetable"
```

| Subcommand | Description |
|---|---|
| `save <track>` | Read a device's parameters and save as a named preset |
| `load <file>` | Apply a preset's parameters to a device on a track |
| `list` | List all presets in `presets/` |

**`save` options:**

| Option | Description |
|---|---|
| `-d, --device <name>` | Device name (required if track has multiple devices) |
| `-n, --name <name>` | Preset name (defaults to device name) |
| `-o, --out <path>` | Save to a specific path instead of `presets/` |
| `--all-params` | Include system params (`Device On`, `Reserved*`) |

**`load` options:**

| Option | Description |
|---|---|
| `-t, --track <name>` | **Required.** Target track name |
| `-d, --device <name>` | Device name override (defaults to preset's device name) |

**Preset format:**

```json
{
  "name": "lush-hall",
  "device": "ValhallaSupermassive",
  "device_class": "ValhallaSupermassive",
  "device_type": "audio_effect",
  "source_track": "FX Bus",
  "created_at": "2026-04-06T10:00:00.000Z",
  "parameters": {
    "Mix": 0.5,
    "Feedback": 0.6,
    "Width": 1.0,
    "Mode": 0.04
  }
}
```

Presets are stored in `presets/` and kept local (not committed to git). If a plugin version changes and some parameters no longer exist, they are skipped with a warning.

---

### `split` / `compile`

Convert between flat JSON and set directory format.

```bash
ableton-composer split sets/my-song.json         # → sets/my-song/
ableton-composer compile sets/my-song/            # → sets/my-song_<timestamp>.json
```

---

### `list` / `info`

```bash
ableton-composer list             # list saved sets in sets/
ableton-composer info             # show tracks in the open Live set
ableton-composer info --devices   # include device list per track
```

---

## Style-guided workflow

The full loop for generating in the style of an existing set:

```bash
# 1. Analyze a reference set → extract style profile
ableton-composer analyze sets/saw85-92-a-minor-110bpm/
#    → profiles/saw85-92-a-minor-110bpm.json

# 2. Generate guided by the profile (track names inferred automatically)
ableton-composer generate "melancholic IDM, 12 sections, 8 bars each" \
  --style profiles/saw85-92-a-minor-110bpm.json --variations 3

# 3. Compare the best result against the source
ableton-composer compare sets/saw85-92-a-minor-110bpm sets/idm-110bpm_v2.json

# 4. Push into Ableton
ableton-composer push sets/idm-110bpm_v2.json --setup

# 5. Extend the set with more sections
ableton-composer generate "add breakdown and outro" \
  --continue sets/idm-110bpm_v2.json --style profiles/saw85-92.json
```

---

## The AbletonSong schema

```json
{
  "meta": {
    "bpm": 110,
    "scale": "A minor",
    "root_note": 57,
    "genre": "IDM",
    "mood": "melancholic",
    "time_signature": "4/4",
    "description": "..."
  },
  "sections": [
    {
      "name": "intro",
      "bars": 8,
      "tracks": [
        {
          "ableton_name": "Bass",
          "instrument": "sub bass",
          "clip": {
            "length_bars": 2,
            "notes": [
              { "pitch": 38, "time": 0,   "duration": 1,   "velocity": 90 },
              { "pitch": 38, "time": 2,   "duration": 0.5, "velocity": 70 }
            ]
          }
        }
      ]
    }
  ]
}
```

**Note values:** `duration` and `time` are in beats. 1 = quarter note, 0.5 = eighth, 0.25 = 16th.  
**Pitch:** MIDI note numbers. C3 = 60, C2 = 48. Drum map: Kick=36, Snare=38, HH Closed=42, HH Open=46.  
**Sections → scenes:** section index 0 = scene row 0, index 1 = scene row 1, etc.  
**ableton_name:** must match the Live track name exactly, case-sensitive.

Full schema: [`schema/song.schema.json`](schema/song.schema.json)

---

## Set directory format

Songs can also be stored as a directory — one JSON file per section plus a `meta.json`:

```
sets/my-song/
  meta.json          ← bpm, scale, genre, time_signature  (flat — no nesting)
  00-intro.json      ← section 0
  01-main.json       ← section 1
  02-break.json      ← section 2
```

The numeric prefix maps directly to the Ableton session slot index. All commands accept both flat files and directory paths.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | for `--provider api` or `anthropic` | — | Your Anthropic API key |
| `OPENAI_API_KEY` | for `--provider openai` or `codex` | — | Your OpenAI API key |
| `CLAUDE_MODEL` | no | `claude-opus-4-5` | Default Anthropic model |
| `OPENAI_MODEL` | no | `gpt-5.2` | Default OpenAI model |
| `CODEX_MODEL` | no | `gpt-5-codex` | Default Codex model |
| `WEATHER_LAT` | for `--weather` | — | Latitude |
| `WEATHER_LON` | for `--weather` | — | Longitude |
| `WEATHER_CITY` | no | — | City name (display only) |
| `DEBUG` | no | — | Set to any value to enable ableton-js logging |

`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are not needed when using `--provider cli` (`claude` CLI authentication is used instead).

---

## Roadmap

### `ableton-js-extended` — fork with device loading

`ableton-js` does not expose an API for loading instruments or presets into tracks. The plan is to fork the library into a separate npm package (`ableton-js-extended`) that adds this capability, allowing `push --setup` to optionally load instruments from an `instrument` field in the song JSON.
