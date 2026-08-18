# Source file structure, imports & exports

Reference for how a file is laid out and how modules connect. Apply to new code; when editing existing code, match local conventions (see `SKILL.md` → How to apply).

## File section order

A file contains these sections, each separated by exactly one blank line, in order:

1. Copyright header (if the project uses one).
2. `@fileoverview` JSDoc describing the file's purpose.
3. Imports.
4. The implementation.

## Imports

- Use ES6 `import` only — never `require()` or `import x = require(...)`.
- Import other code by module path. Prefer **relative** paths (`./foo`, `../bar`) over absolute ones; keep the number of `../` steps small.
- **Named imports** for symbols used frequently or with clear names: `import {foo, bar} from './x';`
- **Namespace imports** (`import * as longApi from './x';`, named `lowerCamelCase`) when pulling many symbols from a large API. Resolve name collisions with a namespace import or by renaming the export at its source; rename an import only when necessary.
- **`import type {Foo}`** when a symbol is used only as a type; regular `import` for values.

## Exports

- **Use named exports.** For new modules, **no `export default`.**
  - **Carve-out (deliberate):** keep existing default exports as they are, and use a default export where a framework requires one — React/single-spa entry modules, `React.lazy()` targets, and similar. Don't convert existing default exports to named just for style.
- Export only what is used outside the module; keep the public surface small.
- No `export let` — mutable exports are hard to reason about. Expose a getter function if an external consumer needs a changing value.
- Don't create a container class of `static` members just to namespace — export individual `const`s and functions instead.
- Use `export type` when re-exporting something used only as a type.

## Modules, not namespaces

- Connect files with `import` / `export`. Don't use `namespace Foo { ... }` for your own code — use separate files to namespace. `namespace` is allowed only to describe external/third-party code.
