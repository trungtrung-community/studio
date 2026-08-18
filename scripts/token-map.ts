/**
 * The design-system -> Tailwind v4 namespace map.
 *
 * This is the ONE file to edit when the design system grows a new token family.
 * `scripts/sync-design.ts` reads these rules; nothing else hard-codes a token name.
 *
 * Rules are scoped by source file and evaluated in order — first match wins.
 * File scoping is not decoration: `--rail-node-done` is a colour in colors.css
 * while `--rail-node` is a length in spacing.css, so name alone cannot decide.
 */

/** What a rule does with a token. */
export type Target =
  /** Rename into a Tailwind namespace. Return the name WITHOUT the leading `--`. */
  | ((name: string, m: RegExpMatchArray) => string)
  /** Never ships. */
  | "drop"
  /** Keep the design-system name, emit into `:root`, generate no utility. */
  | "passthru"
  /** A CSS `font` shorthand role; becomes an `@utility`. */
  | "compose";

export type TokenRule = {
  /** Basename of the source token file, e.g. "colors.css". */
  file: string;
  /** Matched against the token name WITHOUT the leading `--`. */
  match: RegExp;
  to: Target;
  /** Why this rule exists. Emitted into the generated file as documentation. */
  why?: string;
};

export const RULES: TokenRule[] = [
  // ── colors.css ────────────────────────────────────────────────────────────
  {
    file: "colors.css",
    match: /^board-/,
    to: "drop",
    why: "documentation surfaces — the design system marks these board/specimen chrome, never product UI",
  },
  {
    file: "colors.css",
    match: /^text-(.+)$/,
    to: (_n, m) => `color-fg-${m[1]}`,
    why: "renamed: Tailwind v4 reserves the --text-* namespace for font sizes, and typography.css already owns it",
  },
  { file: "colors.css", match: /^.+$/, to: (n) => `color-${n}` },

  // ── fonts.css ─────────────────────────────────────────────────────────────
  { file: "fonts.css", match: /^font-/, to: (n) => n },

  // ── typography.css ────────────────────────────────────────────────────────
  {
    file: "typography.css",
    match: /^type-/,
    to: "compose",
    why: "composed `weight size / leading family` roles — Tailwind has no equivalent namespace, so these become @utility rules",
  },
  { file: "typography.css", match: /^text-/, to: (n) => n },
  { file: "typography.css", match: /^weight-(.+)$/, to: (_n, m) => `font-weight-${m[1]}` },
  { file: "typography.css", match: /^leading-/, to: (n) => n },
  { file: "typography.css", match: /^tracking-/, to: (n) => n },

  // ── spacing.css ───────────────────────────────────────────────────────────
  { file: "spacing.css", match: /^space-(.+)$/, to: (_n, m) => `spacing-${m[1]}` },
  {
    file: "spacing.css",
    match: /^measure-(.+)$/,
    to: (_n, m) => `container-${m[1]}`,
    why: "measures are max-widths; Tailwind's --container-* namespace generates max-w-* for them",
  },
  {
    file: "spacing.css",
    match: /^.+$/,
    to: "passthru",
    why: "layout constants (gutters, bar heights, rail geometry) — used via var(), no utility needed",
  },

  // ── radius.css ────────────────────────────────────────────────────────────
  { file: "radius.css", match: /^radius-/, to: (n) => n },

  // ── elevation.css ─────────────────────────────────────────────────────────
  { file: "elevation.css", match: /^shadow-/, to: (n) => n },
  {
    file: "elevation.css",
    match: /^edge-depth/,
    to: "passthru",
    why: "--edge-depth / --edge-depth-pressed are lengths, not shadows — must be matched before the --edge-* shadow rule",
  },
  {
    file: "elevation.css",
    match: /^edge-(.+)$/,
    to: (_n, m) => `shadow-edge-${m[1]}`,
    why: "the signature chunky button edge is a box-shadow; prefixed so shadow-edge-accent cannot collide with shadow-*",
  },
  {
    file: "elevation.css",
    match: /^ring-(.+)$/,
    to: (_n, m) => `shadow-ring-${m[1]}`,
    why: "the inset rings are box-shadows too — the system draws outlines with inset shadow, never a 1px border",
  },
  {
    file: "elevation.css",
    match: /^.+$/,
    to: "passthru",
    why: "--border-none, --divider-hairline, --outline-mascot are bare lengths",
  },

  // ── motion.css ────────────────────────────────────────────────────────────
  { file: "motion.css", match: /^ease-/, to: (n) => n },
  {
    file: "motion.css",
    match: /^.+$/,
    to: "passthru",
    why: "Tailwind v4 has no --duration-* theme namespace; durations and press constants are used via var()",
  },
];

/**
 * Token files pulled from the design system, in `@import` order.
 * `base.css` is global CSS rather than tokens and is handled separately
 * (adapted by hand into styles/base.css), so it is not listed here.
 */
export const TOKEN_FILES = [
  "fonts.css",
  "colors.css",
  "typography.css",
  "spacing.css",
  "radius.css",
  "elevation.css",
  "motion.css",
] as const;

/**
 * Quoted font-family names rewritten to the `next/font` CSS variables declared
 * in app/layout.tsx, so the families are self-hosted instead of fetched from a
 * render-blocking CDN request.
 *
 * "Noto Sans Tibetan" is deliberately NOT substituted. It is the first family in
 * the design system's --font-tibetan stack, but Google Fonts does not publish it
 * (verified: the CSS API 400s on that family alone and silently drops it from a
 * multi-family request). The board has therefore always rendered Tibetan in Noto
 * Serif Tibetan. Leaving the name in place means that if the sans face is ever
 * self-hosted, it takes priority with no code change.
 */
export const FONT_SUBSTITUTIONS: Record<string, string> = {
  '"Gabarito"': "var(--font-gabarito)",
  '"Plus Jakarta Sans"': "var(--font-plus-jakarta)",
  '"Noto Serif Tibetan"': "var(--font-noto-tibetan)",
};

/**
 * Strings scrubbed from comments before they are emitted.
 *
 * The design system's readme states the palette codename must never appear as
 * user-facing text, and a comment in a shipped stylesheet is readable by anyone
 * who opens devtools.
 */
export const SCRUB: Array<[RegExp, string]> = [[/:?\s*High Plateau/g, ""]];

/**
 * Extra theme values the design system does not define but the web needs.
 * Documented in the plan as the three genuine gaps: breakpoints, z-index, opacity.
 *
 * Breakpoints derive from the design system's own authoring targets —
 * docs/04 authors frames at 390 and device-checks at 320, with the
 * --gutter-mobile -> --gutter-desktop step as the mobile/desktop boundary.
 */
export const WEB_ONLY_THEME: Array<[string, string, string?]> = [
  ["--breakpoint-xs", "22.5rem", "360px — above the 320px floor the design system device-checks"],
  ["--breakpoint-sm", "40rem", "640px"],
  ["--breakpoint-md", "48rem", "768px — the gutter steps 20px -> 40px here"],
  ["--breakpoint-lg", "64rem", "1024px"],
  ["--breakpoint-xl", "80rem", "1280px"],
];

/** Resolve a token to its rule. Returns null when no rule matches. */
export function resolve(
  file: string,
  name: string,
): { rule: TokenRule; match: RegExpMatchArray } | null {
  for (const rule of RULES) {
    if (rule.file !== file) continue;
    const m = name.match(rule.match);
    if (m) return { rule, match: m };
  }
  return null;
}
