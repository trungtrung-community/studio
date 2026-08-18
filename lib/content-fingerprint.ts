/**
 * @fileoverview What a card said, condensed to one string.
 *
 * This exists to answer a question the item id cannot: *has this card been
 * corrected since I set it aside?*
 *
 * The ids are stable across exactly the corrections most likely to be made.
 * Speak ids are `{kind}.{district}.{slug}`, where the slug is the English handle
 * authored in the content spec (`scripts/content/parse_spec.py`), and Read ids
 * are built from Wylie — the spelling (`scripts/build_read.py`). So fixing a
 * word's Tibetan, or fixing its romanization, leaves the id untouched. Without
 * something else to compare, a flag raised against a wrong reading would still
 * be standing long after the reading was fixed, and the only way to clear it
 * would be to remember which ones had been dealt with.
 *
 * Comparing the card's own text closes that. Change the text and the fingerprint
 * changes; change the handle or the spelling and the id changes instead, which
 * the plan already notices on its own.
 */

import {createHash} from 'node:crypto';

/** The fields of a card that a speaker could be objecting to. */
export interface FingerprintedContent {
  tibetan: string;
  romanization: string | null;
  english: string | null;
  wylie: string | null;
}

/** Characters kept from the digest. Long enough that a collision is not a risk. */
const FINGERPRINT_LENGTH = 16;

/**
 * What the fields are joined on before hashing.
 *
 * The ASCII unit separator, which cannot occur in Tibetan, in a romanization or
 * in an English gloss. Written as an escape rather than as the character itself,
 * which is invisible in a source file.
 */
const FIELD_SEPARATOR = '\u001f';

/**
 * Condenses everything a card shows into one comparable string.
 *
 * Only the fields the speaker reads are included. The audio path, the register
 * and the open question can all change without the reading changing, and a flag
 * raised against a reading should survive them.
 *
 * @example
 * fingerprintItem({tibetan: 'ཀ', romanization: 'ka', english: null, wylie: null});
 * // => 'd0f5a1c39b27e884'
 */
export function fingerprintItem(content: FingerprintedContent): string {
  const fields = [
    content.tibetan,
    content.romanization ?? '',
    content.english ?? '',
    content.wylie ?? '',
  ];
  return createHash('sha256')
    .update(fields.join(FIELD_SEPARATOR))
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}
