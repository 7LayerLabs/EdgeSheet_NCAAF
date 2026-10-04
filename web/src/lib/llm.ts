/**
 * Provider adapter for the AI layer. Anthropic when ANTHROPIC_API_KEY is set,
 * OpenAI when OPENAI_API_KEY is set, otherwise "unavailable" with a note on
 * what to add. The model only ever explains and ranks evidence that the app
 * already computed; the callers (report.ts, ask.ts) validate every answer.
 *
 * Keys come from process.env (Next loads .env.local) with a fallback read of
 * ~/scripts/.env, Derek's shared key file. Keys are never logged or returned.
 * Token usage for every call is appended to data/ai/usage.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type Provider = "anthropic" | "openai";

export interface LlmInfo {
  provider: Provider;
  model: string;
}

export interface Unavailable {
  unavailable: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface JsonResult<T> {
  data: T;
  provider: Provider;
  model: string;
  usage: Usage;
}

/** A tool the model can call. The run function is ours; the model only sees name, description and schema. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  /** Short description of what came back (not the full payload). */
  resultSummary: string;
  ms: number;
}

export interface ToolRunResult {
  /** Final text from the model, or the input of the "finish" tool when one is defined. */
  text: string;
  finish?: Record<string, unknown>;
  calls: ToolCallRecord[];
  provider: Provider;
  model: string;
  usage: Usage;
  stoppedEarly?: string;
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
// Ask the slate pushes 60k tokens of game data per question; Sonnet answers it well at a fraction of Opus's price.
const ANTHROPIC_MODEL_SMALL = process.env.ANTHROPIC_MODEL_SMALL || "claude-sonnet-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const OPENAI_MODEL_SMALL = process.env.OPENAI_MODEL_SMALL || "gpt-5.4-mini";

/** USD per million tokens. Anthropic from the Claude docs; OpenAI gpt-5.4 family estimates, override in usage review if needed. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1 },
  "gpt-5.4": { in: 2.5, out: 15, cacheRead: 0.25 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5, cacheRead: 0.075 },
  "gpt-5.4-nano": { in: 0.2, out: 1.25, cacheRead: 0.02 },
};

/* ------------------------------------------------------------------ keys */

let envLoaded = false;
function loadFallbackEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const candidates = [path.join(process.cwd(), ".env.local"), path.join(os.homedir(), "scripts", ".env")];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    let text = "";
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (!/^(ANTHROPIC|OPENAI)_/.test(k)) continue;
      if (process.env[k]) continue;
      process.env[k] = raw.replace(/^["']|["']$/g, "");
    }
  }
}

function key(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"): string | undefined {
  loadFallbackEnv();
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Which provider will answer, or what key to add. Safe to call from server components. */
export function llmInfo(opts: { small?: boolean } = {}): LlmInfo | Unavailable {
  if (key("ANTHROPIC_API_KEY")) return { provider: "anthropic", model: opts.small ? ANTHROPIC_MODEL_SMALL : ANTHROPIC_MODEL };
  if (key("OPENAI_API_KEY")) return { provider: "openai", model: opts.small ? OPENAI_MODEL_SMALL : OPENAI_MODEL };
  return { unavailable: "add ANTHROPIC_API_KEY" };
}

export const isUnavailable = (x: unknown): x is Unavailable => typeof x === "object" && x !== null && "unavailable" in x;

/* ----------------------------------------------------------------- usage */

const USAGE_FILE = path.join(process.cwd(), "data", "ai", "usage.jsonl");

function cost(model: string, u: { input: number; output: number; cacheRead: number }): number {
  const p = PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ""] ?? { in: 5, out: 25, cacheRead: 0.5 };
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead) / 1_000_000;
}

function logUsage(entry: { provider: Provider; model: string; purpose: string; input: number; output: number; cacheRead: number; costUsd: number; ms: number; ref?: string }) {
  try {
    mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    appendFileSync(USAGE_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function mkUsage(model: string, input: number, output: number, cacheRead: number): Usage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, costUsd: cost(model, { input, output, cacheRead }) };
}

/* ------------------------------------------------------------ clients */

let anthropicClient: Anthropic | undefined;
let openaiClient: OpenAI | undefined;
function anthropic(): Anthropic {
  return (anthropicClient ??= new Anthropic({ apiKey: key("ANTHROPIC_API_KEY"), maxRetries: 2, timeout: 120_000 }));
}
function openai(): OpenAI {
  return (openaiClient ??= new OpenAI({ apiKey: key("OPENAI_API_KEY"), maxRetries: 2, timeout: 120_000 }));
}

function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return JSON.parse(fence[1]);
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("model did not return JSON");
}

/* ------------------------------------------------------- generateJSON */

export interface GenerateOpts {
  system?: string;
  purpose?: string;
  ref?: string;
  /** Use the cheaper OpenAI model when on that provider. */
  small?: boolean;
  maxTokens?: number;
}

/**
 * One call, one JSON object back that matches the schema. Low temperature where the
 * provider still takes one (the current Claude models do not; effort is the control).
 */
export async function generateJSON<T = unknown>(prompt: string, schema: Record<string, unknown>, opts: GenerateOpts = {}): Promise<JsonResult<T> | Unavailable> {
  const info = llmInfo({ small: opts.small });
  if (isUnavailable(info)) return info;
  const started = Date.now();
  const maxTokens = opts.maxTokens ?? 4000;

  if (info.provider === "anthropic") {
    const res = await anthropic().messages.create({
      model: info.model,
      max_tokens: maxTokens,
      system: opts.system,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("model declined the request");
    if (res.stop_reason === "max_tokens") throw new Error("model output was cut off at max_tokens");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const data = extractJson(text) as T;
    const usage = mkUsage(info.model, res.usage.input_tokens, res.usage.output_tokens, res.usage.cache_read_input_tokens ?? 0);
    logUsage({ provider: "anthropic", model: info.model, purpose: opts.purpose ?? "json", ref: opts.ref, input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, costUsd: usage.costUsd, ms: Date.now() - started });
    return { data, provider: "anthropic", model: info.model, usage };
  }

  const res = await openai().chat.completions.create({
    model: info.model,
    reasoning_effort: "low",
    max_completion_tokens: maxTokens,
    response_format: { type: "json_schema", json_schema: { name: "result", schema, strict: false } },
    messages: [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), { role: "user" as const, content: prompt }],
  });
  const choice = res.choices[0];
  if (!choice?.message?.content) throw new Error(`model returned no content (${choice?.finish_reason ?? "no choice"})`);
  if (choice.finish_reason === "length") throw new Error("model output was cut off at max_completion_tokens");
  const data = extractJson(choice.message.content) as T;
  const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const usage = mkUsage(info.model, (res.usage?.prompt_tokens ?? 0) - cached, res.usage?.completion_tokens ?? 0, cached);
  logUsage({ provider: "openai", model: info.model, purpose: opts.purpose ?? "json", ref: opts.ref, input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, costUsd: usage.costUsd, ms: Date.now() - started });
  return { data, provider: "openai", model: info.model, usage };
}

/* ------------------------------------------------------------ runTools */

export interface ToolRunOpts {
  system: string;
  purpose?: string;
  ref?: string;
  small?: boolean;
  maxSteps?: number;
  maxTokens?: number;
  /** Name of a tool that ends the loop. Its input is returned as `finish`. */
  finishTool?: string;
}

function summarize(result: unknown): string {
  if (result === undefined || result === null) return "nothing";
  if (typeof result === "string") return result.length > 160 ? result.slice(0, 157) + "..." : result;
  if (Array.isArray(result)) return `${result.length} rows`;
  if (typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (typeof o.error === "string") return `error: ${o.error}`;
    const keys = Object.keys(o);
    const counts = keys.filter((k) => Array.isArray(o[k])).map((k) => `${k} ${(o[k] as unknown[]).length}`);
    return counts.length ? counts.join(", ") : `${keys.length} fields`;
  }
  return String(result);
}

async function runTool(tools: ToolDef[], name: string, input: Record<string, unknown>, calls: ToolCallRecord[]): Promise<string> {
  const t = tools.find((x) => x.name === name);
  const started = Date.now();
  if (!t) {
    calls.push({ name, input, resultSummary: "error: unknown tool", ms: 0 });
    return JSON.stringify({ error: `unknown tool ${name}` });
  }
  try {
    const out = await t.run(input ?? {});
    calls.push({ name, input, resultSummary: summarize(out), ms: Date.now() - started });
    const s = JSON.stringify(out ?? null);
    return s.length > 60_000 ? s.slice(0, 60_000) + "...(truncated)" : s;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    calls.push({ name, input, resultSummary: `error: ${msg}`, ms: Date.now() - started });
    return JSON.stringify({ error: msg });
  }
}

/** Tool-using loop. The model can only see what our tool functions return. */
export async function runTools(question: string, tools: ToolDef[], opts: ToolRunOpts): Promise<ToolRunResult | Unavailable> {
  const info = llmInfo({ small: opts.small });
  if (isUnavailable(info)) return info;
  const started = Date.now();
  const maxSteps = opts.maxSteps ?? 8;
  const maxTokens = opts.maxTokens ?? 2500;
  const calls: ToolCallRecord[] = [];
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  const done = (text: string, finish?: Record<string, unknown>, stoppedEarly?: string): ToolRunResult => {
    const usage = mkUsage(info.model, input, output, cacheRead);
    logUsage({ provider: info.provider, model: info.model, purpose: opts.purpose ?? "tools", ref: opts.ref, input, output, cacheRead, costUsd: usage.costUsd, ms: Date.now() - started });
    return { text, finish, calls, provider: info.provider, model: info.model, usage, stoppedEarly };
  };

  if (info.provider === "anthropic") {
    const client = anthropic();
    const toolDefs: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: { ...(t.inputSchema as Anthropic.Tool.InputSchema), type: "object" } }));
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
    let lastText = "";
    for (let step = 0; step < maxSteps; step++) {
      const res = await client.messages.create({
        model: info.model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "medium" },
        tools: toolDefs,
        messages,
      });
      input += res.usage.input_tokens;
      output += res.usage.output_tokens;
      cacheRead += res.usage.cache_read_input_tokens ?? 0;
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      if (text) lastText = text;
      if (res.stop_reason === "refusal") return done(lastText, undefined, "model declined");
      if (res.stop_reason === "max_tokens") return done(lastText, undefined, "cut off at max_tokens");
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!uses.length) return done(lastText);
      const fin = opts.finishTool ? uses.find((u) => u.name === opts.finishTool) : undefined;
      if (fin) {
        calls.push({ name: fin.name, input: fin.input as Record<string, unknown>, resultSummary: "final answer", ms: 0 });
        return done(lastText, fin.input as Record<string, unknown>);
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await runTool(tools, u.name, u.input as Record<string, unknown>, calls) });
      messages.push({ role: "user", content: results });
    }
    return done(lastText, undefined, "step limit reached");
  }

  // OpenAI: the Responses API, because Chat Completions rejects function tools together with reasoning on the gpt-5.4 family.
  const client = openai();
  const toolDefs: OpenAI.Responses.FunctionTool[] = tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: { ...t.inputSchema, type: "object" },
    strict: false,
  }));
  const inputItems: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: question }];
  let lastText = "";
  const parse = (s: string): Record<string, unknown> => {
    try {
      return (JSON.parse(s || "{}") ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  for (let step = 0; step < maxSteps; step++) {
    const res = await client.responses.create({
      model: info.model,
      instructions: opts.system,
      input: inputItems,
      tools: toolDefs,
      reasoning: { effort: "low" },
      max_output_tokens: maxTokens,
      store: false,
    });
    const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
    input += (res.usage?.input_tokens ?? 0) - cached;
    output += res.usage?.output_tokens ?? 0;
    cacheRead += cached;
    const text = res.output
      .filter((o): o is OpenAI.Responses.ResponseOutputMessage => o.type === "message")
      .flatMap((m) => m.content)
      .filter((c): c is OpenAI.Responses.ResponseOutputText => c.type === "output_text")
      .map((c) => c.text)
      .join("")
      .trim();
    if (text) lastText = text;
    if (res.status === "incomplete") return done(lastText, undefined, `cut off: ${res.incomplete_details?.reason ?? "incomplete"}`);
    const uses = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (!uses.length) return done(lastText);
    const fin = opts.finishTool ? uses.find((u) => u.name === opts.finishTool) : undefined;
    if (fin) {
      const inp = parse(fin.arguments);
      calls.push({ name: fin.name, input: inp, resultSummary: "final answer", ms: 0 });
      return done(lastText, inp);
    }
    // Carry the whole turn forward (reasoning items included) so the next request has the model's context.
    inputItems.push(...(res.output as OpenAI.Responses.ResponseInputItem[]));
    for (const u of uses) {
      const content = await runTool(tools, u.name, parse(u.arguments), calls);
      inputItems.push({ type: "function_call_output", call_id: u.call_id, output: content });
    }
  }
  return done(lastText, undefined, "step limit reached");
}
