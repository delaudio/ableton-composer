# ableton-composer

CLI for generating structured MIDI content for Ableton Live with multiple AI providers. It can analyze existing sets, extract style profiles, generate new material from prompts, expand arrangements, and push clips directly into Live.

## What It Does

- generates song JSON from natural-language prompts
- supports `anthropic`, `openai`, `codex`, and `claude-cli`
- analyzes songs, albums, artists, and collections into hierarchical style profiles
- uses modular prompt layers for genre, harmony, arrangement, and planning
- compares generated material against source profiles
- pushes clips into Ableton Live through `ableton-js`

## Quick Start

```bash
git clone https://github.com/delaudio/ableton-composer
cd ableton-composer
npm install

cp .env.example .env
# add ANTHROPIC_API_KEY and/or OPENAI_API_KEY
```

Generate a first set:

```bash
ableton-composer generate "melancholic IDM, 8 sections" \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai
```

Analyze an album into a reusable bundle:

```bash
ableton-composer analyze sets/violator \
  --scope album \
  --artist "Depeche Mode" \
  --album "Violator"
```

Generate from that bundle:

```bash
ableton-composer generate "dark synth-pop with restrained hooks" \
  --style profiles/albums/depeche-mode/violator/bundle.json \
  --tracks "Bass,Drums,Pad,Lead,Chords,FX" \
  --provider openai \
  --sections 4 \
  --chunk-size 2
```

## Documentation

The full documentation now lives in the Minuto-powered docs site under [`docs/`](docs/).

- Getting started: [`docs/content/getting-started.md`](docs/content/getting-started.md)
- CLI reference: [`docs/content/cli.md`](docs/content/cli.md)
- Providers: [`docs/content/providers.md`](docs/content/providers.md)
- Profiles: [`docs/content/profiles.md`](docs/content/profiles.md)
- Prompt system: [`docs/content/prompt-system.md`](docs/content/prompt-system.md)
- Workflows: [`docs/content/workflows.md`](docs/content/workflows.md)
- Deployment: [`docs/content/deploying.md`](docs/content/deploying.md)

Run the docs site locally:

```bash
npm run docs:install
npm run docs:dev
```

Build the static docs:

```bash
npm run docs:build
```

## Ableton Setup

This project uses the `ableton-js` MIDI Remote Script.

```bash
cp -r node_modules/ableton-js/midi-script \
      ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonJS
```

Then in Ableton:

`Preferences -> Link / MIDI -> Control Surfaces -> AbletonJS`

## Project Shape

```text
src/
  commands/      CLI commands
  lib/           AI providers, analysis, profiles, Ableton helpers
prompts/         modular prompt system
schema/          JSON schema for generated songs
sets/            generated song directories
profiles/        analyzed style bundles
docs/            Minuto-powered static documentation site
```

## License

MIT
