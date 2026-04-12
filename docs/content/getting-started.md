---
title: Getting Started
description: Install Ableton Composer, configure providers, and run the first generation.
template: docs
---

# Getting Started

## Requirements

- Node.js 20 or newer
- Ableton Live
- the `ableton-js` MIDI Remote Script enabled in Live
- one of:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - Claude Code CLI auth for `--provider cli`

## Install

```bash
git clone https://github.com/delaudio/ableton-composer
cd ableton-composer
npm install

cp .env.example .env
```

Edit `.env` and add the provider keys you want to use.

Useful OpenAI env vars:

- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`

## First Generation

```bash
ableton-composer generate "melancholic IDM, 8 sections" \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai
```

What this does:

1. loads the base generation prompt
2. optionally infers genre or harmony overlays
3. generates structured song JSON
4. saves the result under `sets/`

## Ableton Remote Script

```bash
cp -r node_modules/ableton-js/midi-script \
      ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonJS
```

Then activate `AbletonJS` in:

`Preferences -> Link / MIDI -> Control Surfaces`

Restart Live if needed.

Note for Live 11+: the custom `AbletonJS` Remote Script may trigger Ableton's warning about using an older MIDI-note editing process. For normal clip/note workflows you can proceed, but advanced Live 11 note metadata such as MPE, probability, velocity deviation, and release velocity may not be preserved when a Remote Script rewrites MIDI notes.

## Push a Generated Set

```bash
ableton-composer push sets/my-song --setup
```

Each generated section maps to one scene row in Ableton session view.

## Next Steps

- read [Providers](/providers.html) if you want to choose between Anthropic, OpenAI, Codex, or Claude CLI
- read [Profiles](/profiles.html) if you want album-style conditioning
- read [Workflows](/workflows.html) for end-to-end examples
