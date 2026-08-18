import type {Metadata} from 'next';
import {Gabarito, Noto_Serif_Tibetan, Plus_Jakarta_Sans} from 'next/font/google';

import {ThemeProvider} from '@/components/theme-provider';
import {Toaster} from '@/components/ui/sonner';

import './globals.css';

/* The three families the design system briefs, self-hosted by next/font. Each
 * exposes the CSS variable that styles/theme.generated.css points --font-display,
 * --font-body and --font-tibetan at — the same wiring the website repo uses, so
 * the tool and the product set type in the same faces.
 *
 * The design system's --font-tibetan stack names "Noto Sans Tibetan" first, but
 * Google Fonts does not publish that family, so the board has always fallen back
 * to the serif. Loading the serif here matches what the board actually renders.
 *
 * There is no fourth family for monospace: the design system's --font-mono is a
 * system stack, and the only monospaced text here is the dBFS readout and a few
 * tabular figures.
 */

const gabarito = Gabarito({
  variable: '--font-gabarito',
  subsets: ['latin'],
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  display: 'swap',
});

/**
 * The same face the app bundles.
 *
 * The speaker is reading these glyphs aloud, so they should be the glyphs the
 * learner will be looking at. A fallback system face renders several stacks
 * differently enough to change what someone reads.
 */
const notoSerifTibetan = Noto_Serif_Tibetan({
  variable: '--font-noto-tibetan',
  subsets: ['tibetan'],
  weight: ['400', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Trungtrung Studio',
  description: 'Recording the voice for the Trungtrung Speak and Read tracks.',
};

export default function RootLayout({children}: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: next-themes sets the class on <html> before
    // React hydrates, which is the point — it is what stops the page flashing
    // light before switching to dark.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${gabarito.variable} ${plusJakarta.variable} ${notoSerifTibetan.variable} h-full`}
    >
      <body className="flex min-h-full flex-col bg-background">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
