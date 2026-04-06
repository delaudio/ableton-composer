---
title: Ableton Composer Docs
description: Static documentation for the Ableton Composer CLI
template: docs
---

# Ableton Composer

Generate structured MIDI for Ableton Live with multiple AI providers, reusable style profiles, and modular music-planning prompts.

## Start Here

- [Getting Started](/getting-started.html)
- [CLI Reference](/cli.html)
- [Providers](/providers.html)
- [Profiles](/profiles.html)
- [Prompt System](/prompt-system.html)
- [Workflows](/workflows.html)
- [Deploying the Docs Site](/deploying.html)

## Core Ideas

- `generate` creates song JSON from prompts
- `analyze` extracts hierarchical style profiles from songs, albums, or artists
- `compare` measures fidelity between a generated set and a source bundle
- `expand` adds new tracks to existing sections
- `preset generate` creates synth presets from preset profiles

## Current Architecture

- multi-provider AI layer for Anthropic, OpenAI, Codex, and Claude CLI
- prompt overlays for genre and harmonic grammar
- planning stages for harmony, arrangement, and combined song blueprints
- prompt-ready profile bundles for large album-scale style conditioning
