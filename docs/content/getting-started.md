---
title: Getting Started
description: Install and run Ableton Composer
template: docs
---

# Getting Started

## Requirements

- Node.js 18 or newer
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

## First Generation

```bash
ableton-composer generate "melancholic IDM, 8 sections" \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai
```

## Ableton Remote Script

```bash
cp -r node_modules/ableton-js/midi-script \
      ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonJS
```

Then activate `AbletonJS` inside:

`Preferences -> Link / MIDI -> Control Surfaces`

## Push a Generated Set

```bash
ableton-composer push sets/my-song --setup
```

Each generated section maps to one scene row in Ableton session view.
