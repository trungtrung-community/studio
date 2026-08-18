import {describe, expect, it} from 'vitest';

import {fingerprintItem, type FingerprintedContent} from '@/lib/content-fingerprint';

/** A vocabulary card, as the studio shows it. */
const card: FingerprintedContent = {
  tibetan: 'བཀྲ་ཤིས་བདེ་ལེགས།',
  romanization: 'tashi delek',
  english: 'hello',
  wylie: 'bkra shis bde legs',
};

describe('fingerprintItem', () => {
  it('gives the same card the same value every time', () => {
    expect(fingerprintItem(card)).toBe(fingerprintItem({...card}));
  });

  it('changes when the Tibetan is corrected', () => {
    // The whole point. Correcting a word's script leaves its id alone, so
    // without this a card set aside as wrong would stay flagged after the fix.
    expect(fingerprintItem({...card, tibetan: 'བཀྲ་ཤིས།'})).not.toBe(fingerprintItem(card));
  });

  it('changes when the romanization is corrected', () => {
    expect(fingerprintItem({...card, romanization: 'tashi dele'})).not.toBe(
      fingerprintItem(card),
    );
  });

  it('changes when the English is corrected', () => {
    expect(fingerprintItem({...card, english: 'greetings'})).not.toBe(fingerprintItem(card));
  });

  it('treats an absent field as different from an empty one only by field', () => {
    // Two cards that differ in which field carries the text must not collide.
    const romanizationOnly = {tibetan: 'ཀ', romanization: 'ka', english: null, wylie: null};
    const englishOnly = {tibetan: 'ཀ', romanization: null, english: 'ka', wylie: null};
    expect(fingerprintItem(romanizationOnly)).not.toBe(fingerprintItem(englishOnly));
  });

  it('does not run text together across field boundaries', () => {
    // Joined on nothing, these two would hash identically and a correction that
    // only moved a character between fields would go unnoticed.
    const left = {tibetan: 'ཀ', romanization: 'ka', english: 'b', wylie: null};
    const right = {tibetan: 'ཀ', romanization: 'k', english: 'ab', wylie: null};
    expect(fingerprintItem(left)).not.toBe(fingerprintItem(right));
  });

  it('is short enough to read in a ledger line', () => {
    expect(fingerprintItem(card)).toHaveLength(16);
  });
});
