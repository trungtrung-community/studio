'use client';

/**
 * @fileoverview The cards passed over, and the ones that have since been fixed.
 *
 * Setting a card aside costs one keystroke during a sitting and says nothing
 * more than which of three things is wrong. This is where that becomes a list of
 * work: grouped by reason, because the three go to three different places.
 *
 * The second section is the point of storing what the card said at the time.
 * Nothing marks a set-aside as dealt with by hand — the studio compares the card
 * against what it read when it was flagged, and a card whose text has changed
 * has been corrected. It is already back in the queue by the time it appears
 * here; the section exists so the correction is visible rather than the card
 * quietly reappearing with no explanation.
 */

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {toast} from 'sonner';

import {TibetanText} from '@/components/tibetan-text';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import type {SetAsideEntry} from '@/lib/progress-summary';
import type {SetAsideReason} from '@/lib/take-ledger';

/** What each reason is called on screen, in the order the sections are shown. */
const REASON_HEADINGS: ReadonlyArray<{reason: SetAsideReason; title: string; detail: string}> =
  [
    {
      reason: 'tibetan',
      title: 'The Tibetan is wrong',
      detail: 'For the content spec and the native review.',
    },
    {
      reason: 'romanization',
      title: 'The romanization is wrong',
      detail: 'For content/read/sounds.json and romanize.py.',
    },
    {
      reason: 'unsure',
      title: 'Not sure how to say it',
      detail: 'A question about the reading rather than either written form.',
    },
  ];

interface SetAsidePanelProps {
  setAside: SetAsideEntry[];
  corrected: SetAsideEntry[];
}

/** One card, with a way to reach it and a way to put it back. */
function EntryRow({entry, onRestored}: {entry: SetAsideEntry; onRestored: () => void}) {
  const [isRestoring, setIsRestoring] = useState(false);

  async function restore(): Promise<void> {
    setIsRestoring(true);
    try {
      const response = await fetch(`/api/set-aside/${encodeURIComponent(entry.itemId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json()) as {error?: string};
        throw new Error(body.error ?? 'The card could not be put back.');
      }
      onRestored();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div className="flex items-center gap-4 py-2">
      <Link
        href={`/record/${entry.groupId}?item=${encodeURIComponent(entry.itemId)}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-accent"
      >
        <TibetanText className="shrink-0 text-lg text-fg-tibetan">{entry.tibetan}</TibetanText>
        <span className="min-w-0 flex-1 truncate text-sm">
          {entry.romanization}
          {entry.english ? (
            <span className="text-muted-foreground"> · {entry.english}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{entry.groupTitle}</span>
      </Link>

      <button
        type="button"
        disabled={isRestoring}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
        onClick={() => void restore()}
      >
        {isRestoring ? 'putting back…' : 'put back'}
      </button>
    </div>
  );
}

export function SetAsidePanel({setAside, corrected}: SetAsidePanelProps) {
  const router = useRouter();

  if (setAside.length === 0 && corrected.length === 0) {
    return null;
  }

  // The figures on this page are derived from the ledger on the server, so a
  // change here has to be re-derived rather than patched into the page.
  const refresh = () => router.refresh();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set aside</CardTitle>
        <CardDescription>
          {setAside.length} {setAside.length === 1 ? 'card' : 'cards'} passed over as wrong.
          They are not counted as still to record, and a group opens past them.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {REASON_HEADINGS.map(({reason, title, detail}) => {
          const inReason = setAside.filter((entry) => entry.reason === reason);
          if (inReason.length === 0) {
            return null;
          }

          return (
            <section key={reason} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                <Badge variant="secondary">{inReason.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{detail}</p>
              <div className="divide-y pt-1">
                {inReason.map((entry) => (
                  <EntryRow key={entry.itemId} entry={entry} onRestored={refresh} />
                ))}
              </div>
            </section>
          );
        })}

        {corrected.length > 0 ? (
          <section className="space-y-1 border-t pt-5">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">Changed since you set them aside</h3>
              <Badge variant="secondary">{corrected.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              The content no longer reads the way it did when these were flagged, so they
              count as corrected and are back in the queue. Nothing to do here.
            </p>
            <div className="divide-y pt-1">
              {corrected.map((entry) => (
                <EntryRow key={entry.itemId} entry={entry} onRestored={refresh} />
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
