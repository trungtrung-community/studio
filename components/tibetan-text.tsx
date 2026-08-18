/**
 * @fileoverview Tibetan script, set in the face the app uses.
 *
 * Uchen needs more vertical room than Latin at the same nominal size, because a
 * stack can carry a superscript, a subscript and a vowel above the root. Every
 * place Tibetan appears goes through this component so the line height is
 * decided once rather than guessed per screen.
 *
 * The leading is no longer guessed: --leading-tibetan comes from the design
 * system's typography.css, which calls it "the one non-negotiable rule of this
 * system". It is 2.1, where this file previously hard-coded 1.8 — enough of a
 * difference for a stack carrying both a superscript and a vowel to collide
 * with the line above it.
 *
 * Tibetan is also optically smaller than Latin at the same px size, so the
 * design system ships a parallel --text-tib-* ramp. Callers should size with
 * those rather than with the Latin scale; `size` exposes the three that
 * surface here.
 */

import {cn} from '@/lib/utils';

/**
 * Steps on the design system's Tibetan ramp.
 *
 * These are the composed `--type-tibetan*` roles, which set family, size,
 * weight and line-height together as one utility. That matters here beyond
 * tidiness: `cn()` is tailwind-merge, and tailwind-merge treats `text-*` as
 * carrying a line-height (because `text-lg/7` is valid), so a size class
 * written separately silently deletes the `leading-*` class beside it — which
 * is the one thing this component exists to guarantee.
 *
 * `inherit` sets no size, so it keeps the family and the leading explicitly.
 */
const SIZES = {
  inherit: 'font-tibetan leading-[var(--leading-tibetan)]',
  md: 'type-tibetan',
  hero: 'type-tibetan-hero',
} as const;

interface TibetanTextProps {
  children: string;
  className?: string;
  /** Which step of the Tibetan ramp to set this at. Defaults to inheriting. */
  size?: keyof typeof SIZES;
}

/** Renders Tibetan with the room its stacks need. */
export function TibetanText({children, className, size = 'inherit'}: TibetanTextProps) {
  return (
    <span
      lang="bo"
      // Never letter-spaced: the design system's --tracking-tibetan is 0em
      // because spacing a stack apart breaks it.
      className={cn(SIZES[size], 'tracking-[var(--tracking-tibetan)]', className)}
    >
      {children}
    </span>
  );
}
