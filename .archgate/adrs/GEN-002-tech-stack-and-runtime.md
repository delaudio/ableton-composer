---
id: GEN-002
title: Tech Stack and Runtime
domain: general
rules: false
---

# Tech Stack and Runtime

## Context

ableton-composer is a personal side project that bridges Claude AI and Ableton Live via a Node.js CLI. The project needs a stable, minimal runtime and toolchain baseline so that any future contributor or session agent can reason about module format, dependency installation, and language expectations without ambiguity.

Without an explicit decision, several tensions arise:

1. **Module system ambiguity**: Node.js supports both CommonJS (`require`/`module.exports`) and ES modules (`import`/`export`). Mixing them within the same project causes hard-to-debug interop errors, especially with ESM-only packages like `chalk` and `ora`.
2. **Registry conflicts**: The developer's global `~/.npmrc` may point to a private registry whose auth token expires regularly. Installing without a local override can silently fail with E401.
3. **Language drift**: Without a declared stance on TypeScript, incremental `.ts` files may appear inconsistently alongside `.js` files, creating a half-migrated codebase that is harder to reason about than either pure option.
4. **Tooling accumulation**: Side projects frequently acquire linters and formatters ad-hoc, each requiring configuration overhead that diverts from the project's actual goal.

**Alternatives considered:**

- **Bun as runtime**: Fast startup and built-in TypeScript support make it attractive, but `ableton-js` depends on Node.js-specific internals (WebSocket via `ws`, `Buffer`) whose behaviour under Bun is not verified. Node.js is the safe choice until `ableton-js` compatibility is tested.
- **TypeScript immediately**: Would provide type safety for the AbletonSong schema and Anthropic SDK responses, but requires `tsconfig.json`, a build step or `tsx`/`ts-node`, and disrupts the current zero-config approach. Deferred until the schema and API surface stabilise.
- **Yarn or pnpm**: Both offer workspace features and faster installs, but this is a single-package project; npm is sufficient and avoids introducing an additional tool.

For ableton-composer, the goal is fast iteration on the music generation workflow, not toolchain sophistication. A lean, explicit baseline reduces friction when picking up the project after a gap.

## Decision

All code in this project MUST target **Node.js >=18.0.0** using **ES modules** exclusively. The language is **JavaScript** today, with TypeScript acknowledged as a future migration goal. The package manager is **npm**, and a local `.npmrc` that pins the public npm registry MUST be present at the project root.

This decision covers: runtime version, module system, language choice, package manager, and tooling posture (linter, formatter, test runner).

This decision does not cover: the structure of source files (see ARCH ADRs), error handling patterns (see GEN-003), or the Claude API integration (see GEN-006).

**Chosen configuration:**

- **Runtime**: Node.js >=18.0.0 — provides native `fetch`, `fs/promises`, top-level `await`, and stable ESM support without polyfills
- **Module system**: ESM throughout — `import`/`export` syntax, `"type": "module"` in `package.json`
- **Language**: JavaScript — no TypeScript at this time; a migration ADR will be required before introducing `.ts` files
- **Package manager**: npm with a local `.npmrc` overriding the global registry
- **Tooling posture**: no linter, no formatter, no test runner — intentional for the PoC phase

## Do's and Don'ts

### Do

- **DO** use `import`/`export` syntax in every source file — this is an ESM-only project
- **DO** target Node.js >=18 APIs: use `fetch` (native), `fs/promises`, `path`, and `url` from the standard library without requiring polyfills
- **DO** derive `__dirname` and `__filename` using `import.meta.url` + `fileURLToPath` from `node:url` in every file that needs them
- **DO** keep `.npmrc` at the project root with `registry=https://registry.npmjs.org` — this overrides any global private registry
- **DO** run `npm install --registry https://registry.npmjs.org` if `.npmrc` is missing or overridden in a CI or automation context
- **DO** update this ADR before introducing a linter, formatter, or test runner

### Don't

- **DON'T** use `require()` or `module.exports` anywhere in the codebase — CommonJS is prohibited
- **DON'T** use `__dirname` or `__filename` as bare globals — they are not available in ESM; always derive them via `fileURLToPath(import.meta.url)`
- **DON'T** run `npm install` without first verifying that `.npmrc` is present — a global private registry override can cause E401 failures
- **DON'T** introduce `.ts` files without first authoring a TypeScript migration ADR and updating this document
- **DON'T** add a linter, formatter, or test runner without updating this ADR — tooling decisions MUST be deliberate and documented

## Consequences

### Positive

- **Zero build step**: plain `.js` files run directly with `node` — no compilation, no source maps, no watch mode needed
- **Native ESM compatibility**: `chalk`, `ora`, and other ESM-only packages integrate without workarounds
- **Predictable installs**: local `.npmrc` ensures `npm install` works regardless of the developer's global registry config
- **Low friction iteration**: no linter pass or type check between edits and test runs — faster experimentation during PoC
- **Clean future migration**: a JavaScript-first baseline makes TypeScript adoption deliberate rather than accidental

### Negative

- **No type safety**: schema shape errors (wrong field names, missing `required` fields) in the AbletonSong JSON are caught at runtime, not at compile time
- **No automated style enforcement**: code style is maintained by convention, not tooling — divergence is possible over time
- **npm is slower than alternatives**: `bun install` or `pnpm install` would be faster, though this is negligible for a project with ~10 dependencies

### Risks

- **ESM interop with ableton-js**: `ableton-js` is a CommonJS package. Dynamic `import()` resolves CJS modules in Node 18 ESM context correctly, but edge cases (circular deps, named exports) could surface.
  **Mitigation**: Keep `ableton-js` interactions isolated in `src/lib/ableton.js`. If interop issues arise, that file can be extracted to a CJS wrapper without affecting the rest of the codebase.
- **TypeScript creep**: without enforcement, `.ts` files may be added informally before a migration plan exists.
  **Mitigation**: This ADR explicitly prohibits `.ts` files until a migration ADR is authored. The `archgate:developer` agent will flag any TypeScript introduction during review.

## Compliance and Enforcement

**Automated enforcement:**

- `archgate check` will verify this ADR — no companion `.rules.ts` at this time, but one MUST be added if a linter is introduced
- Node version constraint is enforced via `"engines": { "node": ">=18.0.0" }` in `package.json`

**Manual enforcement (code review checklist):**

- Verify no `require()` calls appear in any new or modified file
- Verify `.npmrc` exists in the project root and contains `registry=https://registry.npmjs.org`
- Verify no `.ts` or `.tsx` files have been added without a corresponding migration ADR

**Exceptions:**

Any exception to this ADR (e.g., introducing TypeScript, switching to Bun) MUST be documented as a new or updated ADR before the change is merged.

## References

- [Node.js ESM documentation](https://nodejs.org/api/esm.html)
- [Node.js v18 release notes](https://nodejs.org/en/blog/release/v18.0.0)
- [chalk v5 ESM-only migration](https://github.com/chalk/chalk/releases/tag/v5.0.0)
- [ableton-js on npm](https://www.npmjs.com/package/ableton-js)
