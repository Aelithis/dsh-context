
import { z } from "zod";
import "@deepseek-ai/dsh-session";
import z$1 from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/host/activity.d.ts
interface ToolStart {
  start: number;
  day: string;
}
interface ActivityState {
  days: Record<string, ActivityDay>;
  /** The route in force (the last `request/header`'s config wins) — prices each settlement. */
  model?: string;
  provider?: string;
  stepStart?: number;
  /** The last turn whose first settlement was booked, so a multi-step turn counts once. */
  lastTurn?: number;
  toolStarts?: Record<string, ToolStart | undefined>;
  /** Pending `skill`-tool call ids: the wrapper match alone is not trusted, or a `read` quoting it would book a load. */
  skillCalls?: string[];
}
//#endregion
//#region src/host/headers.d.ts
/** v1 rows carried the producer description and raw schema; later folds append metadata-only. */
interface StoredHeaderTool {
  name: string;
  tokens: number;
  description?: string;
  plugin?: string;
  schema?: unknown;
}
/** v1 rows carried `system`; later folds carry `systemTokens`. */
interface StoredHeaderRecord {
  seq: number;
  time: number;
  system?: string;
  systemTokens?: number;
  tools: StoredHeaderTool[];
}
interface HeadersState {
  headers: StoredHeaderRecord[];
}
//#endregion
//#region src/host/foldState.d.ts
/** The state's command record: the wire record plus the callId the fold pairs result/job events on. Never served —
 * `foldWire` strips it (optional precisely so the strip is a plain `delete`). */
interface CommandStateRecord extends CommandRecord {
  call?: string;
}
interface TimelineState {
  /** Model-visible surface, newest last. */
  surface: SurfaceNode[];
  sums: Record<Category, number>;
  systemTokens: number;
  /** The live system-prompt nodes, oldest first; `systemTokens` is the LAST nonempty one (the harness rule), so an empty dormant node
   * keeps its position. Absent rows fall back to the header epoch's envelope figure. */
  systems?: SystemPromptNode[];
  toolsTokens: number;
  /** The projection cache requires plain JSON: an `undefined`-valued property fails EVERY cache write for the session, so optional fields
   * stay absent until a value is known. */
  model?: string;
  provider?: string;
  /** Last-wins: a header without an effort clears it. */
  reasoningEffort?: string;
  lastModel?: string;
  contextWindow?: number;
  /** The newest `request/header` envelope's routed output cap (dsh materializes the adapter default into it). Last-wins: a header
   * omitting the cap clears it. */
  maxOutputTokens?: number;
  requests: RequestRecord[];
  /** Turn runs in `requests` (consecutive records sharing one `turn`), maintained at the single append site and recomputed on trim, so
   * the cap check stays O(1); absent on older rows. */
  turnRuns?: number;
  events: ContextEventRecord[];
  /** Removed surface nodes as stamped COPIES carrying `gone`, in removal order; bounded to `maxArchiveNodes` and pruned to removals after
   * the oldest retained request. */
  archived: SurfaceNode[];
  /** Cumulative billed-token totals per (provider, model, period); never trimmed, so the estimate covers the COMPLETE log. */
  cost?: SessionCostUsage;
  humanInputs?: number;
  answers?: number;
  /** The user's newest own message as a bounded one-line preview. Last-wins: a text-less input keeps the previous line. */
  lastUser?: string;
  archiveFloor?: number;
  /** Bumped when a fold mutates the served detail (requests, events, live surface, archive); the slim head carries it. */
  detailRev?: number;
  /** Whole-session timing totals, running sums over the COMPLETE log like `cost`. */
  timing?: TimingTotals;
  /** The open step's start instant, armed by `step/start` and consumed by the following `assistant/message` and `step/end`; one slot, not
   * a map, so a hostile interleaved log degrades to skipped durations. */
  stepStart?: {
    time: number;
    firstToken?: number;
  };
  /** The open step's CLOSED user-wait intervals; `step/end` subtracts their clamped union from the step window to price `activeMs`, then
   * deletes the slot. */
  stepWaits?: {
    start: number;
    end: number;
  }[];
  /** The open step's PENDING approval waits (request id → `approval/asked` instant); a crash mid-decision leaves the pair dangling, so
   * `step/end` closes the survivors at its own instant. */
  stepApprovals?: Record<string, number>;
  /** The seq of the request record the open step's `assistant/message` committed — the back-pointer `step/end` stamps `activeMs` onto;
   * nothing pushes between a step's message and its end, so the stamp is an O(1) tail write. */
  stepRequestSeq?: number;
  /** The timing strip's painted spans in log order, stamped with their REAL instants; idle time BETWEEN steps carries no span. Bounded by
   * TIMING_SPANS_MAX (newest tail kept). */
  spans: TimingSpan[];
  /** The open step's accumulated spans; `step/end` clamps them into the step window, de-overlaps first-wins (parallel runs paint their
   * union), fills holes with the residue kind, then deletes the slot (plain-JSON precondition). */
  stepSpans?: TimingSpan[];
  /** Tool callId → name, start instant and raw arguments, armed by `tool/call` and DELETED when its `tool/result` folds in — the map
   * stays at pending-call size instead of growing for the session's lifetime. */
  callNames: Record<string, {
    name: string;
    start: number;
    argsRaw?: string;
  }>;
  /** Seq list the next replacement shadows, armed by the metering event and consumed by the replacement that must follow synchronously;
   * it can differ from the replacement's declared range (pruned nodes keep their own seqs). */
  pendingShadowedSeqs?: number[];
  /** The metering event whose `tokens` the shadowed path rewrites from gross shadow price to the NET freed amount. */
  pendingShadowEventSeq?: number;
  fileOps: FileOpRecord[];
  /** The newest dropped op's seq (the card's coverage floor for the served op log). */
  fileOpsFloor?: number;
  /** The command log, in call order (creation at `tool/call`, settle in place at `tool/result`/`job/settled`). */
  commands: CommandStateRecord[];
  /** The newest dropped command record's seq (the panel's coverage floor). */
  commandsFloor?: number;
  /** Whole-log execution tallies; each record contributes exactly once, at its running → terminal transition. */
  commandStats?: CommandStats;
  /** Nested Code-Mode command records buffered by their top run_code call id until the parent's result folds
   * (same lifecycle as `pendingCodeOps`). */
  pendingCodeCmds?: Record<string, CommandStateRecord[]>;
  /** Nested Code-Mode ops buffered by their top run_code call id until the parent's result folds (the dispatch events land BEFORE it).
   * Bounded by PENDING_CODE_OPS_MAX, so a hostile log that never settles a run_code cannot grow it. */
  pendingCodeOps?: Record<string, FileOpRecord[]>;
}
//#endregion
//#region src/shared/types.d.ts
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Slim head on the split generation, inline value on channel-less hosts; key absence = no host half. */
    contextTimeline: ContextTimeline;
    /** Epoch metadata in its own unit so the hot timeline stays lean; key absence = an older host (tokens only). */
    contextHeaders: ContextHeaders;
    /** The per-day activity ledger; key absence = an older host (empty heatmap). */
    contextActivity: ContextActivity;
  }
  interface SessionProjectionStateMap {
    contextTimeline: TimelineState;
    contextHeaders: HeadersState;
    contextActivity: ActivityState;
  }
}
/** `skill` is the harness-injected skill machinery: the `<available_skills>` digest, a `/name` invocation's instructions, and a
 * `skill`-tool load. */
type Category = 'user' | 'inject' | 'skill' | 'assistant' | 'tool';
/** Its TEXT comes from the `system/message` event at `seq`; the effective figure is the LAST node with `tokens > 0`. */
interface SystemPromptNode {
  seq: number;
  time: number;
  tokens: number;
}
/** Counts over the RETAINED records; `steps` is the retained request-record count. */
interface TimelineCounts {
  turns: number;
  steps: number;
  injects: number;
  compactions: number;
  prunes: number;
  /** Distinct names among the retained events tagged `sub: 'skill'`; the digest has none and never counts. Absent = 0. */
  skills?: number;
}
/** The newest retained request record's billing summary. */
interface TimelineLast {
  seq: number;
  total: number;
  prompt?: number;
}
interface ActivityDay {
  /** Billed tokens that day (input + cache read/write + output); a settlement-less request counts only toward `requests`. */
  tokens: number;
  /** Completed model calls (assistant settlements) that day. */
  requests: number;
  /** Keyed provider → model → pricing period, scoped to the day the requests INITIATED. Absent = tokens-only bars. */
  cost?: SessionCostUsage;
  /** Turns whose FIRST settlement landed on this (step-initiation) day. */
  turns?: number;
  /** Completed tool runs whose step STARTED that day. */
  toolCalls?: number;
  /** Summed tool-run durations for those runs, in ms. */
  toolsMs?: number;
  /** Summed wall time of steps that ENDED, charged to the day their step STARTED, in ms. */
  wallMs?: number;
  /** Skill name → `{ n: loads, last: last-load instant in epoch ms }`; absent = an empty day. */
  skills?: Record<string, {
    n: number;
    last: number;
  }>;
}
/** Host-local day key (`YYYY-MM-DD`, shared/days.ts) → that day's billed volume; the Insights page merges every listed ledger. */
interface ContextActivity {
  days: Record<string, ActivityDay>;
}
/** Served by `/api/dsh-context/skills` (host/skills.ts); every field but `name` is best-effort. */
interface SkillInfo {
  /** Kebab-case identifier — the join key onto `ActivityDay.skills`. */
  name: string;
  description: string;
  /** Absolute instruction file path, when the provider is filesystem-backed. */
  path?: string;
  /** Discovery source bucket ('project-agents', 'user-dsh', 'bundled', …). */
  source?: string;
}
/** The ONE declaration shared by the Host Config schema (host/config.ts) and the Client's settings form. */
type DefaultGranularity = 'step' | 'turn';
type DefaultTrendMode = 'total' | 'delta';
/** The browser delta baseline: the immediately preceding record, or the previous turn's last step. */
type DefaultDeltaBase = 'step' | 'turn';
type DefaultFileSort = 'count' | 'lines' | 'latest' | 'path' | 'name';
type DefaultToolSort = 'size' | 'count' | 'name';
/** Where the Context panel mounts; 'hide' registers no surface. */
type DefaultPlacement = 'all' | 'tab' | 'sidebar' | 'hide';
type InsightsEntry = 'show' | 'hide';
type DefaultDurationCurve = 'show' | 'hide';
/** Retained-step count at which the trend turns its Overview ribbon on; 'off' never auto-switches. */
type OverviewAutoSteps = 'off' | '100' | '200' | '300';
/** The Insights page's rolling preset; a calendar-picked range replaces it for that visit only. */
type DefaultOverviewRange = 'today' | '7d' | '30d' | 'all';
type FleetTab = 'show' | 'hide';
interface PluginSettings {
  defaultPlacement: DefaultPlacement;
  defaultGranularity: DefaultGranularity;
  defaultTrendMode: DefaultTrendMode;
  defaultDeltaBase: DefaultDeltaBase;
  defaultToolSort: DefaultToolSort;
  defaultFileSort: DefaultFileSort;
  insightsEntry: InsightsEntry;
  defaultDurationCurve: DefaultDurationCurve;
  overviewAutoSteps: OverviewAutoSteps;
  defaultOverviewRange: DefaultOverviewRange;
  fleetTab: FleetTab;
  /** Free text joined ahead of the harness's assembled system prompt; empty disables. */
  promptPrefix: string;
  /** Free text joined behind the harness's assembled system prompt; empty disables. */
  promptSuffix: string;
}
interface Snapshot {
  ok: boolean;
  /** Present ONLY below the supported baseline: the host folds nothing (all figures zero) and the client shows the upgrade gate. */
  unsupported?: {
    current: string;
    minimum: string;
  };
  model?: string;
  provider?: string;
  /** The newest request envelope's materialized reasoning effort. Absent = no effort in force, or a row folded before the field
   * existed. */
  reasoningEffort?: string;
  contextWindow?: number;
  /** The newest request envelope's routed output cap (auto-compaction reserves it). Absent = no cap in the log, or a row folded before
   * the field existed. */
  maxOutputTokens?: number;
  current: {
    system: number;
    tools: number;
    user: number;
    inject: number;
    skill: number;
    assistant: number;
    tool: number;
    total: number;
  };
  /** Image blocks in the CURRENT context (uploads plus nested tool-result images). Absent = 0. */
  images?: number;
  /** Tool calls whose result is live (a `skill`-tool node keeps counting). Absent = 0. */
  toolCalls?: number;
  /** Whole-session tally of non-injection `user/message` plus answered `ask_user_question` over the COMPLETE log. Absent = 0. */
  humanInputs?: number;
  /** Whole-session replies: one per assistant message carrying non-blank text (tool-only steps are not replies). Absent = 0. */
  answers?: number;
  /** The newest own message as a one-line preview (first text block, whitespace collapsed, 80 chars max). Absent = hidden. */
  lastUser?: string;
  /** Split-generation head fields: present exactly when the host serves the slim head; `detailRev` bumps whenever the detail collections
   * change. */
  counts?: TimelineCounts;
  last?: TimelineLast;
  detailRev?: number;
  /** The slim head serves these EMPTY (collections ride the detail channel): the client swaps in the detail payload's. */
  requests: RequestRecord[];
  events: ContextEventRecord[];
  /** Cumulative session-cost raw material; absent until a request with a known model reports usage. */
  cost?: SessionCostUsage;
  /** Whole-session timing totals; absent until the first step lifecycle completes. */
  timing?: TimingTotals;
  /** The live system-prompt nodes, oldest first. Absent on rows folded before the field existed: the client then reads the header epoch's
   * `systemTokens`. */
  systems?: SystemPromptNode[];
  /** The served live surface: the newest `maxNodes` tail PLUS every older live inject/skill node (they land first and are pinned).
   * Seq-ordered, oldest first. */
  nodes: SurfaceNode[];
  /** Live nodes not served: the overflow beyond `maxNodes` minus the pinned inject/skill nodes. */
  droppedNodes: number;
  /** Recently REMOVED surface nodes stamped with `gone` (the replacing event's seq); a node belongs to request R when `seq < R.seq &&
   * (gone undefined || gone > R.seq)`. */
  archive: SurfaceNode[];
  /** Newest seq among the `droppedNodes` nodes not served; present only when droppedNodes > 0. */
  surfaceFloor?: number;
  /** Newest `gone` among retention-dropped archive entries; steps below it may miss removed nodes. */
  archiveFloor?: number;
  /** The fold-derived file-op log and trim floor: INLINE value and detail payload only, never the slim head. */
  fileOps?: FileOpRecord[];
  fileOpsFloor?: number;
  /** The fold-derived command log and its trim floor/coverage honesty, same channel as `fileOps`. */
  commands?: CommandRecord[];
  commandsFloor?: number;
  /** Whole-log execution tallies behind the command panel's title; survives list trimming. */
  commandStats?: CommandStats;
  /** INLINE value and detail payload only; absent on rows folded before the collection existed. */
  spans?: TimingSpan[];
}
/** The split generation's DETAIL payload (host/detail.ts); `rev` mirrors the head's `detailRev` and is the client's latest-wins cursor. */
interface ContextTimelineDetail {
  rev: number;
  /** The slim head at the SAME fold cut; a cold-listed session has no `contextTimeline` row, so the Agent network ring reads this. */
  head?: ContextTimeline;
  requests: RequestRecord[];
  events: ContextEventRecord[];
  nodes: SurfaceNode[];
  droppedNodes: number;
  archive: SurfaceNode[];
  surfaceFloor?: number;
  archiveFloor?: number;
  /** The file-op log (shared/fileOps.ts) over the FULL log; Code-Mode nested dispatches book on their parent `run_code` result. */
  fileOps?: FileOpRecord[];
  /** The newest dropped op's seq when the op log trimmed (coverage honesty, same family as `archiveFloor`). */
  fileOpsFloor?: number;
  /** The command log (shared/commands.ts); nested Code-Mode dispatches flush on their parent `run_code` result. */
  commands?: CommandRecord[];
  /** The newest dropped record's seq when the command log trimmed. */
  commandsFloor?: number;
  commandStats?: CommandStats;
  /** The completed steps' time slices in log order, positioned by their real instants. Absent = no strip. */
  spans?: TimingSpan[];
}
type CommandStatus = 'running' | 'completed' | 'failed' | 'killed';
/** One shell/code execution, folded from `tool/call` (creation) paired with `tool/result` and — on hosts that log them —
 * `job/registered` / `job/settled` (precise timing and outcome). Without job events the timing/exit are envelope-derived
 * (`derived: true`). Nested Code-Mode dispatches carry `parent` (their run_code result's seq, the locate target).
 * `gone` is client-joined, not host-stamped. */
interface CommandRecord {
  /** The call event's seq — the record's stable identity. */
  seq: number;
  /** The result event's seq — the surface node a reveal targets. Absent while running and on nested Code-Mode records
   * (those reveal on `parent`). */
  resultSeq?: number;
  /** The call event's instant — the list's chronological anchor. */
  time: number;
  tool: string;
  /** The command text (a run_code record carries the program's source), capped at the fold's maxCommandChars. */
  cmd: string;
  cmdTruncated?: true;
  /** The model-authored intent (bash/pwsh require it; persistent shells and run_code may omit it). */
  description?: string;
  /** The result meta's cwd when logged, else the workdir argument; absent = the session's cwd. */
  cwd?: string;
  timeoutMs?: number;
  /** Dispatched to the background (an acked result with no outcome yet shows running until a `job/settled` lands). */
  background?: true;
  /** The requested sandbox escalation, when the call carried one. */
  sandbox?: string;
  /** A nested Code-Mode dispatch record. */
  codeMode?: true;
  parent?: number;
  turn?: number;
  step?: number;
  /** job.startedAt when registered, else the call instant. */
  start: number;
  /** job.finishedAt when settled, else the result instant; absent while running. */
  end?: number;
  status: CommandStatus;
  /** Explicit exit code from a marker or job detail; absent = unknown (never fabricate a 0). */
  exit?: number;
  /** The exit 0 was inferred from the ABSENCE of any marker (the shell tools omit the marker on a clean exit). */
  exitInferred?: true;
  signal?: string;
  timedOut?: true;
  stopped?: true;
  denied?: true;
  /** The result message's isError (an infrastructure failure, not a command failure). */
  err: boolean;
  outChars?: number;
  outTruncated?: true;
  stderr?: true;
  /** Timing/exit derive from event envelopes — no job events on this log (parallel calls can overstate durations). */
  derived?: true;
  gone?: number;
}
/** Whole-log execution tallies, maintained incrementally: `runs`/`failed`/`ms` at each record's terminal transition,
 * `bg` when a background dispatch becomes known (the argument at creation, else the hand-off ack). */
interface CommandStats {
  runs: number;
  /** Failed OR killed terminal outcomes. */
  failed: number;
  /** Summed execution ms over records with both endpoints known (concurrent runs double-count wall time). */
  ms: number;
  /** Runs dispatched to the background, whether or not they ever settle. */
  bg: number;
}
/** Folded from the durable tool lifecycle (`tool/call` + `tool/result`, or a nested `tool/ptc-dispatch`); line deltas are estimates off
 * the call ARGUMENTS. `gone` is client-joined, not host-stamped. */
interface FileOpRecord {
  seq: number;
  /** The op's file; for a pathless search the searched PATTERN (`pattern: true`). */
  path: string;
  kind: 'read' | 'write' | 'search';
  tool: string;
  time?: number;
  err: boolean;
  added: number;
  removed: number;
  /** The searched pattern, with the include filter when one narrowed the call. */
  detail?: string;
  /** Meta-attributed search op only: matched lines the result reported for this file. */
  hits?: number;
  /** Read ops only: the exact 1-based window the result meta reported, else the `limit`-argument estimate (`est: true`). */
  read?: {
    start: number;
    count: number;
  } | {
    count: number;
    est: true;
  };
  /** Nested Code-Mode op only: the run_code result node the op ran under (the locate target). */
  parent?: number;
  /** Nested Code-Mode op only: the run_code program's model-authored description. */
  program?: string;
  /** The searched-pattern marker: `path` is a pattern, not a file — display must not relativize it. */
  pattern?: true;
  /** Client-joined archive stamp (see the type note); absent on the wire. */
  gone?: number;
}
/** The `contextTimeline` projection's whole value; `ok` is always `true` here (kept for wire compatibility). */
type ContextTimeline = Snapshot;
/** One painted span of the timing strip (TTFT wait, decode block, tool-run window, or residue gap); `start`/`end` are REAL instants,
 * packed gapless in log order, and `end` > `start` always. */
interface TimingSpan {
  /** The timing card's own slice vocabulary (same keys, same colors). */
  kind: 'ttft' | 'reasoning' | 'text' | 'toolarg' | 'tools' | 'other';
  start: number;
  end: number;
}
/** One pricing bucket's cumulative billed tokens: a running total over the COMPLETE session log, never trimmed. */
interface CostBucketTotals {
  uncached: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
interface ToolTimingTotals {
  calls: number;
  ms: number;
}
/** Whole-session totals over the COMPLETE log: `wallMs` whole steps, `ttftMs` step-start → decode-start, `genMs`
 * decode-start → assistant-message, `toolsMs` per-call. The decode window opens at the first OBSERVABLE instant, so
 * marker-tiled windows never double-count; speed* keep the first-token anchor; `calls`/`toolCalls` count messages/pairs. */
interface TimingTotals {
  wallMs: number;
  ttftMs: number;
  genMs: number;
  reasoningMs?: number;
  reasoningBlocks?: number;
  textMs?: number;
  textBlocks?: number;
  toolArgMs?: number;
  toolArgBlocks?: number;
  speedTokens?: number;
  speedMs?: number;
  calls: number;
  toolsMs: number;
  toolCalls: number;
  /** Per-tool-name tallies behind the timing card's ranking (bounded). */
  tools: Record<string, ToolTimingTotals>;
}
/** One billed model's totals split by pricing period: period-less providers book everything under `peak`; DeepSeek's `peak` prices at
 * twice the list (off-peak) rate, `off` at list. */
interface CostModelUsage {
  peak?: CostBucketTotals;
  off?: CostBucketTotals;
}
/** Cumulative provider-reported billed tokens keyed by the request envelope's DSH provider id ('' when none) then model id — the faces
 * the Client's models.dev price book resolves. */
interface SessionCostUsage {
  [provider: string]: {
    [model: string]: CostModelUsage;
  };
}
interface SurfaceNode {
  seq: number;
  time?: number;
  cat: Category;
  tokens: number;
  /** Image blocks inside this node's message (absent when zero). */
  imgs?: number;
  /** Set only on `archive` entries: the seq of the replacement event that shadowed this node. */
  gone?: number;
  form?: string;
  /** The producer identity the matching inject event names (host pricing.ts `injectionSourceName`); absent when unreadable or predating
   * the stamp. */
  name?: string;
  text?: string;
  tool?: string;
  err?: boolean;
  skill?: string;
  calls?: string[];
}
/** One answered model call (a step); consecutive records of one turn form it. */
interface RequestRecord {
  turn?: number;
  step?: number;
  time: number;
  seq: number;
  system: number;
  tools: number;
  user: number;
  inject: number;
  assistant: number;
  tool: number;
  total: number;
  prompt?: number;
  /** Skill-machinery tokens of this request; absent on rows folded before the category existed (read as 0). */
  skill?: number;
  /** Billed cache-read (served) prompt tokens — the hit-rate numerator against `prompt`; absent on older hosts, and zero is a real value.
   */
  cacheRead?: number;
  output?: number;
  /** The step's ACTIVE ms (`step/start` → `step/end` minus in-step user waits), stamped at `step/end`; absent while the step is open. */
  activeMs?: number;
  /** Turn-mode aggregate marker, set by the Client's aggregateByTurn (the Host never sets it). */
  stepCount?: number;
  /** Delta-mode signed net change, set by the Client's deltaOf (the Host never sets it). */
  net?: number;
}
interface ContextEventRecord {
  seq: number;
  time: number;
  kind: 'compaction' | 'prune' | 'inject' | 'model' | 'mode';
  form?: string;
  tokens?: number;
  count?: number;
  sub?: string;
  name?: string;
  detail?: string;
  from?: string;
  to?: string;
  /** Turn/step of the request logged right BEFORE the event (host-stamped). */
  fromTurn?: number;
  fromStep?: number;
  /** Turn/step of the request this event contributed to (host-stamped). */
  turn?: number;
  step?: number;
}
interface HeaderTool {
  name: string;
  tokens: number;
  /** The registering plugin's label: `mcp:<server>` for MCP tools, or the pinned first-party map; `UNKNOWN_TOOL_SOURCE` marks a boot-time
   * tool, absent = no tag. */
  plugin?: string;
}
/** One request-header epoch's METADATA, in force from this seq until the next. CONTENT is deliberately not projected (every list row
 * would carry it) and is fetched as a {@link HeaderEpochContent}. */
interface HeaderRecord {
  seq: number;
  time: number;
  /** The epoch's estimated system-prompt tokens; absent when it logged no system prompt. */
  systemTokens?: number;
  tools: HeaderTool[];
}
/** The `contextHeaders` projection value: the bounded epoch list (newest last). */
interface ContextHeaders {
  headers: HeaderRecord[];
}
//#endregion
//#region src/host/config.d.ts
declare const DEFAULT_BOUNDS: {
  maxRequestSteps: number;
  /** Newest whole-turn window kept; trimming crosses whole turns, never mid-turn. */
  maxKeptTurns: number;
  maxEvents: number;
  /** Pathological-session backstop only: each push ships the whole value (~150B/node). */
  maxNodes: number;
  maxArchiveNodes: number;
  maxFileOps: number;
  maxCommands: number;
  /** The command text caps per record; the card offers the full text through the browser's message body. */
  maxCommandChars: number;
};
/** The resolved fold bounds; derived from {@link DEFAULT_BOUNDS} so the two cannot drift. */
type FoldBounds = typeof DEFAULT_BOUNDS;
export type Config = Partial<FoldBounds> & Partial<PluginSettings>;
export declare const Config: z$1<Schemastery.ObjectS<NoInfer<{
  maxRequestSteps: z$1<number, number, "defined">;
  maxKeptTurns: z$1<number, number, "defined">;
  maxEvents: z$1<number, number, "defined">;
  maxNodes: z$1<number, number, "defined">;
  maxArchiveNodes: z$1<number, number, "defined">;
  maxFileOps: z$1<number, number, "defined">;
  maxCommands: z$1<number, number, "defined">;
  maxCommandChars: z$1<number, number, "defined">;
  defaultPlacement: z$1<"all" | "hide" | "sidebar" | "tab", "all" | "hide" | "sidebar" | "tab", "defined">;
  defaultGranularity: z$1<"step" | "turn", "step" | "turn", "defined">;
  defaultTrendMode: z$1<"delta" | "total", "delta" | "total", "defined">;
  defaultDeltaBase: z$1<"step" | "turn", "step" | "turn", "defined">;
  defaultToolSort: z$1<"count" | "name" | "size", "count" | "name" | "size", "defined">;
  defaultFileSort: z$1<"count" | "latest" | "lines" | "name" | "path", "count" | "latest" | "lines" | "name" | "path", "defined">;
  insightsEntry: z$1<"hide" | "show", "hide" | "show", "defined">;
  defaultDurationCurve: z$1<"hide" | "show", "hide" | "show", "defined">;
  overviewAutoSteps: z$1<"100" | "200" | "300" | "off", "100" | "200" | "300" | "off", "defined">;
  defaultOverviewRange: z$1<"30d" | "7d" | "all" | "today", "30d" | "7d" | "all" | "today", "defined">;
  fleetTab: z$1<"hide" | "show", "hide" | "show", "defined">;
  promptPrefix: z$1<string, string, "defined">;
  promptSuffix: z$1<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
  maxRequestSteps: z$1<number, number, "defined">;
  maxKeptTurns: z$1<number, number, "defined">;
  maxEvents: z$1<number, number, "defined">;
  maxNodes: z$1<number, number, "defined">;
  maxArchiveNodes: z$1<number, number, "defined">;
  maxFileOps: z$1<number, number, "defined">;
  maxCommands: z$1<number, number, "defined">;
  maxCommandChars: z$1<number, number, "defined">;
  defaultPlacement: z$1<"all" | "hide" | "sidebar" | "tab", "all" | "hide" | "sidebar" | "tab", "defined">;
  defaultGranularity: z$1<"step" | "turn", "step" | "turn", "defined">;
  defaultTrendMode: z$1<"delta" | "total", "delta" | "total", "defined">;
  defaultDeltaBase: z$1<"step" | "turn", "step" | "turn", "defined">;
  defaultToolSort: z$1<"count" | "name" | "size", "count" | "name" | "size", "defined">;
  defaultFileSort: z$1<"count" | "latest" | "lines" | "name" | "path", "count" | "latest" | "lines" | "name" | "path", "defined">;
  insightsEntry: z$1<"hide" | "show", "hide" | "show", "defined">;
  defaultDurationCurve: z$1<"hide" | "show", "hide" | "show", "defined">;
  overviewAutoSteps: z$1<"100" | "200" | "300" | "off", "100" | "200" | "300" | "off", "defined">;
  defaultOverviewRange: z$1<"30d" | "7d" | "all" | "today", "30d" | "7d" | "all" | "today", "defined">;
  fleetTab: z$1<"hide" | "show", "hide" | "show", "defined">;
  promptPrefix: z$1<string, string, "defined">;
  promptSuffix: z$1<string, string, "defined">;
}>>, "plain">;
//#endregion
//#region src/host/index.d.ts
export declare const name = "dsh-context";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
//#endregion
export type { ActivityDay, ActivityState, Category, ContextActivity, ContextEventRecord, ContextHeaders, ContextTimeline, ContextTimelineDetail, HeaderRecord, HeaderTool, HeadersState, RequestRecord, SkillInfo, Snapshot, SurfaceNode, TimelineCounts, TimelineLast, TimelineState };
//# sourceMappingURL=index.d.ts.map