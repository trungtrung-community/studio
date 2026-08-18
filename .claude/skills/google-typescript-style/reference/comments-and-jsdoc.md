# Comments & documentation

The full standard for JSDoc and comments. The governing idea: **prefer improving code over explaining code** — make the comment unnecessary first (rename, extract, simplify). What remains follows two rules (stated in `SKILL.md`):

1. **Document the purpose, not the mechanics.**
2. **A comment explains why the code exists — never the incident that produced it.**

## JSDoc vs line comments

- `/** ... */` (JSDoc) documents exported / public functions, classes, methods, and properties. Tools and editors surface it at call sites.
- `//` line comments explain non-obvious implementation details _inside_ a body or on private members.
- Don't use JSDoc (`/** */`) for inline implementation notes, and don't use `//` where an API needs documented JSDoc.

## When JSDoc is required, and when to omit it

- **Required** on exported and public/protected API surface.
- **Omit** when it would only restate the signature. A `getUserName(): string` named that clearly needs no JSDoc saying "returns the user name."
- Private and trivially obvious members usually need no JSDoc; add it when intent isn't obvious from the code.

## Tags

- **`@param name`** — only when it adds information the type doesn't: units, ranges, what an empty/absent value means, ownership. The type itself is inferred by TypeScript and need not be repeated in the comment. If every param is self-explanatory, omit them all rather than writing noise.
- **`@returns`** — what the return value means (not its type). Omit for `void`.
- **`@example`** — include for any non-obvious API. Show a real call and the result it produces; cover an edge case when one exists.
- **`@deprecated`** — state what to use instead and how to migrate.
- **`@fileoverview`** — at the top of a file, one short block describing the file's purpose.

## Document why, not what

The code already says _what_ it does. The comment earns its place by saying _why_.

```ts
// BAD — restates the code
// loop over users and push active ones
for (const user of users) {
  if (user.active) active.push(user);
}

// GOOD — explains the why, or says nothing at all
// Billing only counts users active at month end; suspended trials are excluded upstream.
```

## Write for a reader without your context

The reader arrives with none of the context you have now. Don't reference a feature, module, or acronym they can't resolve from here — say what it _is_.

```ts
// BAD — names an internal mode the reader here can't resolve
// Skipped in fast-path mode.

// GOOD — says what it is
// Skipped for cache hits: the payload was already validated upstream.
```

## Make it scannable — one idea per sentence

Accurate and _readable_ are different bars. A comment can be technically perfect yet hard to absorb because it packs several ideas into one long sentence. Optimize for a quick skim: one idea per sentence, related ideas grouped into short paragraphs, and distinct responsibilities kept in distinct sentences (e.g. what a consumer does vs. what the use case it calls does).

AI-drafted JSDoc skews this way by default — long sentences, stacked clauses, ideas fused behind punctuation. This section is the counterweight.

**The split test.** When a colon, em-dash, or parenthetical joins two ideas the reader must hold at once, split it into separate sentences. When it punctuates a single idea — or introduces a bullet list, or is a short appositive gloss — keep it.

```ts
// BAD — one sentence, several ideas fused by a colon and an em-dash
// Publishes pending entries then marks them sent: publishing first gives at-least-once
// delivery, so a crash in between leaves the entry pending and the next run re-publishes
// it — consumers must tolerate duplicates.

// GOOD — one idea per sentence
// Publishes pending entries, then marks them sent. Publishing first gives at-least-once
// delivery. If the process crashes in between, the entry stays pending and the next run
// re-publishes it. Consumers must therefore tolerate duplicates.
```

A semicolon- or comma-separated list embedded in prose usually reads better as a Markdown bullet list (blank line, then `- item`).

**Don't over-correct.** This is one idea per _sentence_, not one clause per sentence. If a split leaves two <5-word fragments that only make sense together, it was one idea — keep it. Scanability never means dropping information: preserve every documented invariant, failure mode, and rationale, and don't flatten intent into generic prose.

## Purpose, not incident

A comment must state the standing purpose of the code, so it stays true forever. It must not narrate the bug, ticket, or fix that prompted the change — that information lives in the commit message and the MR, where the history belongs. An incident comment is stale the moment the bug is forgotten; a purpose comment is permanent.

```ts
// BAD — narrates the incident
// Added null check after prod incident on 2026-03-02 (TCK-388)
if (!facility) return;

// GOOD — states the standing purpose
// A facility can be absent for alarms that predate facility assignment;
// callers expect a no-op here rather than a thrown error.
if (!facility) return;
```

```ts
// BAD — fix story; reads as archaeology in six months
// We used to await this but it caused a deadlock, so now we fire-and-forget
void publishEvent(event);

// GOOD — purpose; explains the design intent
// The event bus is best-effort: a publish failure must not block the request path.
void publishEvent(event);
```

## Examples in docs

For anything a caller could plausibly misuse — non-obvious return shapes, defaulting behaviour, units, ordering guarantees — add an `@example`. A worked call is worth more than a paragraph.

```ts
/**
 * Splits a reading window into whole-day buckets in the facility's local time,
 * so a window that straddles midnight produces one bucket per calendar day.
 *
 * @param window Inclusive start/end instants (UTC).
 * @param timeZone IANA zone of the facility, e.g. 'Europe/Berlin'.
 * @returns Buckets ordered earliest-first; empty when start > end.
 * @example
 * bucketByLocalDay({start, end}, 'Europe/Berlin');
 * // => [{ day: '2026-06-24', ... }, { day: '2026-06-25', ... }]
 */
```
