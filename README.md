# ableton-composer

CLI that uses Claude AI to generate structured MIDI content for Ableton Live. Describe a song in natural language, get a JSON with notes for every track, push it directly into your Live set. Analyze existing sets to extract style profiles and use them to guide future generations.

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
Existing sets
      ↓
  analyze             extracts style profile (key, BPM, rhythm, chords, pitch ranges)
      ↓
  profiles/*.json     editable style profile — curate before using
      ↓
  generate --style    Claude generates a new set guided by the profile
      ↓
  sets/*.json         saved to disk
      ↓
  push                writes notes into Live clip slots via ableton-js
      ↓
  Ableton Live        clips ready in session view, one row per section
      ↓
  compare             measure how faithful the generation is to the source style
```

Each **section** in the JSON maps to a **scene row** in session view. Trigger a scene to audition that part of the song.

---

## Requirements

- Node.js >=18
- Ableton Live with the **ableton-js MIDI Remote Script** active (see Setup)
- An Anthropic API key — or Claude Code CLI installed (`--provider cli`)

---

## Setup

```bash
git clone https://github.com/delaudio/ableton-composer
cd ableton-composer
npm install

cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY and optionally your coordinates for --weather
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
| `--provider <name>` | `api` (default, uses Anthropic SDK) or `cli` (uses Claude Code CLI, no API key needed) |
| `-w, --weather` | Fetch current weather and include as context |
| `-m, --model <model>` | Claude model (overrides `CLAUDE_MODEL` env var) |
| `-n, --name <name>` | Filename hint for the saved set |
| `-o, --output <path>` | Save to a specific path instead of `sets/` |
| `--no-save` | Print JSON to stdout without saving |

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

# Use Claude Code CLI instead of the API (no ANTHROPIC_API_KEY needed)
ableton-composer generate "trip-hop 90 BPM" --provider cli

# Auto-detect tracks from open Live set
ableton-composer generate "slow cinematic ambient" --live-sync

# Weather as generative seed
ableton-composer generate "reflect today's weather as ambient" \
  --tracks "Pad,Bass,Melody" --weather
```

---

### `analyze`

Extract a style profile from a set or a collection of sets. The profile captures key/mode, BPM, track presence, rhythm density, pitch ranges, and chord vocabulary — and can be passed directly to `generate --style`.

```bash
ableton-composer analyze <target> [options]
```

| Option | Description |
|---|---|
| `--out <path>` | Save profile to a specific path |
| `--print` | Print JSON to stdout instead of saving |

**Examples:**

```bash
# Single set → profile saved to profiles/
ableton-composer analyze sets/saw85-92-a-minor-110bpm/

# Collection of sets → aggregated profile
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
| `ANTHROPIC_API_KEY` | for `--provider api` | — | Your Anthropic API key |
| `CLAUDE_MODEL` | no | `claude-opus-4-5` | Model for generation |
| `WEATHER_LAT` | for `--weather` | — | Latitude |
| `WEATHER_LON` | for `--weather` | — | Longitude |
| `WEATHER_CITY` | no | — | City name (display only) |
| `DEBUG` | no | — | Set to any value to enable ableton-js logging |

`ANTHROPIC_API_KEY` is not needed when using `--provider cli` (Claude Code CLI authentication is used instead).

---

## Roadmap

### `ableton-js-extended` — fork with device loading

`ableton-js` does not expose an API for loading instruments or presets into tracks. The plan is to fork the library into a separate npm package (`ableton-js-extended`) that adds this capability, allowing `push --setup` to optionally load instruments from an `instrument` field in the song JSON.

### Device parameter control

`ableton-js` already exposes `DeviceParameter` with a settable `value` property. A future `params` key in the section JSON could apply parameter snapshots (filter cutoff, reverb decay, etc.) at push time.
