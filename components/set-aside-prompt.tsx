'use client';

/**
 * @fileoverview Saying what is wrong with a card, in one keystroke.
 *
 * A sitting runs at a take every fifteen seconds. Stopping to type why a card
 * looks wrong breaks that badly enough that the temptation is to record it
 * anyway and say nothing — which is the outcome this exists to prevent.
 *
 * So the answer is three fixed choices on the number keys. Three, because they
 * go to three different places afterwards, and no more, because a longer list
 * would have to be read rather than remembered.
 *
 * It is drawn in place rather than in a dialog. A dialog animates in, takes
 * focus and animates out, and none of that is affordable between two takes.
 */

import {useEffect} from 'react';

import {Card, CardContent} from '@/components/ui/card';
import type {SetAsideReason} from '@/lib/take-ledger';

/** One choice, its key, and what it means. */
interface ReasonChoice {
  key: string;
  reason: SetAsideReason;
  label: string;
  detail: string;
}

const CHOICES: readonly ReasonChoice[] = [
  {
    key: '1',
    reason: 'tibetan',
    label: 'The Tibetan is wrong',
    detail: 'The script itself — spelling, a wrong word, a wrong form.',
  },
  {
    key: '2',
    reason: 'romanization',
    label: 'The romanization is wrong',
    detail: 'The Tibetan is right but it is not written as it sounds.',
  },
  {
    key: '3',
    reason: 'unsure',
    label: 'Not sure how to say it',
    detail: 'Both may be right. This one is a question for the reviewer.',
  },
];

interface SetAsidePromptProps {
  open: boolean;
  onChoose: (reason: SetAsideReason) => void;
  onCancel: () => void;
}

/**
 * Asks what is wrong with the card, and takes one key for an answer.
 *
 * @example
 * <SetAsidePrompt open={isOpen} onChoose={setAside} onCancel={close} />
 */
export function SetAsidePrompt({open, onChoose, onCancel}: SetAsidePromptProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      const choice = CHOICES.find((candidate) => candidate.key === event.key);
      if (choice) {
        event.preventDefault();
        onChoose(choice.reason);
      }
    }

    // Capture, because the recording screen listens on the same window and Space
    // must not start a take while this is deciding what to do with the card.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onChoose, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-3 p-4">
        <p className="text-xs font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
          What is wrong with it?
        </p>

        <div className="space-y-1.5">
          {CHOICES.map((choice) => (
            <button
              key={choice.key}
              type="button"
              className="hover:bg-accent flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors"
              onClick={() => onChoose(choice.reason)}
            >
              <kbd className="keycap mt-0.5">{choice.key}</kbd>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{choice.label}</span>
                <span className="block text-xs text-muted-foreground">{choice.detail}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          <kbd className="keycap">Esc</kbd> to carry on recording it instead.
        </p>
      </CardContent>
    </Card>
  );
}
