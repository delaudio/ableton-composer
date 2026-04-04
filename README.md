# ableton-composer

CLI that uses Claude AI to generate structured MIDI content for Ableton Live. Describe a song in natural language, get a JSON with notes for every track, push it directly into your Live set.

```
ableton-composer generate "trip-hop 87 BPM D minor, melancholic, 4 sections" \
  --tracks "Bass,Drums,Chords,Lead" \
  --weather
```

---

## How it works

```
Prompt + context
      ↓
  Claude API          generates an AbletonSong JSON
      ↓
  sets/*.json         saved to disk
      ↓
  ableton-js          writes notes into Live clip slots via MIDI Remote Script
      ↓
  Ableton Live        clips ready in session view, one row per section
```

Each **section** in the JSON maps to a **scene row** in session view. Trigger a scene to audition that part of the song.

---

## Requirements

- Node.js >=18
- Ableton Live with the **ableton-js M4L companion patch** loaded on any MIDI track
- An Anthropic API key

---

## Setup

```bash
git clone <repo>
cd ableton-composer
npm install

cp .env.example .env
# edit .env — add your ANTHROPIC_API_KEY and optionally your coordinates for weather
```

### Install the MIDI Remote Script

`ableton-js` communicates with Live via a Python MIDI Remote Script — not a Max for Live patch.

**1. Copy the script to Ableton's Remote Scripts folder:**

```bash
cp -r node_modules/ableton-js/midi-script \
      ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonJS
```

**2. Activate it in Ableton Live:**

Open `Preferences` → `Link / MIDI` → `Control Surfaces` → pick **AbletonJS** in any available slot.

Restart Ableton if it was already open. The script activates automatically on every launch — no tracks or patches needed.

---

## Commands

### `generate`

Generate a song JSON from a natural language prompt.

```bash
ableton-composer generate "<prompt>" [options]
```

| Option | Description |
|---|---|
| `-t, --tracks <names>` | Comma-separated track names to use, e.g. `"Bass,Drums,Chords,Lead"` |
| `-L, --live-sync` | Auto-detect track names from the open Live set |
| `-w, --weather` | Fetch current weather (Open-Meteo) and pass it as context |
| `-m, --model <model>` | Claude model to use (overrides `CLAUDE_MODEL` env var) |
| `-n, --name <name>` | Filename hint for the saved set |
| `-o, --output <path>` | Save to a specific path instead of `sets/` |
| `--no-save` | Print JSON to stdout without saving |

**Examples:**

```bash
# Basic
ableton-composer generate "house 128 BPM A minor, 3 sections: intro verse chorus" \
  --tracks "Kick,Snare,HH,Bass,Lead"

# Auto-detect tracks from open Live set
ableton-composer generate "slow cinematic ambient, lots of space" --live-sync

# Weather as generative seed
ableton-composer generate "reflect today's weather as a short ambient piece" \
  --tracks "Pad,Bass,Melody" --weather

# Print JSON without saving (pipe to another tool)
ableton-composer generate "..." --no-save | jq '.meta'
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

**Examples:**

```bash
# Push everything
ableton-composer push sets/trip-hop-87bpm_2026-04-03.json --overwrite

# Push into an empty Live set — create tracks and scenes automatically
ableton-composer push sets/my-song/ --setup --overwrite

# Preview first
ableton-composer push sets/trip-hop-87bpm_2026-04-03.json --dry-run

# Push only the drop section
ableton-composer push sets/my-set.json --sections drop
```

`--setup` reads the track names from the song JSON, creates any that are missing, and adds scenes until the Live set has enough rows. Track order in Live matches the order they first appear in the JSON.

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
| `--out <path>` | Save into an existing set directory (e.g. `sets/my-song/`) |
| `--add-to <file>` | Merge pulled sections into an existing flat JSON |
| `--replace` | When merging, replace existing sections with the same name |

**Examples:**

```bash
# Pull all scenes → new flat JSON in sets/
ableton-composer pull

# Pull scene 2 and label it "bridge"
ableton-composer pull --scene 2 --name bridge

# Pull scene 1 and save it into an existing set directory
ableton-composer pull --scene 1 --out sets/idm-g-minor/ --replace

# Merge into an existing flat file
ableton-composer pull --add-to sets/my-song.json
```

---

### `clear`

Remove clips from the current Ableton Live set.

- **Session view**: clip slots are fully deleted.
- **Arrangement view**: notes are removed from each clip (empty containers remain — ableton-js cannot delete them).

```bash
ableton-composer clear [options]
```

| Option | Description |
|---|---|
| `--arrangement` | Clear arrangement clips instead of session view |
| `--all` | Clear both session view and arrangement |
| `--tracks <names>` | Only clear specific tracks, e.g. `"Bass,Drums"` |
| `--scenes <indices>` | Only clear specific scene rows, e.g. `"0,1,2"` (session only) |
| `--dry-run` | Show what would be cleared without making changes |

**Examples:**

```bash
# Clear all session clips
ableton-composer clear

# Clear arrangement for specific tracks only
ableton-composer clear --arrangement --tracks "Bass,Lead"

# Preview what would be deleted
ableton-composer clear --dry-run
```

---

### `split`

Convert a flat song JSON into a **set directory** — one file per section plus a `meta.json`. Useful for editing sections independently.

```bash
ableton-composer split <file> [options]
```

| Option | Description |
|---|---|
| `--out <dir>` | Output directory (defaults to filename without timestamp/extension) |

**Example:**

```bash
ableton-composer split sets/idm-g-minor_2026-04-03.json
# creates: sets/idm-g-minor/meta.json, 00-intro.json, 01-main.json, …
```

---

### `compile`

Merge a set directory back into a single flat JSON.

```bash
ableton-composer compile <directory> [options]
```

| Option | Description |
|---|---|
| `--out <file>` | Output path (defaults to a timestamped file in `sets/`) |

**Example:**

```bash
ableton-composer compile sets/idm-g-minor/
ableton-composer compile sets/idm-g-minor/ --out sets/idm-g-minor-full.json
```

---

### `arrange`

Place session view clips into the arrangement timeline. Sections are laid out sequentially; if a clip loop is shorter than the section's bar count it is duplicated to fill the full length. Requires the clips to already exist in the session view — run `push` first.

```bash
ableton-composer arrange <file> [options]
```

| Option | Description |
|---|---|
| `--start <bars>` | Start position in bars (default: `0`) |
| `--gap <bars>` | Gap in bars between sections (default: `0`) |
| `--sections <names>` | Only arrange specific sections, e.g. `"intro,main"` |
| `--dry-run` | Preview the layout without writing to Ableton |

**Examples:**

```bash
# Arrange full song starting at bar 0
ableton-composer arrange sets/my-song.json

# Start at bar 8, 2-bar gap between sections
ableton-composer arrange sets/my-song.json --start 8 --gap 2

# Preview the layout first
ableton-composer arrange sets/my-song.json --dry-run

# Only arrange intro and chorus
ableton-composer arrange sets/my-song.json --sections intro,chorus
```

---

### `list`

List all saved sets in the `sets/` directory.

```bash
ableton-composer list
```

---

### `info`

Introspect the open Ableton Live set — shows track names, optionally device lists.

```bash
ableton-composer info
ableton-composer info --devices        # show devices per track
ableton-composer info --devices --params  # show device parameters too
```

Use this to get the exact track names to pass to `--tracks` or to embed in your song JSON (`ableton_name` is case-sensitive).

---

## The AbletonSong schema

Every generated JSON follows this structure. You can write or edit them by hand too.

```json
{
  "meta": {
    "bpm": 87,
    "scale": "D minor",
    "root_note": 62,
    "genre": "trip-hop",
    "mood": "melancholic",
    "time_signature": "4/4"
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
              { "pitch": 38, "time": 0,    "duration": 1,   "velocity": 90 },
              { "pitch": 38, "time": 2,    "duration": 0.5, "velocity": 70 }
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

Songs can also be stored as a **directory** — one JSON file per section plus a `meta.json`:

```
sets/idm-g-minor/
  meta.json          ← bpm, scale, genre, time_signature
  00-intro.json      ← section 0
  01-main.json       ← section 1
  02-break.json      ← section 2
```

The numeric prefix (`00-`, `01-`…) maps directly to the Ableton session slot index, so section files can be edited and pushed independently.

All commands that accept a flat file also accept a directory path or a single section file:

```bash
ableton-composer push sets/idm-g-minor/           # push all sections
ableton-composer push sets/idm-g-minor/01-main.json   # push section 1 only
ableton-composer arrange sets/idm-g-minor/
```

Convert between the two formats with `split` and `compile`.

---

## External context

The `--weather` flag fetches current conditions from [Open-Meteo](https://open-meteo.com/) (free, no API key) and passes them to Claude as seed data. Set your location in `.env`:

```env
WEATHER_LAT=45.07
WEATHER_LON=7.69
WEATHER_CITY=Torino
```

More fetchers can be added in `src/lib/fetchers/` — see `weather.js` as a reference.

---

## Workflow tip

1. Set up a **template Live set** with named MIDI tracks and instruments already loaded
2. Run `ableton-composer info` to confirm track names
3. Run `generate` with those names via `--tracks`
4. Run `push --dry-run` to preview, then `push --overwrite` to write the clips
5. Tweak notes directly in Live, then run `pull --add-to <file>` to capture edits back into JSON
6. Run `split` to break the song into per-section files for easier iteration
7. Run `arrange` (after `push`) to place everything on the arrangement timeline
8. Tweak sounds, effects, and arrangement in Live — that's the part AI doesn't do

---

## Roadmap

### `ableton-js-extended` — fork with device loading

`ableton-js` does not expose an API for loading instruments or presets into tracks. The plan is to fork the library into a separate npm package (`ableton-js-extended`) that adds this capability.

The library has two layers — a Node.js wrapper and a Python MIDI Remote Script. Both need to be extended:

**New API (Node.js side):**

```js
// Load a native Ableton instrument by browser path
await track.loadDevice(['instruments', 'Wavetable']);

// Load a specific preset
await track.loadDevice(['instruments', 'Operator', 'Basses', 'Deep Bass']);

// Load a VST/AU plugin
await track.loadDevice(['plugins', 'Serum']);

// List available instruments (for discovery)
const tree = await ableton.song.getBrowserTree('instruments', 2);
```

**Python side (`midi-script/Track.py`):**

```python
def load_device(self, ns, device_path):
    import Live
    browser = Live.Application.get_application().browser
    song    = self.ableton.song()
    song.view.selected_track = ns  # select target track

    node = browser
    for segment in device_path:
        node = next((c for c in node.children if c.name == segment), None)
        if not node:
            raise Exception("Browser item not found: " + segment)

    browser.load_item(node)
```

Once this is available, `push --setup` could optionally load instruments from an `instrument` field in the song JSON:

```json
{
  "ableton_name": "Pad",
  "instrument": ["instruments", "Wavetable"],
  "clip": { ... }
}
```

### Device parameter control

`ableton-js` already exposes `DeviceParameter` with a settable `value` property. This enables per-section automation of any knob — filter cutoff, reverb decay, oscillator shape — without touching the arrangement. A future `params` key in the section JSON could apply parameter snapshots at push time.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Your Anthropic API key |
| `CLAUDE_MODEL` | no | `claude-opus-4-5` | Model for generation |
| `WEATHER_LAT` | for `--weather` | — | Latitude |
| `WEATHER_LON` | for `--weather` | — | Longitude |
| `WEATHER_CITY` | no | — | City name (display only) |
| `DEBUG` | no | — | Set to any value to enable ableton-js logging |
