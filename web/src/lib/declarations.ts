/**
 * Declaration decisions. Juniors stay on the forecast board until they say
 * they are returning. Decisions are set from the player page and stored in
 * data/declarations.json so the forecast and the player page agree.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { memoSync } from "./memo";

export type Decision = "declared" | "returning" | "undecided";

const FILE = path.join(process.cwd(), "data", "declarations.json");

interface Store {
  [playerId: string]: { decision: Decision; at: string; note?: string };
}

function stamp() {
  try {
    return String(statSync(FILE).mtimeMs);
  } catch {
    return "missing";
  }
}

export function readDeclarations(): Store {
  return memoSync(`decl:${stamp()}`, 300, () => {
    if (!existsSync(FILE)) return {};
    try {
      return JSON.parse(readFileSync(FILE, "utf8")) as Store;
    } catch {
      return {};
    }
  });
}

export function decisionFor(id: string): Decision {
  return readDeclarations()[id]?.decision ?? "undecided";
}

export function setDecision(id: string, decision: Decision, note?: string) {
  const store = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Store) : {};
  if (decision === "undecided") delete store[id];
  else store[id] = { decision, at: new Date().toISOString(), note };
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(store, null, 1));
}
