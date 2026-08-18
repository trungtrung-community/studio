'use client';

/**
 * @fileoverview Every card in the group, without leaving the sitting.
 *
 * A group runs to a couple of hundred cards and the recording screen shows one
 * at a time, which is right while recording and useless for everything else:
 * finding the one that was rushed, hearing what was kept for a card two hundred
 * back, seeing how much of the group is genuinely done.
 *
 * Playback here is of the master on disk, not of anything held in the page, so
 * this answers "what did I actually keep" rather than "what am I holding".
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';

import {TibetanText} from '@/components/tibetan-text';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {describePlaybackFailure} from '@/lib/playback-failure';
import type {RecordingItem} from '@/lib/recording-plan';
import {cn} from '@/lib/utils';

interface ItemListDialogProps {
  items: RecordingItem[];
  /** The card currently open, so the list can show where the sitting is. */
  currentItemId: string;
  recordedItemIds: ReadonlySet<string>;
  setAsideItemIds: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the index of the card to open. */
  onJump: (index: number) => void;
}

/** What has happened to a card, which is what its dot says. */
type ItemState = 'recorded' | 'set-aside' | 'waiting';

const STATE_LABELS: Readonly<Record<ItemState, string>> = {
  recorded: 'recorded',
  'set-aside': 'set aside',
  waiting: 'not yet',
};

const STATE_DOTS: Readonly<Record<ItemState, string>> = {
  recorded: 'bg-primary',
  'set-aside': 'bg-destructive',
  waiting: 'bg-muted-foreground/30',
};

/** Matches a card against what has been typed, across every field it shows. */
function matches(item: RecordingItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [item.tibetan, item.romanization, item.english, item.wylie, item.id];
  return haystack.some((field) => field?.toLowerCase().includes(query));
}

export function ItemListDialog({
  items,
  currentItemId,
  recordedItemIds,
  setAsideItemIds,
  open,
  onOpenChange,
  onJump,
}: ItemListDialogProps) {
  const [query, setQuery] = useState('');
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Playback must not outlive the screen. Closing is handled where it happens,
  // in `close` below; this is only for a page change while something is playing.
  useEffect(() => () => audioRef.current?.pause(), []);

  /**
   * Closes the list, stopping anything playing and forgetting the search.
   *
   * Done here rather than in an effect watching `open`, because that would be a
   * cascading render: the state is being reset in response to an event, and the
   * event is the place to reset it.
   */
  function close(): void {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingItemId(null);
    setQuery('');
    onOpenChange(false);
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .map((item, index) => ({item, index}))
      .filter((entry) => matches(entry.item, needle));
  }, [items, query]);

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

    audio.play().catch((cause: unknown) => {
      setPlayingItemId(null);
      toast.error(describePlaybackFailure(cause));
    });
  }

  function stateOf(item: RecordingItem): ItemState {
    if (recordedItemIds.has(item.id)) {
      return 'recorded';
    }
    return setAsideItemIds.has(item.id) ? 'set-aside' : 'waiting';
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Every card in this group</DialogTitle>
          <DialogDescription>
            {recordedItemIds.size} recorded, {setAsideItemIds.size} set aside, of{' '}
            {items.length}. Choose one to go to it.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a card — Tibetan, romanization, English"
        />

        <div className="max-h-[50vh] divide-y overflow-y-auto">
          {shown.map(({item, index}) => {
            const state = stateOf(item);
            return (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-3 px-1 py-2',
                  item.id === currentItemId && 'bg-accent/60 rounded-md',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    onJump(index);
                    close();
                  }}
                >
                  <span
                    aria-hidden
                    className={cn('size-2 shrink-0 rounded-full', STATE_DOTS[state])}
                  />
                  <TibetanText className="shrink-0 text-fg-tibetan">
                    {item.tibetan}
                  </TibetanText>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {item.romanization}
                    {item.english ? (
                      <span className="text-muted-foreground"> · {item.english}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {STATE_LABELS[state]}
                  </span>
                </button>

                {state === 'recorded' ? (
                  <button
                    type="button"
                    className="hover:bg-accent shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors"
                    onClick={() => play(item.id)}
                  >
                    {playingItemId === item.id ? 'stop' : 'play'}
                  </button>
                ) : null}
              </div>
            );
          })}

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing here matches that.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
