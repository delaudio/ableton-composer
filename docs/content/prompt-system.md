---
title: Prompt System
description: Modular prompts, overlays, and planning
template: docs
---

# Prompt System

## Base Prompt

- `prompts/song-generate.md`

This contains the core MIDI-writing rules.

## Genre Overlays

- `prompts/genre/idm.md`
- `prompts/genre/trip-hop.md`
- `prompts/genre/chicago-house.md`

These shape groove, arrangement, and stylistic language.

## Harmony Overlays

- `prompts/harmony/jazz.md`
- `prompts/harmony/neo-soul.md`
- `prompts/harmony/blues.md`

These encode genre-specific harmonic grammar.

## Planning Stages

- `prompts/harmonic-plan.md`
- `prompts/arrangement-plan.md`
- `prompts/song-blueprint.md`

The planning layer exists to make generation less vague:

- harmonic plan for tonal and progression logic
- arrangement plan for section-level role presence
- arrangement plans also express section phases and per-section role budgets
- combined blueprint when both are needed

## Preset Prompt

- `prompts/preset-generate.md`

Used by `preset generate` to map a preset profile plus prompt into synth parameters.
