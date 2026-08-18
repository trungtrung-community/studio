/**
 * sync-design — pull design tokens from the design-system repo into this one.
 *
 *   node scripts/sync-design.ts            regenerate
 *   node scripts/sync-design.ts --check    fail if regenerating would change anything
 *
 * What it does
 *   1. Locates the design system (TRUNGTRUNG_DS_PATH, default ../design-system).
 *   2. Vendors the token CSS files verbatim into styles/tokens/ — a pristine
 *      mirror, so this repo builds with the design system absent and so an
 *      upstream change is a readable diff.
 *   3. Emits styles/theme.generated.css: a Tailwind v4 `@theme` block, `@utility`
 *      rules for the composed type roles, and a `:root` block carrying the
 *      passthrough tokens plus aliases under their original design-system names.
 *
 * Why vendor rather than path-reference: the board export is regenerated
 * top-down and local edits are discarded, and _ds/UPSTREAM-SYNC-2026-08-16.md
 * records four tokens that exist only in the local copy. A pinned mirror is the
 * only stable contract.
 *
 * Shared with the website repo, which runs the same script against the same
 * tokens. The one difference: the website also copies the mascot artwork, which
 * this tool has no surface for. Fixes belong in both copies.
 *
 * Studio is a shadcn app and the website is not, so the tokens landing here are
 * only half the job: app/globals.css maps them onto shadcn's semantic variables
 * (--background, --card, --primary …). That mapping is hand-written and is the
 * one place the two repos genuinely diverge.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FONT_SUBSTITUTIONS,
  RULES,
  SCRUB,
  TOKEN_FILES,
  WEB_ONLY_THEME,
  resolve,
} from "./token-map.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(REPO, "styles", "tokens");
const OUT_CSS = path.join(REPO, "styles", "theme.generated.css");
const OUT_LOCK = path.join(REPO, "styles", "tokens.lock.json");

const CHECK = process.argv.includes("--check");

// ── locating the design system ──────────────────────────────────────────────

function findTokensDir(): string {
  const dsRoot =
    process.env.TRUNGTRUNG_DS_PATH ?? path.resolve(REPO, "..", "design-system");
  const exportRoot = path.join(dsRoot, "Trungtrung app - all screens", "_ds");

  if (!fs.existsSync(exportRoot)) {
    fail(
      `Design system not found at ${exportRoot}\n` +
        `Set TRUNGTRUNG_DS_PATH to the design-system repo root.`,
    );
  }

  // The export directory is named after a project UUID that changes between
  // exports, so match on structure rather than on the name.
  const candidates = fs
    .readdirSync(exportRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(exportRoot, e.name, "tokens"))
    .filter((p) => fs.existsSync(p));

  if (candidates.length === 0) fail(`No */tokens directory under ${exportRoot}`);
  if (candidates.length > 1) {
    console.warn(
      `warning: ${candidates.length} token directories found; using ${candidates[0]}`,
    );
  }
  return candidates[0];
}

function fail(message: string): never {
  console.error(`sync-design: ${message}`);
  process.exit(1);
}

// ── parsing ─────────────────────────────────────────────────────────────────

type Decl = {
  name: string; // without the leading `--`
  value: string;
  file: string;
  section?: string[]; // the comment block(s) this declaration sits under, one entry per block
  note?: string; // trailing comment on the declaration itself
};

/** Everything between the outermost braces of each `:root { … }` rule. */
function rootBodies(css: string): string[] {
  const bodies: string[] = [];
  const re = /:root\s*\{/g;
  while (re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    bodies.push(css.slice(re.lastIndex, i - 1));
  }
  return bodies;
}

function scrub(text: string): string {
  return SCRUB.reduce((acc, [re, to]) => acc.replace(re, to), text).trim();
}

function tidy(text: string): string {
  // Drop the box-drawing rules the design system uses to underline section
  // headings; they carry no meaning once the comment is re-wrapped.
  return scrub(text.replace(/[─—]{2,}/g, "").replace(/\s+/g, " "));
}

function parseTokens(css: string, file: string): Decl[] {
  const out: Decl[] = [];
  let section: string[] | undefined;
  let blocks: string[] = []; // completed comment blocks awaiting a declaration
  let block: string[] = []; // lines of the comment block currently open
  let inComment = false;

  const closeBlock = () => {
    const text = tidy(block.join(" "));
    if (text) blocks.push(text);
    block = [];
  };

  for (const raw of rootBodies(css).join("\n").split("\n")) {
    const line = raw.trim();

    if (inComment) {
      block.push(line.replace(/\*\/\s*$/, "").replace(/^\*+\s?/, ""));
      if (line.includes("*/")) {
        inComment = false;
        closeBlock();
      }
      continue;
    }

    if (line.startsWith("/*")) {
      const closed = line.includes("*/");
      block.push(line.replace(/^\/\*+/, "").replace(/\*\/\s*$/, ""));
      inComment = !closed;
      if (closed) closeBlock();
      continue;
    }

    const decl = line.match(/^--([\w-]+)\s*:\s*([^;]+);(.*)$/);
    if (!decl) continue;

    // Comment blocks immediately above a declaration head a new section. Each
    // block stays its own line so a heading and its gloss don't run together.
    if (blocks.length) {
      section = blocks;
      blocks = [];
    }

    // Trailing comments; the exporter's own `@kind` metadata is noise here.
    const notes = [...decl[3].matchAll(/\/\*([^*]*)\*\//g)]
      .map((c) => scrub(c[1]))
      .filter((c) => c && !c.startsWith("@kind"));

    out.push({
      name: decl[1],
      value: decl[2].trim(),
      file,
      section,
      note: notes.length ? notes.join(" — ") : undefined,
    });
  }

  return out;
}

// ── mapping ─────────────────────────────────────────────────────────────────

type Mapped = Decl & { target: string; kind: "theme" | "passthru" | "compose" };

function mapTokens(decls: Decl[]): { mapped: Mapped[]; dropped: Decl[] } {
  const mapped: Mapped[] = [];
  const dropped: Decl[] = [];

  for (const d of decls) {
    const hit = resolve(d.file, d.name);
    if (!hit) {
      console.warn(`warning: no rule for --${d.name} in ${d.file}; passing through`);
      mapped.push({ ...d, target: d.name, kind: "passthru" });
      continue;
    }
    const { rule, match } = hit;

    if (rule.to === "drop") {
      dropped.push(d);
    } else if (rule.to === "passthru") {
      mapped.push({ ...d, target: d.name, kind: "passthru" });
    } else if (rule.to === "compose") {
      mapped.push({ ...d, target: d.name, kind: "compose" });
    } else {
      mapped.push({ ...d, target: rule.to(d.name, match), kind: "theme" });
    }
  }

  return { mapped, dropped };
}

/**
 * Rewrite `var(--x)` references to their mapped names, so a semantic token like
 * `--surface-app: var(--ground-100)` becomes
 * `--color-surface-app: var(--color-ground-100)`.
 *
 * `var()` chains are deliberately NOT flattened to literal values: keeping the
 * primitive -> semantic layering is what makes a palette change a one-line edit.
 */
function rewriteRefs(value: string, lookup: Map<string, string>): string {
  return value.replace(/var\(\s*--([\w-]+)/g, (whole, name: string) => {
    const target = lookup.get(name);
    return target ? `var(--${target}` : whole;
  });
}

function substituteFonts(value: string): string {
  let out = value;
  for (const [family, variable] of Object.entries(FONT_SUBSTITUTIONS)) {
    out = out.split(family).join(variable);
  }
  return out;
}

/** Split a CSS `font` shorthand of the fixed form `weight size / leading family`. */
function decompose(value: string) {
  const m = value.match(/^(\S+)\s+(\S+)\s*\/\s*(\S+)\s+(.+)$/);
  if (!m) return null;
  return { weight: m[1], size: m[2], leading: m[3], family: m[4].trim() };
}

// ── emitting ────────────────────────────────────────────────────────────────

/**
 * Make text safe to sit inside a CSS comment. A stray `*​/` — which a glob like
 * `_ds/<project>/tokens/` very nearly is — closes the comment early and spills
 * the rest of the file into the stylesheet as garbage.
 */
function safeComment(text: string): string {
  return text.replace(/\*\//g, "*​/");
}

function emit(mapped: Mapped[], dropped: Decl[], sources: SourceHash[]): string {
  const lookup = new Map(mapped.map((d) => [d.name, d.target]));
  const L: string[] = [];

  L.push("/* ============================================================");
  L.push("   GENERATED FILE — DO NOT EDIT.");
  L.push("");
  L.push("   Regenerate with:  npm run sync:design");
  L.push("   Verify with:      npm run sync:design -- --check");
  L.push("");
  L.push("   Source: design-system  Trungtrung app - all screens/_ds/<project>/tokens/");
  for (const s of sources) L.push(`     ${s.file.padEnd(18)} sha256 ${s.sha256.slice(0, 16)}`);
  L.push("");
  L.push("   The namespace mapping lives in scripts/token-map.ts — edit that,");
  L.push("   never this file.");
  L.push("   ============================================================ */");
  L.push("");

  // ---- @theme -------------------------------------------------------------
  // `static` guarantees every token reaches :root even when no utility uses it,
  // which the design-system alias block below depends on.
  L.push("@theme static {");
  let section: string | undefined;
  let file: string | undefined;
  for (const d of mapped.filter((m) => m.kind === "theme")) {
    if (d.file !== file) {
      file = d.file;
      section = undefined;
      L.push(`${L.length ? "\n" : ""}  /* ── ${d.file} ──────────────────────────────── */`);
    }
    const key = d.section?.join("\n");
    if (key && key !== section) {
      section = key;
      L.push("");
      for (const line of d.section!) L.push(`  /* ${safeComment(line)} */`);
    }
    let value = rewriteRefs(d.value, lookup);
    if (d.file === "fonts.css") value = substituteFonts(value);
    L.push(`  --${d.target}: ${value};${d.note ? ` /* ${safeComment(d.note)} */` : ""}`);
  }

  L.push("");
  L.push("  /* ── web only ─────────────────────────────────────────── */");
  L.push("  /* The design system defines no breakpoints; it is a mobile app. */");
  for (const [name, value, why] of WEB_ONLY_THEME) {
    L.push(`  ${name}: ${value};${why ? ` /* ${safeComment(why)} */` : ""}`);
  }
  L.push("");
  L.push("  /* Match Tailwind's dynamic spacing scale to the 4px design-system base,");
  L.push("     so p-9 and friends stay on grid even without a named token. */");
  L.push("  --spacing: 4px;");
  L.push("}");
  L.push("");

  // ---- @utility for the composed type roles --------------------------------
  const composed = mapped.filter((m) => m.kind === "compose");
  if (composed.length) {
    L.push("/* Composed type roles. The design system stores these as a CSS `font`");
    L.push("   shorthand; emitting the shorthand directly would reset letter-spacing,");
    L.push("   so each is decomposed into its four properties. */");
    for (const d of composed) {
      const parts = decompose(d.value);
      if (!parts) {
        console.warn(`warning: could not decompose --${d.name}: ${d.value}`);
        continue;
      }
      L.push(`@utility ${d.target} {`);
      L.push(`  font-family: ${rewriteRefs(parts.family, lookup)};`);
      L.push(`  font-size: ${rewriteRefs(parts.size, lookup)};`);
      L.push(`  font-weight: ${rewriteRefs(parts.weight, lookup)};`);
      L.push(`  line-height: ${rewriteRefs(parts.leading, lookup)};`);
      L.push("}");
    }
    L.push("");
  }

  // ---- :root passthrough + design-system aliases ---------------------------
  L.push(":root {");
  L.push("  /* Tokens with no Tailwind namespace — used via var(). */");
  file = undefined;
  for (const d of mapped.filter((m) => m.kind === "passthru")) {
    if (d.file !== file) {
      file = d.file;
      L.push(`\n  /* ${d.file} */`);
    }
    L.push(`  --${d.target}: ${rewriteRefs(d.value, lookup)};${d.note ? ` /* ${safeComment(d.note)} */` : ""}`);
  }

  if (composed.length) {
    L.push("");
    L.push("  /* The composed roles again as plain variables, so the `font:` shorthand");
    L.push("     the design system writes (`font: var(--type-body)`) keeps working");
    L.push("     alongside the @utility form above. */");
    for (const d of composed) {
      L.push(`  --${d.target}: ${rewriteRefs(d.value, lookup)};`);
    }
  }

  const aliases = mapped.filter((m) => m.kind !== "passthru" && m.name !== m.target);
  if (aliases.length) {
    L.push("");
    L.push("  /* Aliases under the original design-system names, so CSS and");
    L.push("     components copied from the design system work verbatim. */");
    for (const d of aliases) L.push(`  --${d.name}: var(--${d.target});`);
  }
  L.push("}");
  L.push("");

  if (dropped.length) {
    L.push(`/* ${dropped.length} tokens dropped by scripts/token-map.ts:`);
    const byRule = new Map<string, string[]>();
    for (const d of dropped) {
      const why =
        RULES.find((r) => r.file === d.file && r.to === "drop" && d.name.match(r.match))?.why ??
        "dropped";
      byRule.set(why, [...(byRule.get(why) ?? []), `--${d.name}`]);
    }
    for (const [why, names] of byRule) {
      L.push(`     ${safeComment(why)}`);
      L.push(`       ${names.join(", ")}`);
    }
    L.push(" */");
    L.push("");
  }

  return L.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────

type SourceHash = { file: string; sha256: string; bytes: number };

function main() {
  const tokensDir = findTokensDir();

  const sources: SourceHash[] = [];
  const decls: Decl[] = [];

  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  for (const file of [...TOKEN_FILES, "base.css"]) {
    const src = path.join(tokensDir, file);
    if (!fs.existsSync(src)) fail(`missing token file: ${src}`);
    const css = fs.readFileSync(src, "utf8");

    sources.push({
      file,
      sha256: createHash("sha256").update(css).digest("hex"),
      bytes: css.length,
    });

    // Vendored verbatim: a true mirror is what makes an upstream change a
    // readable diff. Filtering happens at generation, not here.
    writeIfChanged(path.join(VENDOR_DIR, file), css);

    if (file !== "base.css") decls.push(...parseTokens(css, file));
  }

  const { mapped, dropped } = mapTokens(decls);
  const css = emit(mapped, dropped, sources);

  const lock = {
    $comment: "GENERATED by scripts/sync-design.ts — do not edit.",
    source: path.relative(REPO, tokensDir),
    tokens: { parsed: decls.length, emitted: mapped.length, dropped: dropped.length },
    files: sources,
  };

  writeIfChanged(OUT_CSS, css);
  writeIfChanged(OUT_LOCK, JSON.stringify(lock, null, 2) + "\n");

  if (CHECK) {
    if (changed.length) {
      console.error(
        `sync-design: out of date — ${changed.length} file(s) would change:\n` +
          changed.map((f) => `  ${path.relative(REPO, f)}`).join("\n") +
          `\nRun: npm run sync:design`,
      );
      process.exit(1);
    }
    console.log(`sync-design: up to date (${mapped.length} tokens, ${dropped.length} dropped)`);
    return;
  }

  console.log(
    `sync-design: ${decls.length} tokens read from ${path.relative(REPO, tokensDir)}\n` +
      `             ${mapped.filter((m) => m.kind === "theme").length} into @theme, ` +
      `${mapped.filter((m) => m.kind === "passthru").length} passthrough, ` +
      `${mapped.filter((m) => m.kind === "compose").length} composed, ` +
      `${dropped.length} dropped\n` +
      (changed.length
        ? `             updated:\n${changed.map((f) => `               ${path.relative(REPO, f)}`).join("\n")}`
        : `             no changes`),
  );
}

const changed: string[] = [];

function writeIfChanged(file: string, contents: string) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (existing === contents) return;
  changed.push(file);
  if (!CHECK) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
}

main();
