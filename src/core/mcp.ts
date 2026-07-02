import { promises as fs } from "node:fs";
import path from "node:path";
import { estimateTokens } from "./tokenize.js";

/** Token cost of one MCP server's tool schemas. */
export interface McpServerCost {
  server: string;
  /** Tokens the server's serialized tool definitions add to every turn. */
  tokens: number;
  /** Set when the cost could not be measured (e.g. schemas only exist at runtime). */
  note?: string;
}

const OFFLINE_NOTE = "schemas not available offline";

// Standard MCP config shape (Claude Code / Claude Desktop / Cursor / Windsurf):
//   { "mcpServers": { "<name>": { command, args, env, ... } } }
//
// OFFLINE-FIRST: we never spawn a server or open a connection to list its tools.
// We only read tool definitions that are present statically — either inline on
// the server entry (`tools`) or in a manifest file declared next to the config
// (`toolsFile` / `manifest`). A server whose tools are only discoverable at
// runtime is reported with tokens: 0 and a note, never by connecting to it.
//
// TODO(claude): the real MCP protocol exposes tools via a `tools/list` call at
// runtime, so most servers won't declare schemas statically. A future opt-in
// flag (e.g. `--mcp-connect`) could launch each server in a sandbox and call
// `tools/list` to measure true schema weight. Until then, runtime-only servers
// are counted as 0 with the offline note.

/**
 * Read an MCP config and return the token cost of each server's tool schemas.
 * Missing or malformed config → `[]` (never throws, so callers can auto-discover
 * without guarding).
 */
export async function readMcpServerCosts(configPath: string): Promise<McpServerCost[]> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return []; // no config at this path — nothing to account for
  }

  let config: any;
  try {
    config = JSON.parse(raw);
  } catch {
    return []; // malformed config — skip rather than crash the audit
  }

  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object") return [];

  const configDir = path.dirname(path.resolve(configPath));
  const out: McpServerCost[] = [];
  for (const [name, entry] of Object.entries<any>(servers)) {
    const tools = await staticTools(entry, configDir);
    if (tools == null) {
      out.push({ server: name, tokens: 0, note: OFFLINE_NOTE });
    } else {
      out.push({ server: name, tokens: estimateTokens(JSON.stringify(tools)) });
    }
  }
  return out;
}

/** Resolve a server's tool definitions from static sources only, or null. */
async function staticTools(entry: any, configDir: string): Promise<unknown[] | null> {
  if (!entry || typeof entry !== "object") return null;

  // 1) Tool definitions declared inline on the server entry.
  if (Array.isArray(entry.tools) && entry.tools.length > 0) return entry.tools;

  // 2) A manifest file declared alongside the config.
  const manifestRef = entry.toolsFile ?? entry.manifest;
  if (typeof manifestRef === "string") {
    return readManifestTools(path.resolve(configDir, manifestRef));
  }

  return null;
}

/** Read a tools manifest: either a top-level array or `{ tools: [...] }`. */
async function readManifestTools(file: string): Promise<unknown[] | null> {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.tools) && data.tools.length > 0) return data.tools;
    return null;
  } catch {
    return null;
  }
}
