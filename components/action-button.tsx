'use client';

import type {ComponentProps} from 'react';

import {Button} from '@/components/ui/button';

/**
 * The click event the underlying button hands its handler.
 *
 * Taken from the button itself rather than from React, because the component
 * library wraps the native event with extra fields of its own.
 */
type ButtonClickEvent = Parameters<
  NonNullable<ComponentProps<typeof Button>['onClick']>
>[0];

/**
 * A button that gives the keyboard back after it is clicked.
 *
 * The recording screen is driven by Space and Enter, and a focused button
 * consumes both. Without this, clicking Accept once with the mouse would leave
 * that button focused, and the next Space would press it again instead of
 * starting a recording.
 *
 * The visible key hint on each button is a label. The global handler on the
 * page is what actually runs, so nothing depends on where focus happens to be.
 */
export function ActionButton({onClick, ...props}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      onClick={(event: ButtonClickEvent) => {
        event.currentTarget.blur();
        onClick?.(event);
      }}
    />
  );
}
