'use client';

/**
 * @fileoverview A whole group at once, between sittings.
 *
 * The recording screen shows one card, which is right while recording. This is
 * the other view: everything, with what became of it, so a group can be judged
 * rather than worked through. It is where a rushed take gets found, and where a
 * card that was passed over gets a second look with time to think about it.
 *
 * Playback is of the master on disk, so this answers what was actually kept.
 */

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';

import {TibetanText} from '@/components/tibetan-text';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {describePlaybackFailure} from '@/lib/playback-failure';
import type {BrowsedItem, ItemState} from '@/lib/progress-summary';
import type {SetAsideReason} from '@/lib/take-ledger';

/** The filters along the top, in the order they are offered. */
const FILTERS: ReadonlyArray<{key: ItemState | 'all'; label: string}> = [
  {key: 'all', label: 'everything'},
  {key: 'recorded', label: 'recorded'},
  {key: 'set-aside', label: 'set aside'},
  {key: 'waiting', label: 'not yet'},
];

const STATE_LABELS: Readonly<Record<ItemState, string>> = {
  recorded: 'recorded',
  'set-aside': 'set aside',
  waiting: 'not yet',
};

const REASON_LABELS: Readonly<Record<SetAsideReason, string>> = {
  tibetan: 'the Tibetan',
  romanization: 'the romanization',
  unsure: 'how to say it',
};

interface GroupBrowserProps {
  groupId: string;
  items: BrowsedItem[];
}

/** Matches a card against what has been typed, across every field it shows. */
function matches(item: BrowsedItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [item.tibetan, item.romanization, item.english, item.wylie, item.itemId];
  return haystack.some((field) => field?.toLowerCase().includes(query));
}

export function GroupBrowser({groupId, items}: GroupBrowserProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<ItemState | 'all'>('all');
  const [query, setQuery] = useState('');
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) => (filter === 'all' || item.state === filter) && matches(item, needle),
    );
  }, [items, filter, query]);

  const counts = useMemo(
    () => ({
      all: items.length,
      recorded: items.filter((item) => item.state === 'recorded').length,
      'set-aside': items.filter((item) => item.state === 'set-aside').length,
      waiting: items.filter((item) => item.state === 'waiting').length,
    }),
    [items],
  );

  function play(itemId: string): void {
    audioRef.current?.pause();

    if (playingItemId === itemId) {
      audioRef.current = null;
      setPlayingItemId(null);
      return;
    }

    const audio = new Audio(`/api/take/${encodeURIComponent(itemId)}/audio`);
    audio.onended = () => setPlayingItemId(null);
    audioRef.current = audio;
    setPlayingItemId(itemId);

    // Caught, not discarded. `void` on this promise leaves the rejection
    // unhandled, which fills the console with errors that name no cause and say
    // nothing about which take failed.
    audio.play().catch((cause: unknown) => {
      setPlayingItemId(null);
      toast.error(describePlaybackFailure(cause));
    });
  }

  async function putBack(itemId: string): Promise<void> {
    try {
      const response = await fetch(`/api/set-aside/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json()) as {error?: string};
        throw new Error(body.error ?? 'The card could not be put back.');
      }
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={
                filter === option.key
                  ? 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium'
                  : 'rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent'
              }
            >
              {option.label}
              <span className="ml-1.5 tabular-nums opacity-60">{counts[option.key]}</span>
            </button>
          ))}
        </div>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a card"
          className="max-w-xs"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-56">Card</TableHead>
            <TableHead className="w-28">State</TableHead>
            <TableHead className="w-40">Recorded</TableHead>
            <TableHead className="w-24 text-right">Peak</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-40 text-right">&nbsp;</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((item) => (
            <TableRow key={item.itemId}>
              <TableCell>
                <TibetanText className="text-lg text-fg-tibetan">{item.tibetan}</TibetanText>
                <p className="text-xs text-muted-foreground">
                  {item.romanization}
                  {item.english ? ` · ${item.english}` : ''}
                </p>
              </TableCell>

              <TableCell>
                <Badge
                  variant={
                    item.state === 'recorded'
                      ? 'secondary'
                      : item.state === 'set-aside'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {STATE_LABELS[item.state]}
                </Badge>
              </TableCell>

              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {item.recordedAt ? item.recordedAt.slice(0, 16).replace('T', ' ') : '—'}
              </TableCell>

              <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {item.peakDecibels === null ? '—' : `${item.peakDecibels} dBFS`}
              </TableCell>

              <TableCell className="text-xs text-muted-foreground">
                {item.setAsideReason ? `Wrong: ${REASON_LABELS[item.setAsideReason]}. ` : ''}
                {item.warnings.map((warning) => warning.message).join(' ')}
                {!item.setAsideReason && item.warnings.length === 0 ? '—' : ''}
              </TableCell>

              <TableCell className="text-right whitespace-nowrap">
                {item.state === 'recorded' ? (
                  <button
                    type="button"
                    onClick={() => play(item.itemId)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    {playingItemId === item.itemId ? 'stop' : 'play'}
                  </button>
                ) : null}

                {item.state === 'set-aside' ? (
                  <button
                    type="button"
                    onClick={() => void putBack(item.itemId)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    put back
                  </button>
                ) : null}

                <Link
                  href={`/record/${groupId}?item=${encodeURIComponent(item.itemId)}`}
                  className="rounded-md px-2 py-1 text-xs text-fg-link underline underline-offset-2"
                >
                  {item.state === 'recorded' ? 'redo' : 'record'}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing here matches that.
        </p>
      ) : null}
    </div>
  );
}
