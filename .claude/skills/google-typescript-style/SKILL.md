---
name: google-typescript-style
description: Google TypeScript Style Guide standards for writing, reviewing, and refactoring TypeScript and JavaScript — naming, named exports, language features (===, const/let, as/unknown, no var), and a purpose-first documentation standard (JSDoc with @param/@returns/@example; comments that state why code exists, never the bug-fix incident, written to scan — one idea per sentence). Apply Google rules to new code; match existing local conventions when editing — never rename files to snake_case or convert existing default exports. Use when writing a new function, class, or module, adding JSDoc, naming things, reviewing a diff for style, or asked "is this idiomatic", "follow our standards", or "clean this up".
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.js'
  - '**/*.jsx'
  - '**/*.mjs'
  - '**/*.cjs'
---

# Google TypeScript Style

Write TypeScript and JavaScript to the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), plus a purpose-first documentation standard. The goal is one consistent pattern across every file, so any reader (human or agent) meets the same idioms everywhere.

## Philosophy

When no rule fits or two conflict, decide by this order: readability > cleverness · maintainability > brevity · consistency > personal preference · local convention > theoretical perfection.

## How to apply (read first)

These are standing rules for the whole task, not one-time steps.

- **New code → full standard.** Apply every rule below.
- **Editing existing code → match it, never churn.** Follow the file's established local conventions; don't refactor, rename, or flag unrelated code (no unsolicited "rename to snake_case" / "convert this default export") unless asked.
- **Formatting yields to an enforced formatter.** Default to Google formatting (single quotes, 2-space indent, semicolons); if a repo's Prettier/Biome/ESLint config differs on a point, follow it. **Semantic rules** (naming, exports, language features, docs) always apply.
- **File names follow the repo convention** — never rename a file for style. (Deliberate deviation from Google's `snake_case`.)
- **JS vs TS.** On `.js`/`.jsx`, apply everything language-agnostic (naming, comments/docs, named exports, `const`/`let`, `===`); TS-only rules (type annotations, `as`, `import type`, interface-vs-`type`) apply only on `.ts`/`.tsx`.

## Self-check (scan the diff before finishing)

- In code you're writing, could a rename or a smaller function make a comment unnecessary? Do that, then delete it. (Don't restructure _existing_ code for this.)
- Would an engineer who doesn't know this subsystem understand every name and comment? (precise terms, no unexplained jargon)
- `const` / `===` / named exports for new modules / `throw new Error`; no unrelated churn in files you touched.

## Core rules (always)

- **Named exports for new modules** — no `export default`. Keep existing default exports and framework-required ones (React/single-spa entry modules, `React.lazy` targets) as-is.
- **`const` by default, `let` when reassigned — never `var`.**
- **`===` / `!==`** only. (`== null` is allowed to catch both `null` and `undefined`.)
- **Type assertions** use `as`, never `<Type>`; prefer a runtime check over an assertion; use `unknown` (not `any`) as the intermediate type.
- **Control flow uses braced blocks.** Every `switch` has a `default`; non-empty cases never fall through.
- **Throw only `new Error(...)`** (or a subclass). Don't throw strings or bare objects.
- **No `namespace`, no `const enum`, no `var`, no `with`, no `eval`, no wrapper objects** (`new String/Number/Boolean`). Use separate files to namespace.

## Naming

| Identifier                                                     | Case             | Example                                    |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------ |
| Variables, parameters, properties, functions, methods          | `lowerCamelCase` | `userCount`, `getUserName()`               |
| Classes, interfaces, types, enums, type parameters, decorators | `UpperCamelCase` | `UserAccount`, `HttpResponse`, `<KeyType>` |
| Module-level constants, enum values                            | `CONSTANT_CASE`  | `MAX_RETRIES`, `Status.ACTIVE`             |

- **Be descriptive and precise.** Names must be clear to a new reader and use the correct term — a near-but-wrong word misleads more than a vague one. Single-letter names only for variables scoped to ~10 lines or fewer.
- **Acronyms are words:** `loadHttpUrl`, not `loadHTTPUrl`.
- **No `I` prefix** on interfaces (`UserService`, not `IUserService`); no `opt_` prefix on optional params (use `?`); no leading/trailing `_`.
- **Don't encode the type in the name** (`name`, not `nameString`).
- **File names: follow the repo convention** (see "How to apply" — `snake_case` is not enforced here).

→ See [reference/naming.md](reference/naming.md) for the full rules (abbreviations, aliases, type parameters).

## Documentation & comments

Good docs and comments are the highest-value part of this standard. **Prefer improving code over explaining code** — before adding a comment, try to make it unnecessary: rename, extract a well-named function, simplify. What remains follows two ideas: **document the purpose, not the mechanics**, and **a comment explains why the code exists, never the incident that produced it.**

**JSDoc (`/** ... */`)** on every exported / public function, class, and method. Use `//` line comments for internal implementation notes.

- **Document why and intent**, not a restatement of the signature. Omit JSDoc that only repeats what the types already say.
- `@param` / `@returns` only when they add information beyond the type (units, constraints, what "empty" means). Omit `@returns` for `void`.
- **`@example`** for any non-obvious API — show a real call and its result.
- `@deprecated` carries the migration path; `@fileoverview` at the top of a file states its purpose.
- **Make documentation scannable — one idea per sentence.** Split a sentence that fuses two+ ideas. Prefer a separate sentence over a colon, em-dash, or long parenthetical that carries a second idea; group related ideas into short paragraphs; keep distinct responsibilities in distinct sentences. Don't over-split into choppy fragments — one idea per _sentence_, not per clause. AI-drafted JSDoc skews long and idea-dense; this is the counterweight.

→ See [reference/comments-and-jsdoc.md](reference/comments-and-jsdoc.md) for the full JSDoc rules, the sentence-split test, examples, good/bad comment pairs, and the purpose-not-incident rule.

## More rules (load when relevant)

- **[reference/language-features.md](reference/language-features.md)** — load when writing logic: `const`/`let`, arrays/objects, classes, functions & arrows & `this`, equality, type assertions, interface-vs-`type`, strings/numbers, control flow, exceptions, `switch`, disallowed features.
- **[reference/source-structure.md](reference/source-structure.md)** — load when touching imports/exports or file layout: file section order, ES6 imports, named-exports-for-new-modules (with the default-export carve-out), `import type` / `export type`, no `namespace`.

## Evolution

Add a rule only when all hold: the issue recurs, no existing rule covers it, and it removes ambiguity rather than encoding a preference. Otherwise sharpen an existing rule or add nothing — prefer deleting or merging. The guide should trend shorter over time.
