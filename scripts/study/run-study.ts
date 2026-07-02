// Reproducible repo study — dogfoods the BUILT ctxbudget (dist/cli.js).
// Clones each repo shallowly, runs `ctxbudget <dir> --json`, and stores the
// result per repo. It never reimplements audit logic; it only orchestrates.
//
//   npm run study                          scan every repo in repos.txt
//   npm run study -- --repos <file>        use a different list (e.g. a test subset)
//   npm run study -- --resume              skip repos that already have a result
//   npm run study -- --no-clean            keep/reuse clones (for debugging)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const CLI = path.resolve(HERE, "..", "..", "dist", "cli.js");
const TIMEOUT_MS = 180_000; // per repo (clone and audit each)

const argv = process.argv.slice(2);
const NO_CLEAN = argv.includes("--no-clean");
const RESUME = argv.includes("--resume");
const reposIdx = argv.indexOf("--repos");
const REPOS_FILE = reposIdx !== -1 && argv[reposIdx + 1] ? path.resolve(argv[reposIdx + 1]) : path.join(HERE, "repos.txt");

type Status = "ok" | "n/a" | "error";
interface Result {
  url: string;
  owner: string;
  repo: string;
  status: Status;
  scannedAt: string;
  commit: string | null;
  error: string | null;
  report: unknown | null;
}

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "-");

function ownerRepo(url: string): { owner: string; repo: string } {
  const clean = url.replace(/\.git$/i, "").replace(/[/]+$/, "");
  const parts = clean.split(/[/:]/).filter(Boolean);
  const repo = parts.pop() ?? "repo";
  const owner = parts.pop() ?? "owner";
  return { owner: sanitize(owner), repo: sanitize(repo) };
}

function rmrf(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function main(): void {
  if (!existsSync(CLI)) {
    console.error(`ctxbudget not built: ${CLI} missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
  if (!existsSync(REPOS_FILE)) {
    console.error(`Missing ${REPOS_FILE}`);
    process.exit(1);
  }
  mkdirSync(RESULTS, { recursive: true });

  const urls = readFileSync(REPOS_FILE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  console.log(`ctxbudget study — ${urls.length} repo(s)\n`);
  let i = 0;
  for (const url of urls) {
    i++;
    const { owner, repo } = ownerRepo(url);
    const slug = `${owner}__${repo}`;
    const outFile = path.join(RESULTS, `${slug}.json`);
    const tag = `[${i}/${urls.length}] ${owner}/${repo}`;

    if (RESUME && existsSync(outFile)) {
      console.log(`${tag} — skip (--resume)`);
      continue;
    }

    const dir = path.join(os.tmpdir(), `ctxbudget-study-${slug}`);
    const result: Result = {
      url,
      owner,
      repo,
      status: "error",
      scannedAt: new Date().toISOString(),
      commit: null,
      error: null,
      report: null,
    };

    try {
      const reuse = NO_CLEAN && existsSync(path.join(dir, ".git"));
      if (!reuse) {
        rmrf(dir);
        const clone = spawnSync("git", ["clone", "--depth", "1", "--quiet", url, dir], {
          timeout: TIMEOUT_MS,
          encoding: "utf8",
        });
        if (clone.status !== 0) {
          const why = clone.error?.message ?? (clone.stderr || "").trim().split("\n").pop() ?? `exit ${clone.status}`;
          throw new Error(`git clone failed: ${why}`);
        }
      }

      const rev = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
      result.commit = rev.status === 0 ? rev.stdout.trim() : null;

      const audit = spawnSync(process.execPath, [CLI, dir, "--json"], {
        timeout: TIMEOUT_MS,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      });
      if (audit.status !== 0) {
        const why = audit.error?.message ?? ((audit.stderr || "").trim() || `exit ${audit.status}`);
        throw new Error(`ctxbudget failed: ${why}`);
      }

      const report = JSON.parse(audit.stdout) as {
        health?: { noContext?: boolean; grade?: string };
        budget?: { alwaysOnTokens?: number };
      };
      result.report = report;
      result.status = report.health?.noContext ? "n/a" : "ok";
      const extra =
        result.status === "ok"
          ? ` (grade ${report.health?.grade}, always-on ${report.budget?.alwaysOnTokens} tok)`
          : "";
      console.log(`${tag} — ${result.status}${extra}`);
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      console.log(`${tag} — error: ${result.error}`);
    } finally {
      if (!NO_CLEAN) rmrf(dir);
    }

    writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  console.log(`\ndone — results in ${path.relative(process.cwd(), RESULTS)}`);
}

main();
