import { promises as fs } from "node:fs";
import path from "node:path";
import { estimateTokens } from "./tokenize.js";
import type { ContextFile, ContextKind, LoadKind } from "./types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "coverage",
]);

const MAX_DEPTH = 6;

// Exact filenames mapped to their kind.
const EXACT: Record<string, ContextKind> = {
  "CLAUDE.md": "claude",
  "CLAUDE.local.md": "claude",
  "AGENTS.md": "agents",
  "GEMINI.md": "gemini",
  ".cursorrules": "cursor",
  ".windsurfrules": "windsurf",
  "copilot-instructions.md": "copilot",
  "CONTEXT_FOR_AI.md": "other",
};

function classify(name: string): ContextKind | null {
  if (EXACT[name]) return EXACT[name];
  if (name === "SKILL.md") return "skill";
  if (name.endsWith(".mdc")) return "cursor"; // .cursor/rules/*.mdc
  return null;
}

/**
 * When the agent loads a file. Skills and individual Cursor rule files load only
 * when invoked; every other (root) context file is loaded on every turn. A
 * nested AGENTS.md/CLAUDE.md is still treated as always-on for the MVP.
 */
function classifyLoad(name: string): LoadKind {
  if (name === "SKILL.md" || name.endsWith(".mdc")) return "ondemand";
  return "always";
}

// Claude Code's `@path` import syntax. Conservative on purpose: the import must
// START its line (optionally indented), like the canonical `CLAUDE.md` whose only
// line is `@AGENTS.md`. This avoids two false-positive classes that share the
// `@token.word` shape — prose mentions mid-sentence ("Reference @AGENTS.md …")
// and code like Prisma's `@db.Text` — which would otherwise flag bogus imports.
// The extension allowlist (markdown/text) further narrows it.
const IMPORT_RE = /^[ \t]*@([./\w-]+\.(?:markdown|mdx|mdc|md|txt|rst))\b/gim;

function importSpecs(content: string): string[] {
  return [...content.matchAll(IMPORT_RE)].map((m) => m[1]);
}

async function readFile(abs: string, root: string, kind: ContextKind, load: LoadKind): Promise<ContextFile> {
  const content = await fs.readFile(abs, "utf8");
  return {
    path: abs,
    relPath: path.relative(root, abs),
    kind,
    load,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    lines: content.split("\n").length,
    imports: [],
    importedTokens: 0,
    unresolvedImports: [],
  };
}

/**
 * Follow each file's `@import` references and fold the imported token cost back
 * into the importer. Rules:
 * - Imports that resolve to a file that is NOT itself a discovered context file
 *   are *folded*: their tokens are added to the importer's `importedTokens`,
 *   counted once across the whole report (deduped), and never listed on their own.
 * - Imports that resolve to an already-discovered context file (e.g. `@AGENTS.md`)
 *   keep their own entry and are NOT folded — they're a root in their own right,
 *   so folding them would double-count.
 * - Unresolvable imports are recorded in `unresolvedImports` (ignored for tokens).
 * Transitive, cycle-safe; shared folded files are attributed to the first
 * importer in scan order.
 */
async function resolveImports(files: ContextFile[], root: string): Promise<void> {
  const discoveredAbs = new Set(files.map((f) => f.path));
  const contentCache = new Map<string, string | null>();
  for (const f of files) contentCache.set(f.path, f.content);

  async function read(abs: string): Promise<string | null> {
    if (contentCache.has(abs)) return contentCache.get(abs) ?? null;
    let c: string | null;
    try {
      c = await fs.readFile(abs, "utf8");
    } catch {
      c = null;
    }
    contentCache.set(abs, c);
    return c;
  }

  // The import tree of `startAbs`: non-context files to fold + unresolved specs.
  async function tree(startAbs: string): Promise<{ fold: string[]; unresolved: string[] }> {
    const visited = new Set<string>([startAbs]);
    const fold: string[] = [];
    const unresolved: string[] = [];
    async function visit(abs: string): Promise<void> {
      const content = await read(abs);
      if (content == null) return;
      const dir = path.dirname(abs);
      for (const spec of importSpecs(content)) {
        const target = path.resolve(dir, spec);
        if (visited.has(target)) continue;
        if ((await read(target)) == null) {
          unresolved.push(spec);
          continue;
        }
        visited.add(target);
        if (discoveredAbs.has(target)) continue; // its own entry — don't fold/recurse
        fold.push(target);
        await visit(target);
      }
    }
    await visit(startAbs);
    return { fold, unresolved };
  }

  const claimed = new Set<string>(); // folded targets already counted (dedup across importers)
  for (const f of files) {
    const { fold, unresolved } = await tree(f.path);
    const fresh = fold.filter((a) => !claimed.has(a));
    fresh.forEach((a) => claimed.add(a));
    let imported = 0;
    for (const a of fresh) {
      const c = await read(a);
      if (c != null) imported += estimateTokens(c);
    }
    f.imports = fresh.map((a) => path.relative(root, a)).sort();
    f.importedTokens = imported;
    f.unresolvedImports = [...new Set(unresolved)];
  }
}

/** Recursively find every known agent-context file under `root`. */
export async function discover(root: string): Promise<ContextFile[]> {
  const out: ContextFile[] = [];
  const resolvedRoot = path.resolve(root);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(abs, depth + 1);
      } else {
        const kind = classify(entry.name);
        if (kind) out.push(await readFile(abs, resolvedRoot, kind, classifyLoad(entry.name)));
      }
    }
  }

  await walk(resolvedRoot, 0);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  await resolveImports(out, resolvedRoot);
  return out;
}
