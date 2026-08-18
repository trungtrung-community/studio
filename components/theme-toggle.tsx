'use client';

import {MoonIcon, SunIcon} from 'lucide-react';
import {useTheme} from 'next-themes';

import {Button} from '@/components/ui/button';

/**
 * Light and dark, switched from the dashboard.
 *
 * The tool is used in long sittings at a microphone, often in a room kept dark
 * for the recording rather than for the screen.
 *
 * Both icons are rendered and CSS picks one off the `dark` class that
 * next-themes puts on <html>. Choosing in JavaScript instead would mean
 * rendering the wrong icon on the server and correcting it after hydration.
 */
export function ThemeToggle() {
  const {resolvedTheme, setTheme} = useTheme();

  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label="Switch between light and dark"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}
