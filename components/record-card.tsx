'use client';

import {TibetanText} from '@/components/tibetan-text';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent} from '@/components/ui/card';
import type {RecordingItem} from '@/lib/recording-plan';

interface RecordCardProps {
  item: RecordingItem;
  /** One-based position within the group, so progress is visible without counting. */
  position: number;
  total: number;
  /** Whether a take for this item already stands. */
  isRecorded: boolean;
  /** Whether this card is being passed over as wrong. */
  isSetAside: boolean;
}

/**
 * What to say, and everything needed to say it correctly.
 *
 * The Tibetan is the largest thing on screen because it is what is being read.
 * The romanization sits under it as a check on the reading rather than as the
 * thing to read, and the English disambiguates the homophones the roster
 * contains.
 */
export function RecordCard({
  item,
  position,
  total,
  isRecorded,
  isSetAside,
}: RecordCardProps) {
  return (
    <Card className="w-full">
      <CardContent className="space-y-8 px-8 py-10 text-center">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {position} / {total}
          </span>
          <div className="flex items-center gap-2">
            {item.register ? <Badge variant="outline">{item.register}</Badge> : null}
            {isRecorded ? <Badge variant="secondary">recorded</Badge> : null}
            {isSetAside ? <Badge variant="destructive">set aside</Badge> : null}
          </div>
        </div>

        {/* The one thing being read aloud, at the top of the Tibetan ramp. */}
        <TibetanText size="hero" className="block text-fg-tibetan">
          {item.tibetan}
        </TibetanText>

        {/* Reading order below the glyphs: how it sounds, then what it means,
            then the spelling. Each step drops in size and weight so the eye
            lands on the romanization first without having to choose. */}
        <div className="space-y-2">
          {item.romanization ? (
            <p className="font-heading text-3xl font-semibold tracking-[var(--tracking-display)]">
              {item.romanization}
            </p>
          ) : null}
          {item.english ? (
            <p className="text-base text-muted-foreground">{item.english}</p>
          ) : null}
          {/* --text-subtle would be the design system's choice here, but it is
              2.67:1 on a card and this is 13px. */}
          {item.wylie ? (
            <p className="font-mono text-xs text-muted-foreground">{item.wylie}</p>
          ) : null}
        </div>

        {/* Seventeen of the prefix combinations are also a root carrying a
            suffix, and the two readings sound nothing alike. The romanization
            above is the one to say; this names the other one so it cannot be
            recorded by mistake. */}
        {item.alsoReads.length > 0 ? (
          <div className="rounded-control border border-dashed px-4 py-3 text-left">
            <p className="text-xs font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
              Reads two ways — say{' '}
              <span className="text-foreground">{item.romanization}</span>
            </p>
            {item.root ? (
              <p className="mt-2 text-sm text-muted-foreground">
                The root is <TibetanText className="text-fg-tibetan">{item.root}</TibetanText>.
              </p>
            ) : null}
            {item.alsoReads.map((alternate) => (
              <p key={alternate.wylie} className="mt-2 text-sm text-muted-foreground">
                Not <span className="font-semibold">{alternate.romanization}</span>, which
                is the same spelling with{' '}
                <TibetanText className="text-fg-tibetan">{alternate.root}</TibetanText> as
                the root — {alternate.as}{' '}
                <span className="font-mono text-xs">({alternate.wylie})</span>.
              </p>
            ))}
          </div>
        ) : null}

        {item.reviewQuestion ? (
          <div className="rounded-control bg-surface-reward p-4 text-left dark:bg-beak-600/10">
            <p className="text-xs font-semibold tracking-[var(--tracking-caps)] text-ink-800 uppercase dark:text-beak-600">
              Open question for the native review
            </p>
            <p className="mt-2 text-sm text-ink-700 dark:text-ground-300">
              {item.reviewQuestion}
            </p>
            <p className="mt-3 text-xs text-ink-500 dark:text-ink-300">
              Record it anyway — the audio is draft exactly as the text is. Press{' '}
              <kbd className="keycap">F</kbd> to say you disagree with this reading.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
