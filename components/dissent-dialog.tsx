'use client';

import {useState} from 'react';
import {toast} from 'sonner';

import {TibetanText} from '@/components/tibetan-text';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Textarea} from '@/components/ui/textarea';
import type {RecordingItem} from '@/lib/recording-plan';

interface DissentDialogProps {
  item: RecordingItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Records that the speaker believes a written form is wrong.
 *
 * The Read recording script says a speaker who disagrees with a reading should
 * stop and say so rather than record it. In practice the take is still worth
 * having, because the audio is draft exactly as the text is. This note is what
 * turns a vague misgiving into a specific question the native reviewer can
 * answer, against the take it applies to.
 */
export function DissentDialog({item, open, onOpenChange}: DissentDialogProps) {
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function save(): Promise<void> {
    if (!note.trim() || isSaving) {
      return;
    }
    setIsSaving(true);

    try {
      const response = await fetch(`/api/dissent/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({note}),
      });
      if (!response.ok) {
        const body = (await response.json()) as {error?: string};
        throw new Error(body.error ?? 'The note could not be saved.');
      }

      toast.success('Noted for the native review.');
      setNote('');
      onOpenChange(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Something wrong with <TibetanText>{item.tibetan}</TibetanText>?
          </DialogTitle>
          <DialogDescription>
            {item.reviewQuestion
              ? `The open question on this record: ${item.reviewQuestion}`
              : 'This record carries no open question yet, so this note will start one.'}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What is wrong with it, and what should it be?"
          rows={4}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!note.trim() || isSaving} onClick={() => void save()}>
            {isSaving ? 'Saving…' : 'Save the note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
