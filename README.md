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
  ableton-js          writes notes into Live clip slots via M4L bridge
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

**Examples:**

```bash
# Push everything
ableton-composer push sets/trip-hop-87bpm_2026-04-03.json --overwrite

# Preview first
ableton-composer push sets/trip-hop-87bpm_2026-04-03.json --dry-run

# Push only the drop section
ableton-composer push sets/my-set.json --sections drop
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
4. Run `push --dry-run` to preview
5. Run `push --overwrite` to write the clips
6. Tweak sounds, effects, and arrangement in Live — that's the part AI doesn't do

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
