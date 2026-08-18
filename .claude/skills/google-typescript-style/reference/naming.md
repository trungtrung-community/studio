# Naming

Full naming rules from the Google TypeScript Style Guide. The quick table lives in `SKILL.md`; this file is the reference for the long tail.

## Case by identifier type

| Identifier type                          | Style                                            |
| ---------------------------------------- | ------------------------------------------------ |
| Variables, parameters, properties        | `lowerCamelCase`                                 |
| Functions, methods                       | `lowerCamelCase`                                 |
| Classes, interfaces, type aliases, enums | `UpperCamelCase`                                 |
| Type parameters (generics)               | `UpperCamelCase` — `<T>`, `<KeyType>`            |
| Decorators                               | `UpperCamelCase` — `@Component`                  |
| Module-level / global constants          | `CONSTANT_CASE`                                  |
| Enum values                              | `CONSTANT_CASE`                                  |
| Module namespace imports                 | `lowerCamelCase` — `import * as fooBar from ...` |

A "module-level constant" is `CONSTANT_CASE` only when it is both deeply immutable and module-scoped. A `const` local that just happens not to be reassigned stays `lowerCamelCase`.

## Descriptiveness

- Names MUST be descriptive and clear to a new reader — favour clarity over brevity.
- Be **precise**, not just descriptive — use the term that is actually correct for the thing. A near-but-wrong word (a config named `...Manager`, a value named `...Handler`) misleads _more_ than a vague one, because it asserts something false.
- Short names (including single letters) MAY be used only for variables in scope for ~10 lines or fewer (loop indices, short-lived locals).
- Names MUST NOT be decorated with information that the type already carries: use `name`, not `nameString`; `users`, not `userArray`.

## Abbreviations and acronyms

- Do not use abbreviations that are ambiguous or unfamiliar to readers outside the project, and do not abbreviate by deleting letters within a word.
- Treat acronyms as whole words: `loadHttpUrl` (not `loadHTTPUrl`), `UserId` (not `UserID`), `parseDbResult`.

## Forbidden affixes and markers

- No `_` as a prefix or suffix on identifiers, and `_` alone is not a valid identifier. (Underscores are allowed _inside_ `CONSTANT_CASE` and inside structured test method names.)
- No `I` prefix on interfaces — `UserService`, not `IUserService`. Don't mark interfaces specially at all.
- No `opt_` prefix for optional parameters — use TypeScript's `?` (`name?: string`).
- No `private_`-style name mangling — use the `private` / `protected` visibility modifiers instead.

## Type parameters

- Single uppercase letter (`T`) or `UpperCamelCase` (`KeyType`). Use a descriptive name when a single letter would be unclear.

## Aliases

- An alias MUST match the format of the thing it aliases. Use `const` for a local alias; use `readonly` for a class-field alias.

## Observables (project convention)

- Suffixing RxJS `Observable`s with `$` (`user$`) is a common, allowed convention. Apply it consistently if the codebase already does.

## File names

**Deviation from Google (deliberate):** Google specifies `snake_case` file names. We do **not** enforce that. Follow the repository's established file-naming convention — in these repos that is lowerCamelCase (`routeForNavItem.ts`, `registerFeatures.js`). Never rename a file for style; match what the directory already uses.
