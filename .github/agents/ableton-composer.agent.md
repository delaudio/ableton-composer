# Ableton Composer Agent

Use this agent when working on the `ableton-composer` repository.

## Purpose

This repository is a CLI for:

- generating structured MIDI content for Ableton Live
- analyzing existing sets into reusable style profiles
- conditioning new generations from style bundles
- expanding existing sets with new tracks
- comparing generated material against source style profiles
- generating synth presets from preset profiles

This repo is not a generic music app. It has a specific generation pipeline, specific profile formats, and specific constraints around source-derived material.

## Core Principles

1. Preserve the generation pipeline architecture
2. Prefer compact, prompt-ready conditioning over large raw payloads
3. Treat style bundles and prompt profiles as runtime control surfaces
4. Avoid committing generated outputs or source-derived analysis data unless explicitly requested
5. Keep implementation changes pragmatic and measurable

## Key Architecture

### AI runtime

- `src/lib/ai.js`

This is the main AI integration layer.

It is responsible for:

- provider selection
- model defaults
- structured JSON generation
- modular prompt assembly
- planning stages such as:
  - harmonic plan
  - arrangement plan
  - combined song blueprint
- chunked generation continuity

Supported providers:

- `anthropic`
- `openai`
- `codex`
- `claude-cli`

Backward-compatible aliases exist:

- `api -> anthropic`
- `cli -> claude-cli`

### Analysis and scoring

- `src/lib/analysis.js`

This file handles:

- set analysis
- profile aggregation
- harmony extraction
- rhythm fingerprints
- arrangement summaries
- role normalization
- compare scoring

When improving generation quality, changes may need to touch both:

- `src/lib/ai.js`
- `src/lib/analysis.js`

### Profile handling

- `src/lib/profiles.js`

This is the main profile storage and loading layer.

It manages:

- hierarchical profile paths
- bundle manifests
- prompt-ready profiles
- bundle loading behavior

Important outputs:

- `core.json`
- `harmony.json`
- `rhythm.json`
- `arrangement.json`
- `prompt.json`
- `bundle.json`

### Commands

- `src/commands/generate.js`
- `src/commands/analyze.js`
- `src/commands/compare.js`
- `src/commands/expand.js`
- `src/commands/preset.js`

`generate` is the most sensitive command because it combines:

- track selection
- style profile loading
- planning
- chunking
- runtime provider behavior

## Prompt System

Prompt files live in `prompts/`.

Important files:

- `prompts/song-generate.md`
- `prompts/song-blueprint.md`
- `prompts/harmonic-plan.md`
- `prompts/arrangement-plan.md`
- `prompts/expand.md`
- `prompts/preset-generate.md`

Genre overlays:

- `prompts/genre/idm.md`
- `prompts/genre/trip-hop.md`
- `prompts/genre/chicago-house.md`

Harmony overlays:

- `prompts/harmony/jazz.md`
- `prompts/harmony/neo-soul.md`
- `prompts/harmony/blues.md`

Do not collapse everything back into one prompt. The modular structure is intentional.

## Style Profiles

Profiles are hierarchical and scope-aware.

Expected tree:

```text
profiles/
  songs/
  albums/
  artists/
  collections/
```

Use cases:

- song-level profiles for direct source matching
- album-level profiles for aggregate conditioning
- artist-level profiles for broader style guidance

`prompt.json` is the runtime-facing compressed representation. Prefer improving it over stuffing raw profile domains into generation prompts.

## Current Quality Problems

When working on generation quality, the known open areas are:

- section-aware arrangement planning
- role-presence drift
- tonal-center drift across chunked generation
- prompt-ready profile richness
- compare scoring for aggregate bundles
- continuation context size

These are tracked as GitHub issues. Prefer working in line with those issues rather than inventing disconnected fixes.

## Git and Content Hygiene

Be careful with source-derived material.

Do not commit, push, or recommend committing:

- generated sets under `sets/`
- analyzed profile JSON files under `profiles/`
- source-derived preset outputs under `presets/`

unless the user explicitly asks for that specific data to be versioned.

The repo should primarily track:

- source code
- prompts
- schemas
- documentation
- minimal examples already intended for the repo

## Testing and Verification

Preferred checks:

- `node --check <file>` for touched JS files
- targeted command verification, for example:
  - `node bin/cli.js generate --help`
  - `node bin/cli.js analyze --help`
  - `node bin/cli.js compare --help`
  - `node bin/cli.js preset generate --help`

For docs:

- `npm --prefix docs run build`

For runtime generation:

- prefer small smoke tests first
- use chunking for large style bundles
- validate outputs with `compare`

## Implementation Guidance

When making changes:

1. Read the relevant command and library files first
2. Preserve backward compatibility when possible
3. Prefer adding compact structured data over larger unstructured context
4. Favor prompt and data improvements that can be evaluated with compare results
5. Keep changes focused and avoid mixing runtime, docs, and unrelated refactors unless necessary

## When Working on Docs

The repo also contains a Minuto-powered docs site in `docs/`.

Use it for:

- architecture docs
- CLI reference
- workflows
- provider documentation

Do not re-expand the root `README.md` into a giant manual. Keep the README short and let the docs site carry the detail.

## Safe Defaults

If uncertain:

- prefer editing `prompt.json` generation logic over raw bundle expansion
- prefer section-aware planning over global-only heuristics
- prefer smaller continuation payloads over resending full generated songs
- prefer generic descriptions over references to specific copyrighted source works
