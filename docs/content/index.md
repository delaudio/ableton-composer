---
title: Ableton Composer Docs
description: Multi-provider MIDI generation, style analysis, and prompt-driven music planning for Ableton Live.
template: docs
---

# Ableton Composer

Generate structured MIDI for Ableton Live with multiple AI providers, reusable style profiles, and modular planning prompts.

<div class="hero-panel">
  <div class="hero-kicker">System overview</div>
  <div class="hero-grid">
    <div>
      <h2 class="hero-title">Prompt, analyze, compare, push.</h2>
      <p class="hero-copy">Ableton Composer is built like a toolchain, not a toy demo. Generate MIDI structures, derive style bundles from source material, and drive the next generation pass with tighter harmonic and arrangement context.</p>
      <div class="hero-actions">
        <a class="hero-button hero-button-primary" href="/getting-started.html">Start here</a>
        <a class="hero-button" href="/workflows.html">See workflows</a>
      </div>
    </div>
    <div class="hero-spec">
      <div class="spec-row">
        <span>Providers</span>
        <span>Anthropic · OpenAI · Codex · Claude CLI</span>
      </div>
      <div class="spec-row">
        <span>Profiles</span>
        <span>song · album · artist · collection</span>
      </div>
      <div class="spec-row">
        <span>Planning</span>
        <span>harmonic · arrangement · blueprint</span>
      </div>
      <div class="spec-row">
        <span>Runtime</span>
        <span>Ableton Live via ableton-js</span>
      </div>
    </div>
  </div>
</div>

<div class="grid gap-4 sm:grid-cols-3">
  <div class="spec-card">
    <div class="spec-kicker">Generation</div>
    <div class="spec-title">Prompt to song JSON</div>
    <div class="spec-copy">Create multi-section sets from natural language, track lists, and style bundles.</div>
  </div>
  <div class="spec-card">
    <div class="spec-kicker">Analysis</div>
    <div class="spec-title">Song to profile bundle</div>
    <div class="spec-copy">Extract album, artist, and collection fingerprints across harmony, rhythm, and arrangement.</div>
  </div>
  <div class="spec-card">
    <div class="spec-kicker">Runtime</div>
    <div class="spec-title">Push into Live</div>
    <div class="spec-copy">Write clips directly into Ableton through the `ableton-js` remote script workflow.</div>
  </div>
</div>

## Quick Start

```bash
git clone https://github.com/delaudio/ableton-composer
cd ableton-composer
npm install
cp .env.example .env
```

Generate a first set:

```bash
ableton-composer generate "melancholic IDM, 8 sections" \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai
```

## Start Here

<div class="quick-link-grid">
  <a class="quick-link-card" href="/getting-started.html">
    <div class="spec-kicker">Entry</div>
    <div class="spec-title">Getting Started</div>
    <div class="spec-copy">Install the CLI, set provider keys, and run the first generation.</div>
  </a>
  <a class="quick-link-card" href="/cli.html">
    <div class="spec-kicker">Reference</div>
    <div class="spec-title">CLI</div>
    <div class="spec-copy">Command surface for generation, analysis, compare, expand, and presets.</div>
  </a>
  <a class="quick-link-card" href="/profiles.html">
    <div class="spec-kicker">System</div>
    <div class="spec-title">Profiles</div>
    <div class="spec-copy">Understand bundles, prompt profiles, and hierarchical style scopes.</div>
  </a>
  <a class="quick-link-card" href="/prompt-system.html">
    <div class="spec-kicker">System</div>
    <div class="spec-title">Prompt System</div>
    <div class="spec-copy">See how overlays and planning stages shape final generation.</div>
  </a>
  <a class="quick-link-card" href="/workflows.html">
    <div class="spec-kicker">Practice</div>
    <div class="spec-title">Workflows</div>
    <div class="spec-copy">Use end-to-end flows for albums, presets, expansions, and compare loops.</div>
  </a>
  <a class="quick-link-card" href="/deploying.html">
    <div class="spec-kicker">Ops</div>
    <div class="spec-title">Deploying</div>
    <div class="spec-copy">Build and ship the docs site through Minuto and Vercel.</div>
  </a>
</div>

## Recommended Paths

### I want to generate material quickly

1. Open [Getting Started](/getting-started.html)
2. Use `generate` with explicit tracks
3. Push the result into Live

### I want to emulate an album or artist

1. Read [Profiles](/profiles.html)
2. Run `analyze --scope album`
3. Generate from `bundle.json`
4. Validate with `compare`

### I want to understand the prompting system

1. Read [Prompt System](/prompt-system.html)
2. Inspect genre overlays and harmony overlays
3. Review the planning layers: harmonic, arrangement, blueprint

## Core Capabilities

- `generate` creates song JSON from prompts, style bundles, and planning prompts
- `analyze` extracts hierarchical style profiles from songs, albums, artists, or collections
- `compare` measures fidelity between generated material and a source profile bundle
- `expand` adds new tracks to existing sections without rewriting the originals
- `preset generate` creates synth presets from preset profiles

## Architecture Snapshot

- multi-provider AI layer for Anthropic, OpenAI, Codex, and Claude CLI
- modular prompt system with genre overlays, harmony overlays, and planning stages
- prompt-ready profile bundles for large album-scale conditioning
- chunked generation for larger structured outputs

## Example Workflow

<div class="command-panel">

```bash
# 1. Analyze an album into a style bundle
ableton-composer analyze sets/violator \
  --scope album \
  --artist "Depeche Mode" \
  --album "Violator"

# 2. Generate from that bundle
ableton-composer generate "dark synth-pop with restrained hooks" \
  --style profiles/albums/depeche-mode/violator/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2

# 3. Compare the output against the source profile
ableton-composer compare \
  profiles/albums/depeche-mode/violator/bundle.json \
  sets/my-generated-song
```

</div>
