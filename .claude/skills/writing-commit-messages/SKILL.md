---
name: writing-commit-messages
description: Use when writing or editing a git commit message — composing a commit, amending, rewording, or squashing, or when asked to "write a commit message" or "make this commit message better". Based on the cbea.ms seven rules (content) and Conventional Commits (format).
---

# Writing Commit Messages

## Overview

A good commit message has two layers:

- **Format** — a structured, scannable subject: **Conventional Commits**.
- **Content** — clear, imperative prose explaining the change: the **cbea.ms
  seven rules**.

The diff shows WHAT changed; the message explains WHY. Well-formed messages keep
`git log`, `shortlog`, `blame`, `rebase`, and `revert` readable.

## When to use

- Composing any commit, especially when a `-m` one-liner isn't enough
- Amending, rewording, or squashing commits
- Asked to improve or rewrite an existing message

Not every commit needs a body. A self-evident one-liner is fine with just a
subject: `git commit -m "fix: correct typo in onboarding guide"`.

## Format — Conventional Commits

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

- **type** — `feat` (a new feature) and `fix` (a bug fix) are the core two. Also
  common (Angular / commitlint convention): `build`, `chore`, `ci`, `docs`,
  `style`, `refactor`, `perf`, `test`, `revert`.
- **scope** (optional) — a noun in parentheses naming the area: `feat(parser):`.
- **breaking change** — add `!` before the colon (`feat!:`) and/or a
  `BREAKING CHANGE:` footer.
- **footers** — `Token: value`, one per line, after a blank line. Hyphenate
  multi-word tokens (`Reviewed-by:`), except the literal `BREAKING CHANGE`.

Intent (SemVer): `fix` → PATCH, `feat` → MINOR, any breaking change → MAJOR.

```
feat(lang): add Polish language
fix: prevent racing of requests
feat!: drop support for Node 16
```

## Content — the cbea.ms seven rules

1. Separate subject from body with a blank line
2. Limit the subject to ~50 characters (72 hard limit) — the `type(scope):`
   prefix counts toward it
3. Capitalize the description — **except** in Conventional Commits, where the
   type and description are lowercase by convention (`fix: prevent racing…`)
4. Do not end the subject with a period
5. Use the imperative mood in the description (`add`, `fix` — not `added`/`fixes`)
6. Wrap the body at 72 characters
7. Use the body to explain what and why, not how

## Imperative mood — the test

The description completes this sentence:

> If applied, this commit will **\<description\>**

- ✅ `fix: prevent racing of requests`
- ✅ `feat: add retry to the upload client`
- ✅ `refactor: remove deprecated auth helper`
- ❌ `fix: prevented racing of requests` (past tense)
- ❌ `fix: fixes the race` (indicative)
- ❌ `chore: more cleanup` / `wip` (not a command)

## Template

```
type(scope): summarize the change in the imperative, ~50 chars

Explain the problem this commit solves and WHY this change is being made —
not how (the code shows how). Wrap the body at 72 characters.
```

The ticket isn't repeated here — it rides on the MR title (see Ampere reality).

## Body — what and why, not how

- Explain the problem, the prior behavior, what was wrong, and why you solved it
  this way.
- Leave out the _how_ — the diff and source comments cover that.
- Wrap at 72 so `git log`'s indentation stays under 80 columns.

```
refactor: simplify error handling in the stream reader

The reader carried a `state` flag and an `exceptmask` that always included
failbit, so any failure raised immediately anyway. Drop both and throw
directly; this also removes now-dead code in good() and clear().
```

## Common mistakes

| Mistake                                      | Fix                                                      |
| -------------------------------------------- | -------------------------------------------------------- |
| Subject and body run together                | Insert a blank line — `log`/`rebase` rely on it          |
| Capitalized CC description (`fix: Prevent…`) | Lowercase the type and description                       |
| No type, or a vague one (`update: …`)        | Use `feat`/`fix`/`refactor`/… as fits                    |
| `TCK-1234:` prefix on a branch commit        | Drop it — the MR title carries the ticket (squash-merge) |
| Body explains _how_                          | Delete it; explain _why_ instead                         |
| One commit doing many things                 | Split into atomic commits                                |

## Ampere reality

- **Feature-branch commits use pure Conventional Commits** — `type(scope):
description`, no ticket prefix. The **MR title carries the ticket**
  (`TCK-1234: <title>`, per **git-flow** / `CLAUDE.md`), and squash-on-merge
  folds the branch commits into that single titled commit on `develop`/`main`.
  So the ticket is captured once, at merge.
- This supersedes the older per-commit `TCK-<n>:` / `P-0X:` subject prefix.
- **Caveat:** on a non-squash merge the branch's commits land without a ticket
  reference — add a `Refs: TCK-1234` footer if you need that traceability.
- There is **no Conventional Commits tooling** here (no commitlint,
  semantic-release, or changelog generation). CC buys clarity and consistency —
  not automated versioning (yet).
