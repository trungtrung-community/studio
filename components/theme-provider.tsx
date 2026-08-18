'use client';

import {ThemeProvider as NextThemesProvider} from 'next-themes';
import type {ComponentProps} from 'react';

/**
 * Light and dark, remembered between sittings.
 *
 * `next-themes` was already a dependency and `components/ui/sonner.tsx` already
 * read `useTheme()` from it, but nothing ever mounted the provider — so that
 * call could only ever return the default and the `.dark` block in globals.css
 * was unreachable. This mounts it.
 */
export function ThemeProvider({children, ...props}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
