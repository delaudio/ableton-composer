---
title: Providers
description: Anthropic, OpenAI, Codex, and Claude CLI
template: docs
---

# Providers

## Supported Providers

- `anthropic`
- `openai`
- `codex`
- `claude-cli`

Backward-compatible aliases still work:

- `api -> anthropic`
- `cli -> claude-cli`

## Environment Variables

### Anthropic

- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL` default `claude-opus-4-5`

### OpenAI

- `OPENAI_API_KEY`
- `OPENAI_MODEL` default `gpt-5.2`
- `CODEX_MODEL` default `gpt-5-codex`
- `OPENAI_TIMEOUT_MS` default `120000`
- `OPENAI_MAX_RETRIES` default `0`

## When to Use What

### `openai`

Good default for structured generation and preset work.

### `codex`

Useful if you want to experiment with a coding-optimized model anyway, but it is not the default recommendation for music generation.

### `anthropic`

Kept for compatibility and alternative model behavior.

### `claude-cli`

Useful when you want local Claude CLI auth without API keys in this project.

## Chunking

For large style bundles, especially album-level bundles, use:

```bash
--sections 4 --chunk-size 2
```

This keeps prompt size and response latency under control.

Chunked generation keeps the selected style profile and tonal continuity lock active across chunks, so later chunks still receive role-presence and arrangement constraints.
