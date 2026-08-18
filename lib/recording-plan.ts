/**
 * @fileoverview The queue of everything that has to be spoken, computed.
 *
 * The recording total is not written down anywhere in this repository. It is
 * derived from the design-system content on every run, because the figure has
 * been maintained by hand before and drifted. `docs/09-backlog.md` #9 records
 * three totals that contradict each other and one that contradicts its own
 * arithmetic.
 *
 * Two sources feed the plan and they behave differently.
 *
 * The Read track already declares the file each take belongs in. Those paths
 * are used verbatim, so the studio and the content pipeline cannot disagree
 * about where a recording lives.
 *
 * The Speak track declares no path on its records, but it does not get to
 * choose one either. `generate_stops.py` already mints
 * `audio/<kind>/<district>/<slug>.m4a` into 1,457 exercise prompts, so that is
 * the contract and it is reproduced here exactly. A take written anywhere else
 * is a file the app will never look for.
 *
 * The district is part of the path and has to be. Two phrases share a slug —
 * `are-you-married` and `im-full` — and only the district keeps them apart.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Which of the two learning tracks a group belongs to. */
export type TrackName = 'speak' | 'read';

/**
 * A second legal reading of the same written form.
 *
 * Seventeen of the forty-eight prefix combinations are also a root carrying a
 * suffix — `གད` is `da` read as prefix ག + root ད, and `khee` read as root ག +
 * suffix ད. Both are Tibetan; only context decides, and the content declares
 * which parse each item is. The speaker is shown the other one so they cannot
 * record it by accident.
 */
export interface AlternateReading {
  /** How the other parse is built, e.g. `root + suffix`. */
  as: string;
  romanization: string;
  wylie: string;
  /** The letter carrying the syllable under this reading. */
  root: string;
}

/** One thing to say once, and everything the speaker needs on screen to say it. */
export interface RecordingItem {
  /** Stable content id. Also the key the content pipeline merges audio back on. */
  id: string;
  /** Tibetan script, shown large. This is what is being read aloud. */
  tibetan: string;
  /** How it sounds, in the Trungtrung romanization. Null where none is defined. */
  romanization: string | null;
  /** English meaning. Null for Read items, which teach a sound rather than a word. */
  english: string | null;
  /** Wylie transliteration, shown small as a disambiguator. */
  wylie: string | null;
  /** Register tag, where the content declares one. */
  register: string | null;
  /**
   * The open question a native reviewer still has to answer about this record.
   *
   * Present on roughly a third of vocabulary. The take is still recorded. The
   * question is shown so the speaker can disagree with the reading rather than
   * record something they believe is wrong.
   */
  reviewQuestion: string | null;
  /**
   * The root letter — the མིང་གཞི everything else hangs off.
   *
   * Shown only where the spelling reads two ways, because that is where saying
   * it correctly depends on knowing which letter carries it. Null for the
   * Speak track, which is words rather than spellings.
   */
  root: string | null;
  /** Other ways this spelling reads. Empty for everything unambiguous. */
  alsoReads: readonly AlternateReading[];
  /** Where the delivered file belongs, relative to the audio root. */
  audioPath: string;
}

/** A sitting's worth of work: one district, or one part of the Read track. */
export interface RecordingGroup {
  id: string;
  track: TrackName;
  /** Shown as the group heading. */
  title: string;
  /** One line saying what the group covers. */
  description: string;
  items: RecordingItem[];
}

/** Every take the content currently calls for. */
export interface RecordingPlan {
  generatedAt: string;
  totalTakes: number;
  groups: RecordingGroup[];
}

/** A vocabulary or phrase record, narrowed to the fields the studio reads. */
interface SpeakRecord {
  id: string;
  slug: string;
  district: string;
  district_number: number;
  bo: string;
  roman: string | null;
  en: string;
  wylie: string | null;
  register: string | null;
  review_notes: string | null;
}

/** The `audio` object the Read content carries on every recordable item. */
interface DeclaredAudio {
  natural: string | null;
}

interface LetterRecord {
  id: string;
  type: string;
  bo: string;
  letter_name: string;
  audio: DeclaredAudio;
  review_notes: string | null;
}

/** One vowel variant of a prefix-demonstration syllable. */
interface SyllableForm {
  bo: string;
  reading: string;
  wylie: string | null;
  audio: string;
}

/** The seven slots, as the content decomposes a syllable. */
interface SyllableSlots {
  prefix: string | null;
  superscript: string | null;
  /** Null when there is none — the content does not use an empty list here. */
  subscript: string[] | null;
  vowel: string | null;
  suffix: string | null;
  suffix2: string | null;
}

interface SyllableRecord {
  id: string;
  bo: string;
  root: string | null;
  slots: SyllableSlots;
  reading: string;
  /** Which of the seven families of `syllables.json` this belongs to. */
  family: string;
  section: number;
  audio: DeclaredAudio;
  review_notes: string | null;
  forms?: SyllableForm[];
  /** For a prefix demonstration, the id of the bare combination it stands on. */
  demonstrates?: string;
}

/** The other parse of an ambiguous stack, as the content declares it. */
interface DeclaredAlternate {
  as: string;
  reading: string;
  wylie: string;
  root: string;
}

interface StackRecord {
  id: string;
  bo: string;
  root: string | null;
  wylie: string | null;
  reading: string;
  group: string;
  audio: DeclaredAudio;
  review_notes: string | null;
  reads_also_as?: DeclaredAlternate[];
}

interface CombinerRecord {
  id: string;
  name: string;
  name_bo: string;
  specimen: string | null;
  audio: DeclaredAudio;
  review_notes: string | null;
}

/** One suffix or second suffix, in the order the inventory lists them. */
interface AffixRecord {
  bo: string;
  type: string;
}

/** The Read files, loaded once and shared by every group definition. */
interface ReadContent {
  letters: LetterRecord[];
  syllables: SyllableRecord[];
  stacks: StackRecord[];
  combiners: CombinerRecord[];
  affixes: AffixRecord[];
}

/** One sitting's worth of Read work, and how to collect the takes it holds. */
interface ReadGroupDefinition {
  id: string;
  title: string;
  description: string;
  collect: (content: ReadContent) => RecordingItem[];
}

/**
 * The Read track's sittings, in the order they are meant to be recorded.
 *
 * A group is defined by what a speaker records in one go, not by which file the
 * content happens to live in. That distinction is the whole reason this table
 * exists: a prefix combination is a `stack` record when it is bare and a
 * `syllable` record once it carries a vowel, so grouping by file splits `གཅ`
 * away from `གཅི གཅུ གཅེ གཅོ` and puts them four sittings apart. They are one
 * thing said five ways, and `read-prefixes` records them together.
 *
 * The names follow `docs/08-glossary.md`, which is the naming authority and
 * says suffix and second suffix. The Read spec's prose calls them endings; the
 * glossary does not, so neither does this.
 */
const READ_GROUPS: readonly ReadGroupDefinition[] = [
  {
    id: 'read-letters',
    title: 'Letter names',
    description: 'The thirty, the four vowel marks and the ten digits.',
    collect: ({letters}) => letters.map(toLetterItem),
  },
  {
    id: 'read-letter-vowel',
    title: 'Letter × vowel',
    description: 'Every letter carrying every vowel mark.',
    collect: ({syllables}) => collectFamily(syllables, 'grid'),
  },
  {
    id: 'read-prefixes',
    title: 'Prefixes',
    description: 'Each prefix combination bare, then in all four vowels.',
    collect: (content) => collectCombinations(content, 'prefix'),
  },
  {
    id: 'read-superscripts',
    title: 'Superscripts',
    description: 'Each superscript combination bare, then in all four vowels.',
    collect: (content) => collectCombinations(content, 'superscript'),
  },
  {
    id: 'read-subscripts',
    title: 'Subscripts',
    description: 'Each subscript combination bare, then in all four vowels.',
    collect: (content) => collectCombinations(content, 'subscript'),
  },
  {
    id: 'read-compound-stacks',
    title: 'Compound stacks',
    description: 'Three and four letters, bare then in all four vowels.',
    collect: (content) => collectCombinations(content, 'compound'),
  },
  {
    id: 'read-suffixes',
    title: 'Suffixes',
    description: 'Every root carrying every suffix, in all five vowels.',
    collect: (content) => collectEndings(content, {second: false}),
  },
  {
    id: 'read-second-suffixes',
    title: 'Second suffixes',
    description: 'The second suffix ས, on the four suffixes it may follow.',
    collect: (content) => collectEndings(content, {second: true}),
  },
  {
    id: 'read-combiners',
    title: 'Combiner names',
    description: 'The seven superscripts and subscripts, said by name.',
    collect: ({combiners}) => combiners.map(toCombinerItem),
  },
  {
    id: 'read-worked-syllables',
    title: 'Worked syllables',
    description: 'Real syllables taken off the board.',
    collect: ({syllables}) => collectFamily(syllables, 'worked'),
  },
  {
    id: 'read-corpus',
    title: 'The rest of the corpus',
    description: 'What the board draws and the taught words contain.',
    collect: ({syllables}) => collectFamily(syllables, 'corpus'),
  },
];

/**
 * Builds the whole recording plan from the design-system content.
 *
 * @param designSystemPath Root of the design-system repository.
 * @returns Groups in the order they are meant to be recorded, Read first.
 * @example
 * const plan = buildRecordingPlan('../design-system');
 * plan.totalTakes; // => 2004
 */
export function buildRecordingPlan(designSystemPath: string): RecordingPlan {
  const groups = [
    ...buildReadGroups(designSystemPath),
    ...buildSpeakGroups(designSystemPath),
  ];

  return {
    generatedAt: new Date().toISOString(),
    totalTakes: groups.reduce((runningTotal, group) => runningTotal + group.items.length, 0),
    groups,
  };
}

/** Reads one JSON file from the design-system content tree. */
function readContent<T>(designSystemPath: string, ...segments: string[]): T {
  const filePath = path.join(designSystemPath, 'content', ...segments);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

/**
 * Turns the open-question text a record carries into the question to display.
 *
 * The content marks these with a `[REVIEW]` prefix that is noise on screen,
 * since the surrounding interface already says what the flag means.
 */
function toReviewQuestion(reviewNotes: string | null): string | null {
  if (!reviewNotes) {
    return null;
  }
  return reviewNotes.replace(/^\[REVIEW\]\s*/, '').trim() || null;
}

/**
 * Derives an item id from the file a take was declared to live in.
 *
 * Prefix-syllable forms are the only recordable things in the content with a
 * declared path and no id of their own. Deriving the id from the path keeps the
 * two in step, and makes a form that repeats its parent's path collapse onto
 * the same item rather than becoming a second take of one sound.
 *
 * @example
 * idFromAudioPath('audio/syllables/gci.m4a'); // => 'syllable.gci'
 */
function idFromAudioPath(audioPath: string): string {
  const [, folder, fileName] = audioPath.split('/');
  const stem = fileName.replace(/\.m4a$/, '');
  const singular = folder.replace(/s$/, '');
  return `${singular}.${stem}`;
}

/** The Read track: letters, syllables, stacks and the combiner names. */
function buildReadGroups(designSystemPath: string): RecordingGroup[] {
  const read = <T,>(fileName: string): T =>
    readContent<T>(designSystemPath, 'json', 'read', fileName);

  const content: ReadContent = {
    letters: read<{letters: LetterRecord[]}>('letters.json').letters,
    syllables: read<{syllables: SyllableRecord[]}>('syllables.json').syllables,
    stacks: read<{stacks: StackRecord[]}>('stacks.json').stacks,
    combiners: read<{combiners: CombinerRecord[]}>('combiners.json').combiners,
    affixes: read<{affixes: AffixRecord[]}>('affixes.json').affixes,
  };

  // A path claimed by an earlier group is not collected again. One path is one
  // recording however many records point at it, and after 2026-08-18 some do:
  // བཞི is a vowel form of the དབ prefix demonstration and also the word
  // "four" the corpus sweep picks up. Twenty-nine spellings are in that
  // position, and listing them twice would put the same card in front of the
  // speaker in two different sittings.
  const claimed = new Set<string>();
  return READ_GROUPS.map((definition) => {
    const items = definition.collect(content).filter((item) => {
      if (claimed.has(item.audioPath)) {
        return false;
      }
      claimed.add(item.audioPath);
      return true;
    });
    return {
      id: definition.id,
      track: 'read' as const,
      title: definition.title,
      description: definition.description,
      items,
    };
  });
}

/**
 * Every syllable of one family, optionally narrowed to some sections.
 *
 * Family and not section, because the two stopped agreeing on 2026-08-18: a
 * `stack-grid` syllable carries its stack's section, so selecting section 6
 * would sweep it in beside the superscripts it is derived from. A family is
 * what a speaker records in one sitting; a section is where it is taught.
 */
function collectFamily(
  syllables: SyllableRecord[],
  family: string,
  sections?: readonly number[],
): RecordingItem[] {
  return syllables
    .filter(
      (syllable) =>
        syllable.family === family &&
        (!sections || sections.includes(syllable.section)),
    )
    .flatMap(toSyllableItems);
}

/**
 * One group of combinations, each bare and then in its four vowels.
 *
 * Ordering is combination-major — `རྐ རྐི རྐུ རྐེ རྐོ`, then `རྒ རྒི …` — because
 * that is how they are spoken: one combination said five ways, not five passes
 * over the same thirty-three. The bare stacks drive the order, so a sitting
 * follows the inventory's own order.
 *
 * The join is declared by the content. A prefix combination is demonstrated by
 * one syllable carrying four `forms`; every other combination is demonstrated
 * by four separate `stack-grid` syllables. Both point back with `demonstrates`,
 * so both are collected the same way and the difference stays in the data.
 */
function collectCombinations(
  {stacks, syllables}: ReadContent,
  group: string,
): RecordingItem[] {
  const demonstrations = new Map<string, SyllableRecord[]>();
  for (const syllable of syllables) {
    if (!syllable.demonstrates) {
      continue;
    }
    const forStack = demonstrations.get(syllable.demonstrates) ?? [];
    forStack.push(syllable);
    demonstrations.set(syllable.demonstrates, forStack);
  }

  return stacks
    .filter((stack) => stack.group === group)
    .flatMap((stack) => [
      toStackItem(stack),
      ...(demonstrations.get(stack.id) ?? []).flatMap(toSyllableItems),
    ]);
}

/**
 * Every root carrying one ending, in every vowel, root by root.
 *
 * Sorted rather than filtered, because the generator emits root → vowel →
 * suffix and a speaker wants root → suffix → vowel: `ཀག ཀིག ཀུག ཀེག ཀོག`, then
 * `ཀང ཀིང …`. Fifty cards per root, one root at a time.
 *
 * The two orders come from the content — the thirty in their row order, the
 * suffixes in the inventory's — so neither is written down twice.
 */
function collectEndings(
  {syllables, letters, affixes}: ReadContent,
  {second}: {second: boolean},
): RecordingItem[] {
  const rootOrder = letters
    .filter((letter) => letter.type === 'consonant')
    .map((letter) => letter.bo);
  const suffixOrder = affixes
    .filter((affix) => affix.type === 'suffix')
    .map((affix) => affix.bo);
  // Bare first, then the four marks in the order section 1 teaches them.
  const vowelOrder = [null, 'ི', 'ུ', 'ེ', 'ོ'];
  const rank = (values: readonly (string | null)[], value: string | null): number => {
    const at = values.indexOf(value);
    return at === -1 ? values.length : at;
  };

  return syllables
    .filter((syllable) => {
      const {prefix, superscript, subscript, suffix, suffix2} = syllable.slots;
      // A syllable built on a bare root. Anything with something above or below
      // it belongs to its own combination's sitting, not to this one.
      if (prefix || superscript || subscript?.length || !suffix) {
        return false;
      }
      return second ? Boolean(suffix2) : !suffix2;
    })
    .sort(
      (left, right) =>
        rank(rootOrder, left.root) - rank(rootOrder, right.root) ||
        rank(suffixOrder, left.slots.suffix) - rank(suffixOrder, right.slots.suffix) ||
        rank(vowelOrder, left.slots.vowel) - rank(vowelOrder, right.slots.vowel),
    )
    .flatMap(toSyllableItems);
}

function toLetterItem(letter: LetterRecord): RecordingItem {
  return {
    id: letter.id,
    tibetan: letter.bo,
    romanization: letter.letter_name,
    english: null,
    wylie: null,
    register: null,
    reviewQuestion: toReviewQuestion(letter.review_notes),
    root: null,
    alsoReads: [],
    audioPath: requireDeclaredPath(letter.audio, letter.id),
  };
}

function toStackItem(stack: StackRecord): RecordingItem {
  return {
    id: stack.id,
    tibetan: stack.bo,
    romanization: stack.reading,
    english: null,
    // Wylie earns its place here: a bare combination sits beside its own vowel
    // forms in the prefix sitting, and the spelling is what tells them apart.
    wylie: stack.wylie,
    register: null,
    reviewQuestion: toReviewQuestion(stack.review_notes),
    root: stack.root,
    alsoReads: (stack.reads_also_as ?? []).map((alternate) => ({
      as: alternate.as,
      romanization: alternate.reading,
      wylie: alternate.wylie,
      root: alternate.root,
    })),
    audioPath: requireDeclaredPath(stack.audio, stack.id),
  };
}

function toCombinerItem(combiner: CombinerRecord): RecordingItem {
  return {
    // A combining mark on its own has no carrier and renders as a stray
    // diacritic. The name is what is being said, so the name is what is shown.
    id: combiner.id,
    tibetan: combiner.name_bo,
    romanization: combiner.name,
    english: null,
    wylie: null,
    register: combiner.specimen ? `as in ${combiner.specimen}` : null,
    reviewQuestion: toReviewQuestion(combiner.review_notes),
    root: null,
    alsoReads: [],
    audioPath: requireDeclaredPath(combiner.audio, combiner.id),
  };
}

/**
 * Expands one syllable record into the takes it calls for.
 *
 * A prefix-demonstration syllable is taught as one thing in four vowels, and
 * each vowel is spoken separately. Every other syllable is a single take.
 */
function toSyllableItems(syllable: SyllableRecord): RecordingItem[] {
  if (!syllable.forms?.length) {
    return [
      {
        id: syllable.id,
        tibetan: syllable.bo,
        romanization: syllable.reading,
        english: null,
        wylie: null,
        register: null,
        reviewQuestion: toReviewQuestion(syllable.review_notes),
        root: syllable.root,
        alsoReads: [],
        audioPath: requireDeclaredPath(syllable.audio, syllable.id),
      },
    ];
  }

  return syllable.forms.map((form) => ({
    id: idFromAudioPath(form.audio),
    tibetan: form.bo,
    romanization: form.reading,
    english: null,
    wylie: form.wylie,
    register: null,
    reviewQuestion: toReviewQuestion(syllable.review_notes),
    root: syllable.root,
    alsoReads: [],
    audioPath: form.audio,
  }));
}

/**
 * Returns the path a Read record declares for its recording.
 *
 * @throws If the record carries no path. A recordable item without one cannot
 *     be delivered, and failing here is better than minting a path the content
 *     pipeline will not look for.
 */
function requireDeclaredPath(audio: DeclaredAudio, id: string): string {
  if (!audio?.natural) {
    throw new Error(`Read record ${id} declares no audio path.`);
  }
  return audio.natural;
}

/** The Speak track: one group per district, its words then its phrases. */
function buildSpeakGroups(designSystemPath: string): RecordingGroup[] {
  const vocabulary = readContent<SpeakRecord[]>(designSystemPath, 'vocabulary.json');
  const phrases = readContent<SpeakRecord[]>(designSystemPath, 'phrases.json');

  const districtNumbers = [
    ...new Set([...vocabulary, ...phrases].map((record) => record.district_number)),
  ].sort((left, right) => left - right);

  return districtNumbers.map((districtNumber) => {
    const words = vocabulary.filter((record) => record.district_number === districtNumber);
    const districtPhrases = phrases.filter(
      (record) => record.district_number === districtNumber,
    );
    const districtName = (words[0] ?? districtPhrases[0]).district;

    return {
      id: `speak-${String(districtNumber).padStart(2, '0')}-${districtName}`,
      track: 'speak' as const,
      title: `${districtNumber}. ${districtName}`,
      description: `${words.length} words · ${districtPhrases.length} phrases`,
      items: [
        ...words.map((record) => toSpeakItem(record, 'vocab')),
        ...districtPhrases.map((record) => toSpeakItem(record, 'phrases')),
      ],
    };
  });
}

/**
 * Converts one Speak record into an item, at the path the exercises expect.
 *
 * The path is reproduced rather than chosen. See this file's overview: the
 * content pipeline has already written this exact string into every
 * `listen-pick` prompt.
 */
function toSpeakItem(record: SpeakRecord, folder: 'vocab' | 'phrases'): RecordingItem {
  return {
    id: record.id,
    tibetan: record.bo,
    romanization: record.roman,
    english: record.en,
    wylie: record.wylie,
    register: record.register,
    reviewQuestion: toReviewQuestion(record.review_notes),
    root: null,
    alsoReads: [],
    audioPath: `audio/${folder}/${record.district}/${record.slug}.m4a`,
  };
}

/**
 * The lossless master a delivered take is produced from.
 *
 * @example
 * toMasterPath('audio/syllables/ki.m4a'); // => 'audio/syllables/ki.wav'
 */
export function toMasterPath(audioPath: string): string {
  return audioPath.replace(/\.m4a$/, '.wav');
}

/** Every item in the plan, flattened, for lookup by id. */
export function flattenPlanItems(plan: RecordingPlan): RecordingItem[] {
  return plan.groups.flatMap((group) => group.items);
}
