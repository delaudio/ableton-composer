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

The global `~/.npmrc` points to an expired AWS CodeArtifact registry. A local `.npmrc` at the project root overrides it:

```
registry=https://registry.npmjs.org
```

Always install with `npm install` from the project root — never `npm install --global` or from a parent directory.

---

## Governance

- Run `archgate:onboard` to extend governance for new domains
- Run `archgate:quality-manager` after coding sessions to capture patterns
- Planned ADRs (not yet written): Code Organization, Error Handling, AbletonSong Schema Contract, Claude Prompt Management, External Context Fetchers
