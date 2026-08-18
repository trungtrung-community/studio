# Trungtrung Studio

The recording tool for the Trungtrung Speak and Read tracks. It is where the
voice gets recorded, measured, cleaned and handed to the content pipeline.

Audio is the project's critical path. `docs/07` in the design-system repository
puts it plainly: recording sits *"ahead of all code, and the native-review pass
sits on it."* Two thousand and forty of the app's exercises are blocked on it,
including every `listen-pick`.

## What it does

- Computes the recording plan from the design-system content, so the total is
  never written down by hand.
- Records one take at a time, driven entirely from the keyboard.
- Measures every take and flags the ones worth hearing again.
- Cleans and encodes them in a batch pass that never touches the masters.
- Exports a checksummed bundle the content pipeline imports.

## Setup

```sh
npm install
brew install ffmpeg      # needed only for `npm run master`
```

Then open `studio.config.json`:

| Field | Meaning |
|---|---|
| `designSystemPath` | The design-system repository. Read-only; the studio never writes to it. |
| `dataPath` | Masters, the ledger and the export bundle. Gitignored. |
| `backupPath` | **Set this.** Masters are mirrored here after every take. |

`backupPath` is deliberately not defaulted. Masters are the only artefact here
that cannot be produced again without speaking into a microphone, and they are
not in git. The dashboard says so until it is set.

## Recording

```sh
npm start        # build and serve — use this for a real sitting
npm run dev      # hot reload — for working on the tool, not for recording
```

Pick a group, capture the room, then work down the list.

| Key | |
|---|---|
| `Space` | start / stop recording |
| `P` | play the take back |
| `Enter` | keep it and move on |
| `R` | redo |
| `F` | disagree with the written form |
| `←` `→` | move without recording |

A take lives in the browser until `Enter`. Redoing throws it away without the
server ever seeing it, so nothing has to be cleaned up.

**The room is captured once per sitting.** Three seconds of silence, whose
measured floor keys the denoiser for everything that follows. A capture more
than six hours old is treated as a different room.

**A `[REVIEW]` flag is not a reason to skip an item.** Roughly a third of
vocabulary carries an open question for a native reviewer, and the audio is
draft exactly as the written form is. Record it, and press `F` if you think the
reading is wrong — that note reaches the reviewer alongside the take.

## After a sitting

```sh
npm run master   # clean and encode everything recorded so far
npm run bundle   # write data/out/ for the content pipeline
```

Mastering is incremental and idempotent. It reads masters and writes beside
them, so changing any constant in `lib/audio-constants.ts` and running it again
re-cleans everything without anyone recording again.

The chain, per take:

```
highpass 80 Hz          rumble, plosives, desk thumps
afftdn                  hiss, keyed to that sitting's room tone
silenceremove ×2        trim to 80 ms lead-in, 150 ms tail
loudnorm −16 LUFS       two-pass: measure, then correct
→ AAC 48 kbps mono      delivery
→ FLAC                  archive, from the untouched master
```

Two-pass loudness normalisation is the point. It is what makes the first take
and the two-thousandth sit at the same volume in the app.

## There are no slow takes

The content used to call for a second, slower reading of every word and phrase.
It no longer does. `expo-audio` slows playback natively on both platforms with
pitch correction, so the app plays the same recording at `0.65×`. That decision
removed 587 takes from the critical path.

The one thing it cannot do is insert pauses *between* syllables, which a human
slow reading does naturally. If the native review ever wants a real slow take
for a specific long phrase, the content schema still has room for one.

## Layout

```
app/          pages and route handlers
components/   ui/ is vendored shadcn; the rest is this tool
hooks/        microphone capture
lib/          the plan, the ledger, the codec, mastering, export
public/       capture-worklet.js — must stay here, see its own comment
scripts/      npm run master · npm run bundle
test/         vitest
data/         masters, ledger, bundle — gitignored
```

## Conventions

TypeScript follows `.claude/skills/google-typescript-style`. Named exports,
JSDoc on every export, names spelled out rather than abbreviated.

```sh
npm run validate    # typecheck, lint, test
```

The plan test asserts the exact take count. When content changes it will fail —
that is deliberate. Recount and explain the new figure rather than editing the
number to match.
