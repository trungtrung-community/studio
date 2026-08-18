import fs from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  buildRecordingPlan,
  flattenPlanItems,
  toMasterPath,
  type RecordingPlan,
} from '@/lib/recording-plan';

const DESIGN_SYSTEM_PATH = path.resolve(import.meta.dirname, '..', '..', 'design-system');

/**
 * The plan is expensive enough to build that every test shares one.
 *
 * Nothing here mutates it.
 */
const plan: RecordingPlan = buildRecordingPlan(DESIGN_SYSTEM_PATH);

/**
 * Counts taken from the content on 2026-08-18.
 *
 * These are a tripwire rather than a specification. Content genuinely changes,
 * and when it does this test should fail loudly so the figure is recounted
 * rather than assumed. It must never be updated to match a number that has not
 * been explained.
 *
 * Regrouped and recounted 2026-08-18, and both halves are explained.
 *
 * The REGROUPING moved no takes. `read-prefixes` is the old `read-stacks-prefix`
 * (48 bare combinations) merged with the old `read-prefix-syllables` (the same 48
 * in four vowels) — one thing said five ways, previously four groups apart.
 * `read-endings` became `read-suffixes` + `read-second-suffixes`, split on the
 * sections already distinct inside it and renamed to the word
 * `docs/08-glossary.md` uses.
 *
 * The RECOUNT is 543 Read takes -> 3,481, and it is content, not counting.
 * `content/read/combinations.json` measures which letter combinations Tibetan
 * actually writes, so stacks gain the 77 of three and four letters that §4.3's
 * pairwise tables cannot express (`read-stacks-compound`). Every non-prefix
 * combination gains its four vowel forms (`read-stacks-vowel`, 604). And two
 * groups are new pile material for the training ground rather than the walk —
 * every root carrying every ending in every vowel (2,064), and the remaining
 * syllables the board draws or a taught word contains (193). No stop names any
 * of it: the design-system still generates 44 stops, 1,003 positions and 559
 * exercises, unchanged, which is the check that it is dataset and not
 * curriculum.
 *
 * Regrouped again 2026-08-18, and again no take moved: every combination is now
 * collected beside its own four vowel forms, the way `read-prefixes` already
 * was. `stack-grid` and `ending-grid` were families rather than sittings, so
 * grouping by them had separated every superscript, subscript and compound
 * stack from its own vowels — the same defect the prefix merge fixed, left in
 * place for the other three. `read-worked-syllables` is 22 rather than 24
 * because ཐུགས and རོགས are plain root+vowel+suffix+suffix2 and are now said
 * once, in the second-suffix sitting, instead of twice.
 *
 * The Read half of this table sums to 3,481, which is what
 * `content/json/read/read-recording-script.md` independently reports.
 */
const EXPECTED_GROUP_SIZES: Readonly<Record<string, number>> = {
  'read-letters': 44,
  'read-letter-vowel': 120,
  'read-prefixes': 240,
  'read-superscripts': 165,
  'read-subscripts': 205,
  'read-compound-stacks': 385,
  'read-suffixes': 1_500,
  'read-second-suffixes': 600,
  'read-combiners': 7,
  'read-worked-syllables': 22,
  'read-corpus': 193,
};

const EXPECTED_TOTAL_TAKES = 4_942;

describe('buildRecordingPlan', () => {
  it('counts every take the content calls for', () => {
    expect(plan.totalTakes).toBe(EXPECTED_TOTAL_TAKES);
  });

  it('agrees with itself about the total', () => {
    const summed = plan.groups.reduce((total, group) => total + group.items.length, 0);
    expect(summed).toBe(plan.totalTakes);
  });

  it.each(Object.entries(EXPECTED_GROUP_SIZES))('puts %i takes in %s', (groupId, size) => {
    const group = plan.groups.find((candidate) => candidate.id === groupId);
    expect(group, `no group ${groupId}`).toBeDefined();
    expect(group?.items).toHaveLength(size);
  });

  it('covers all twenty-four districts', () => {
    const speakGroups = plan.groups.filter((group) => group.track === 'speak');
    expect(speakGroups).toHaveLength(24);
    const speakTakes = speakGroups.reduce((total, group) => total + group.items.length, 0);
    expect(speakTakes).toBe(1_461);
  });

  it('gives every item a unique id', () => {
    const items = flattenPlanItems(plan);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it('gives every item a unique delivery path', () => {
    const items = flattenPlanItems(plan);
    expect(new Set(items.map((item) => item.audioPath)).size).toBe(items.length);
  });

  it('gives every item Tibetan to read aloud', () => {
    const silent = flattenPlanItems(plan).filter((item) => !item.tibetan.trim());
    expect(silent).toEqual([]);
  });

  it('delivers every take as an m4a under the audio root', () => {
    const wrong = flattenPlanItems(plan).filter(
      (item) => !/^audio\/[a-z-]+\/.+\.m4a$/.test(item.audioPath),
    );
    expect(wrong).toEqual([]);
  });

  it('mints the Speak path the exercise prompts already contain', () => {
    const items = flattenPlanItems(plan);
    expect(items.find((item) => item.id === 'vocab.core.tashi-delek')?.audioPath).toBe(
      'audio/vocab/core/tashi-delek.m4a',
    );
  });

  it('namespaces Speak paths by district, because two phrases share a slug', () => {
    const shared = flattenPlanItems(plan).filter((item) =>
      item.audioPath.endsWith('/are-you-married.m4a'),
    );
    expect(shared.length).toBeGreaterThan(1);
    expect(new Set(shared.map((item) => item.audioPath)).size).toBe(shared.length);
  });

  it('covers every audio path the generated exercises ask for', () => {
    // The binding contract. `generate_stops.py` writes an audio path into every
    // listen-pick prompt, and the app resolves exactly that string. A take
    // recorded to any other path is a file nothing will ever look for, so the
    // plan must be a superset of what the exercises reference.
    const exercisesPath = path.join(DESIGN_SYSTEM_PATH, 'content', 'exercises.json');
    const parsed = JSON.parse(fs.readFileSync(exercisesPath, 'utf8')) as
      | Array<{prompt?: {audio?: string}}>
      | {exercises: Array<{prompt?: {audio?: string}}>};
    const exercises = Array.isArray(parsed) ? parsed : parsed.exercises;

    const referenced = new Set(
      exercises.map((exercise) => exercise.prompt?.audio).filter(Boolean) as string[],
    );
    const planned = new Set(flattenPlanItems(plan).map((item) => item.audioPath));

    expect(referenced.size).toBeGreaterThan(1_000);
    expect([...referenced].filter((audioPath) => !planned.has(audioPath))).toEqual([]);
  });

  it('uses the path the Read content already declares', () => {
    const items = flattenPlanItems(plan);
    expect(items.find((item) => item.id === 'syllable.ki')?.audioPath).toBe(
      'audio/syllables/ki.m4a',
    );
    expect(items.find((item) => item.id === 'stack.rka')?.audioPath).toBe(
      'audio/stacks/rka.m4a',
    );
  });

  it('collapses a prefix form onto its parent rather than recording it twice', () => {
    // The drilled vowel of a prefix demonstration repeats the parent's path.
    // Both must resolve to one take, or 48 sounds get spoken twice.
    const prefixGroup = plan.groups.find((group) => group.id === 'read-prefixes');
    const paths = prefixGroup?.items.map((item) => item.audioPath) ?? [];
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('audio/syllables/gcu.m4a');
    expect(paths).toContain('audio/syllables/gci.m4a');
  });

  it('keeps a prefix combination beside its own vowel forms', () => {
    // The reason the two groups were merged. A speaker says གཅ གཅི གཅུ གཅེ གཅོ in
    // one breath; recording the bare forms four sittings away from the voweled
    // ones is what made གཅ look missing.
    const prefixGroup = plan.groups.find((group) => group.id === 'read-prefixes');
    expect(prefixGroup?.items.slice(0, 5).map((item) => item.tibetan)).toEqual([
      'གཅ',
      'གཅི',
      'གཅུ',
      'གཅེ',
      'གཅོ',
    ]);
  });

  it('warns the speaker where a spelling reads two ways', () => {
    // Seventeen prefix combinations are also a root carrying a suffix. The item
    // records the parse it is; the alternate is shown so the other is not said.
    const items = flattenPlanItems(plan);
    // Each reading names its own root, because that is what settles it: གད is
    // `da` with ད carrying the syllable, and `khee` with ག carrying it.
    const ambiguous = items.find((item) => item.id === 'stack.gda');
    expect(ambiguous?.romanization).toBe('da');
    expect(ambiguous?.root).toBe('ད');
    expect(ambiguous?.alsoReads).toEqual([
      {as: 'root + suffix', romanization: 'khee', wylie: 'gad', root: 'ག'},
    ]);

    const flagged = items.filter((item) => item.alsoReads.length > 0);
    expect(flagged).toHaveLength(17);
  });

  it.each([
    ['read-superscripts', ['རྐ', 'རྐི', 'རྐུ', 'རྐེ', 'རྐོ']],
    ['read-subscripts', ['ཀྱ', 'ཀྱི', 'ཀྱུ', 'ཀྱེ', 'ཀྱོ']],
    ['read-compound-stacks', ['རྒྱ', 'རྒྱི', 'རྒྱུ', 'རྒྱེ', 'རྒྱོ']],
    ['read-suffixes', ['ཀག', 'ཀིག', 'ཀུག', 'ཀེག', 'ཀོག']],
    ['read-second-suffixes', ['ཀགས', 'ཀིགས', 'ཀུགས', 'ཀེགས', 'ཀོགས']],
  ])('opens %s on one combination in all five vowels', (groupId, expected) => {
    // The point of the grouping. A speaker says a combination and its four
    // vowels in one breath; collecting the bare forms into one sitting and the
    // voweled ones into another is what made གཅ look missing in the first place.
    const group = plan.groups.find((candidate) => candidate.id === groupId);
    expect(group?.items.slice(0, 5).map((item) => item.tibetan)).toEqual(expected);
  });

  it('runs the suffix grid one root at a time', () => {
    // Root, then suffix, then vowel — fifty cards per root. The generator emits
    // root, then vowel, then suffix, which would interleave the roots.
    const group = plan.groups.find((candidate) => candidate.id === 'read-suffixes');
    expect(group?.items.slice(48, 53).map((item) => item.tibetan)).toEqual([
      'ཀེས',
      'ཀོས',
      'ཁག',
      'ཁིག',
      'ཁུག',
    ]);
  });

  it('names the suffixes what the glossary names them', () => {
    const titles = plan.groups.map((group) => group.title);
    expect(titles).toContain('Suffixes');
    expect(titles).toContain('Second suffixes');
    expect(titles).not.toContain('Endings');
  });

  it('strips the review marker but keeps the question', () => {
    const flagged = flattenPlanItems(plan).filter((item) => item.reviewQuestion);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((item) => !item.reviewQuestion?.startsWith('[REVIEW]'))).toBe(true);
  });
});

describe('toMasterPath', () => {
  it('puts the master beside the delivery path', () => {
    expect(toMasterPath('audio/syllables/ki.m4a')).toBe('audio/syllables/ki.wav');
  });
});
