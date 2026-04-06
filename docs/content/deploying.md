---
title: Deploying
description: Build and deploy the Minuto docs site
template: docs
---

# Deploying

## Local Development

From the repository root:

```bash
npm run docs:install
npm run docs:dev
```

Or directly inside `docs/`:

```bash
cd docs
npm install
npm run dev
```

## Production Build

```bash
npm run docs:build
```

This builds the static site into:

```text
docs/build/
```

## Vercel

The `docs/` directory is a standalone Minuto project and includes:

- `package.json`
- `vercel.json`

Recommended setup:

- create a Vercel project that uses `docs/` as the root directory
- build command: `npm run build`
- output directory: `build`

That is enough for a static deployment.
