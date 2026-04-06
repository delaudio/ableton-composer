# ableton-composer — Project Context for Claude Code

This project uses [Archgate](https://archgate.dev) governance. ADRs live in `.archgate/adrs/`.
The `archgate:developer` agent governs all code changes — it reads ADRs before writing code and validates after.

Run `archgate check` to verify ADR compliance at any time.

---

## ableton-js v2.9.1 — Verified API Surface

The ableton-js v2.x API differs significantly from v1. These facts were verified via live tests against Ableton Live 11/12.

### Connection

```js
// v2.x: no start() — socket opens in constructor automatically
const ableton = new Ableton({ logger: ... });
// Wait for handshake via 'connect' event:
ableton.once('connect', resolve);
// Check immediately in case it connected before registering:
if (ableton.isConnected()) resolve();
```

### Notes

```js
// v2.x: setNotes() replaces v1's addNewNotes()
await clip.setNotes(notes);  // correct
// await clip.addNewNotes(notes);  // NOT available in v2.x
```

### Naming

Both clips and scenes support `set('name', value)` — verified working:

```js
await clip.set('name', 'intro — Bass');   // names a clip
await scene.set('name', 'intro');          // names a scene row
```

Clip naming convention in this project: `"${section.name} — ${trackDef.ableton_name}"` (em dash `—`).

### Session vs Arrangement

- **Session view clips**: full deletion supported via `slot.deleteClip()`
- **Arrangement clips**: only note removal via `clip.removeNotes(0, 0, length, 128)` — the empty container cannot be deleted via ableton-js. Workaround: Cmd+A in arrangement, then Delete in Live.

### Device parameters (read + write)

Device parameters are read via `track.get('devices')` → `device.get('parameters')` → `param.get('name')` + `param.get('value')`. Write back with `param.set('value', v)`.

Some parameters are read-only (e.g. `"Device On"`, output meters). Always wrap `set` in try/catch:

```js
try {
  await param.set('value', savedValue);
} catch {
  // Read-only param — skip silently
}
```

Snapshot JSON format used by `snapshot` command:
```json
{
  "created_at": "<ISO datetime>",
  "tracks": [
    {
      "name": "Bass",
      "devices": [
        { "name": "Analog", "parameters": { "Filter Cutoff": 0.7, "Resonance": 0.3 } }
      ]
    }
  ]
}
```

### Non-fatal operations

Scene naming and clip naming failures MUST NOT abort a push. Wrap in try/catch and continue:

```js
try {
  await scenes[sectionIndex].set('name', section.name);
} catch {
  // Non-fatal: continue even if scene naming fails
}
```

---

## Local npm Registry

If your global `~/.npmrc` points to a private registry, a local `.npmrc` at the project root overrides it:

```
registry=https://registry.npmjs.org
```

Always install with `npm install` from the project root — never `npm install --global` or from a parent directory.

---

## AbletonSong Set Directory Schema

A set directory (`sets/my-song/`) must contain:

- `meta.json` — **flat** JSON object with top-level fields: `bpm`, `scale`, `genre`, `time_signature`, `description`. Never wrap in a `{ "meta": { ... } }` envelope.
- `NN-section-name.json` — one file per section, each with `{ "name", "bars", "tracks": [...] }`.

```json
// meta.json — CORRECT
{ "bpm": 110, "scale": "A minor", "genre": "IDM / Ambient", "time_signature": "4/4", "description": "..." }

// meta.json — WRONG (double-wrapped)
{ "meta": { "bpm": 110, ... } }
```

`storage.js` (`loadSong`, `isSetDirectory`) and `analyzeSong()` both rely on the flat format. The double-wrapped form was introduced by a one-off generation script — do not repeat it.

---

## fast-xml-parser — Verified Usage (MusicXML)

Used by `import-xml` to parse `.xml` / `.musicxml` files. Pure ESM, no CJS workaround needed.

### Import

```js
const { XMLParser } = await import('fast-xml-parser');
```

### Critical options for MusicXML

```js
const parser = new XMLParser({
  ignoreAttributes:    false,       // expose XML attributes
  attributeNamePrefix: '@_',        // attributes as @_id, @_type, etc.
  parseAttributeValue: true,        // numbers stay numbers (not strings)
  isArray: tagName => [             // REQUIRED: tags that can repeat must be arrays
    'part', 'measure', 'note', 'direction', 'score-part',
    'tie', 'beam', 'slur', 'attributes', 'direction-type',
  ].includes(tagName),
});
```

**Without `isArray`**: single-child tags return a plain object; multi-child return an array.
This causes silent bugs (iterating an object instead of an array). Always use `isArray` + an `asArray()` guard:

```js
function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}
```

### MusicXML → beat conversion

```
beat_duration = note.duration / measure.attributes.divisions   // divisions = ticks per quarter note
```

Key signature: `<key><fifths>-1</fifths><mode>major</mode></key>` → `fifths + 7` = index into MAJOR_KEYS / MINOR_KEYS arrays (range 0–14).

Tempo: look for `<direction><sound tempo="120"/>` or `<direction-type><metronome><per-minute>120</per-minute>`.

### Chord notes, rests, ties

- `<chord/>` present → same start time as previous note (don't advance cursor)
- `<rest/>` present → advance cursor but emit no note
- `<grace/>` present → skip entirely
- `<tie type="start"/>` / `<tie type="stop"/>` → merge durations (extend the existing note object)

---

## @tonejs/midi v2.x — Verified API Surface

Used by `import-midi` to parse `.mid` files without Ableton.

### Import (ESM interop)

```js
// @tonejs/midi is CJS — must destructure from .default
const { Midi } = (await import('@tonejs/midi')).default;
const midi = new Midi(uint8ArrayOrBuffer);
```

### Key fields

```js
midi.header.ppq                          // ticks per quarter note (beat)
midi.header.tempos[0].bpm                // first tempo (float)
midi.header.timeSignatures[0].timeSignature  // [4, 4]
midi.tracks[i].name                      // track name (may be empty)
midi.tracks[i].notes[j].midi             // pitch (MIDI note number)
midi.tracks[i].notes[j].velocity         // 0–1 (NOT 0–127; multiply by 127)
midi.tracks[i].notes[j].ticks            // start time in ticks
midi.tracks[i].notes[j].durationTicks    // duration in ticks
```

### Tick → beat conversion

```js
const beats = ticks / midi.header.ppq;  // quarter note = 1 beat
```

---

## Governance

- Run `archgate:onboard` to extend governance for new domains
- Run `archgate:quality-manager` after coding sessions to capture patterns
- Planned ADRs (not yet written): Code Organization, Error Handling, AbletonSong Schema Contract, Claude Prompt Management, External Context Fetchers
