# Language features

Reference for the language rules. The most common ones are summarised in `SKILL.md`; this is the full set. Apply to new code; when editing existing code, match local conventions (see `SKILL.md` → How to apply).

## Variables

- Declare with `const` or `let`; **never `var`**. Use `const` by default; `let` only when the variable is reassigned.
- One variable per declaration. Initialise at declaration where practical. Don't use a variable before its declaration.

## Arrays

- Use literals `[1, 2, 3]`; never the `Array()` constructor.
- Don't put non-numeric properties on an array — use a `Map` or object for key/value data.
- Only spread iterables; never spread `null`/`undefined` or other primitives.
- In array destructuring, give an optional destructured parameter a default of `[]`, and put defaults on the left-hand side.

## Objects

- Use object literals (`{}`, `{a: 0}`); never the `Object()` constructor.
- Don't use unfiltered `for...in`. Iterate with `for...of Object.keys(obj)` / `Object.values` / `Object.entries`, or guard with `hasOwnProperty`. Never `for...in` over an array.
- When spreading to build an object, only spread objects (not arrays/primitives).
- Keep parameter destructuring shallow: a single level of unquoted shorthand properties; defaults on the left; an optional destructured object defaults to `{}`.

## Classes

- Use visibility modifiers (`private`, `protected`, `public`) — **not** `#private` fields. Use `public` only when declaring a non-`readonly` public parameter property; otherwise it's implicit.
- Don't reach around visibility with `obj['privateThing']`.
- Mark fields never reassigned after construction `readonly`. Prefer TypeScript parameter properties over hand-written constructor assignment. Initialise non-parameter properties where they're declared.
- Omit empty constructors or ones that only delegate to `super`; keep a constructor that declares parameter properties or decorators even if its body is empty.
- No semicolons after a class _declaration_; a statement holding a class _expression_ ends with a semicolon. Don't put semicolons between methods; separate methods with one blank line.
- Getters must be pure (no observable side effects). Don't add pass-through accessors that only wrap a field — make the field `public`/`readonly` instead. Don't define accessors via `Object.defineProperty`.
- Don't manipulate `prototype` directly (framework code is the rare exception). Consider making private methods into non-exported module functions.

## Functions and `this`

- Prefer named **function declarations** for top-level named functions. Don't use function expressions — use arrow functions instead (exceptions: dynamically rebinding `this`, or generators).
- Inside methods, prefer arrow functions so they share the outer `this`.
- Don't use `this` outside class constructors/methods, functions with an explicit `this` type, or arrow functions in a valid `this` scope. Never use `this` for the global object or an event target.
- Prefer an arrow function that forwards arguments over passing a bare named callback; call instance methods through arrow functions rather than passing method references. Don't `bind()` in the expression that installs an event handler.
- Default parameter initialisers must have no side effects and stay simple; use them sparingly. Prefer destructured options objects when there are several optional parameters.
- Use rest parameters (`...args`) and spread, not `arguments` / `Function.prototype.apply`. Never name anything `arguments`.
- No blank line at the very start or end of a function body.

## Equality

- Use `===` / `!==`. Never `==` / `!=`, **except** comparing to the literal `null` (`x == null`) to match both `null` and `undefined`.
- Don't add an explicit boolean coercion (`!!x`, `Boolean(x)`) in a condition that already coerces (`if`, `while`, `for`). Never coerce an enum value to boolean — compare it explicitly.

## Type assertions and non-null

- Prefer a real runtime check over an assertion — assertions are unsafe.
- Use `as Type` syntax, never `<Type>`. For object literals, prefer a type annotation (`const x: Foo = {...}`) over `as Foo`.
- For a double assertion, go through `unknown` (not `any` or `{}`).
- When you do assert, add a short comment explaining why it's safe (unless it's obvious).

## Interfaces vs type aliases

- Prefer `interface` over a `type` alias for object/record shapes.
- Use `type` for unions, primitives, tuples, and mapped/conditional types.

## Strings and numbers

- Single quotes for ordinary string literals. Use a template literal to avoid escaping a single quote, and for any multi-line or composed string instead of `+` concatenation. No line-continuation backslashes.
- Number prefixes are lowercase: `0x`, `0o`, `0b`. No leading zeros otherwise.
- Coerce with `String(x)` / `Boolean(x)` / `Number(x)` — without `new`. Parse numbers with `Number()` and check for `NaN`; don't use unary `+` to coerce. Use `parseInt`/`parseFloat` only for non-base-10 input, after validating the digits.

## Control structures

- Always use braced blocks, even for a single statement (a one-line `if` without a block is the only allowed exception).
- Prefer `for...of` to iterate arrays; plain `for` and `forEach` are also fine.
- Avoid assigning inside a control condition; if you must, wrap it in extra parentheses.

## Exceptions

- Throw exceptions for exceptional cases; instantiate with `new Error(...)` and throw only `Error` (or subclasses). Define custom error subclasses when `Error` is insufficient.
- In a `catch`, assume the value is an `Error`; only handle non-`Error` throws when the API is known to produce them, with a comment saying where they come from.
- Almost never swallow an exception silently; if doing nothing is genuinely right, say why in a comment. Keep `try` blocks small.

## `switch`

- Every `switch` has a `default`, placed last. Each non-empty case group ends with `break`/`return`/`throw` — no fall-through. Empty case groups may fall through.

## Disallowed

- No `var`, `with`, `eval`, or `Function(string)` (loaders are the rare exception).
- No `const enum` — use a plain `enum`.
- No wrapper-object instances: `new String/Number/Boolean` (calling them as functions to coerce is fine).
- Don't rely on automatic semicolon insertion — terminate statements with `;`.
- Don't modify built-in objects or add to the global object. No `debugger` in committed code. Use only standardised ECMAScript features (avoid TC39 draft/proposal features).

## Formatting

The guide defers most formatting to the formatter (clang-format / Prettier / Biome). Defaults: 2-space indent, single quotes, semicolons required. **Trailing commas are a formatter decision — the guide does not ban them.** Match the repo's enforced formatter on any point where it differs.
