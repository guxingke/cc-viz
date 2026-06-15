import type {
  ContentBlock,
  ParsedEntry,
  RawEntry,
  SessionDetail,
  SessionSource,
  TokenUsage,
  TreeNode,
} from '../lib/types';
import { calcCost, resolvePricing } from '../lib/pricing';

const CONVO_TYPES = new Set(['user', 'assistant']);
const META_TYPES = new Set([
  'system',
  'summary',
  'session_meta',
  'turn_context',
  'ai-title',
  'agent-name',
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  'last-prompt',
  'queue-operation',
]);

export type ParseResult = {
  detail: SessionDetail;
  skippedLines: number;
  parseErrors: number;
};

export function parseSessionText(text: string, sessionId: string, projectId: string): ParseResult {
  const lines = text.split('\n');
  const rawEntries: RawEntry[] = [];
  let parseErrors = 0;
  let skippedLines = 0;

  for (const line of lines) {
    if (!line.trim()) {
      skippedLines++;
      continue;
    }
    try {
      const obj = JSON.parse(line) as RawEntry;
      rawEntries.push(obj);
    } catch {
      parseErrors++;
    }
  }

  const source: SessionSource = sessionId.startsWith('codex:')
    ? 'codex'
    : sessionId.startsWith('kimi:')
      ? 'kimi'
      : 'claude';
  if (source === 'codex') {
    return parseNormalizedEntries(
      normalizeCodexEntries(rawEntries),
      sessionId,
      projectId,
      source,
      skippedLines,
      parseErrors,
    );
  }
  if (source === 'kimi') {
    return parseNormalizedEntries(
      normalizeKimiEntries(rawEntries),
      sessionId,
      projectId,
      source,
      skippedLines,
      parseErrors,
    );
  }

  return parseNormalizedEntries(rawEntries, sessionId, projectId, source, skippedLines, parseErrors);
}

function parseNormalizedEntries(
  rawEntries: RawEntry[],
  sessionId: string,
  projectId: string,
  source: SessionSource,
  skippedLines: number,
  parseErrors: number,
): ParseResult {

  // Title resolution: prefer ai-title / summary; fallback to first user text.
  let title = '';
  for (const e of rawEntries) {
    if (e.type === 'ai-title' && typeof (e as RawEntry).aiTitle === 'string') {
      title = String((e as RawEntry).aiTitle);
      break;
    }
    if (e.type === 'summary' && typeof e.summary === 'string') {
      title = e.summary;
      break;
    }
  }
  if (!title) {
    const firstUser = rawEntries.find((e) => {
      if (e.type !== 'user' || !e.message || typeof e.message !== 'object') return false;
      return !!extractFirstHumanText(e.message.content);
    });
    title = extractFirstHumanText(firstUser?.message?.content) || 'Untitled session';
    if (title.length > 80) title = title.slice(0, 80) + '…';
  }

  // Filter to entries we care about (recognised + sorted).
  const parsedEntries: ParsedEntry[] = rawEntries
    .filter((e) => CONVO_TYPES.has(e.type) || META_TYPES.has(e.type))
    .map((e) => ({ ...e, recognized: CONVO_TYPES.has(e.type) || e.type === 'system' }))
    .sort((a, b) => {
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return ta - tb;
    });

  // Mark first-of-message on assistant entries so downstream consumers can dedupe usage.
  const seenMsgIds = new Set<string>();
  for (const e of parsedEntries) {
    if (e.type !== 'assistant') continue;
    const mid = e.message?.id;
    if (!mid) {
      e.isFirstOfMessage = true;
      continue;
    }
    if (seenMsgIds.has(mid)) {
      e.isFirstOfMessage = false;
    } else {
      seenMsgIds.add(mid);
      e.isFirstOfMessage = true;
    }
  }

  // Tree from parentUuid relationship — must include all uuid-bearing entries
  // because assistant/user entries often have parentUuid pointing to a
  // system/attachment node, so filtering breaks the chain.
  const tree = buildTree(parsedEntries.filter((e) => !!e.uuid));

  // Totals.
  const totalTokens: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let totalCostUsd = 0;
  let toolCallCount = 0;
  let hasSubagents = false;
  const modelCounts = new Map<string, number>();
  let cwd = '';
  let startedAt = '';
  let endedAt = '';

  for (const e of parsedEntries) {
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.timestamp) {
      if (!startedAt) startedAt = e.timestamp;
      endedAt = e.timestamp;
    }
    if (e.isSidechain) hasSubagents = true;

    if (e.type !== 'assistant' && e.type !== 'user') continue;

    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const block of e.message!.content as ContentBlock[]) {
        if (block.type === 'tool_use') toolCallCount++;
      }
    }

    if (e.type === 'assistant') {
      if (e.isFirstOfMessage) {
        const usage = e.message?.usage;
        if (usage) {
          addUsage(totalTokens, usage);
          totalCostUsd += calcCost(e.message?.model, usage);
        }
      }
      const m = e.message?.model;
      if (m) modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
    }
  }

  const messageCount = parsedEntries.filter(
    (e) => CONVO_TYPES.has(e.type) && hasConversationContent(e),
  ).length;
  const model = pickTopModel(modelCounts);

  const detail: SessionDetail = {
    id: sessionId,
    projectId,
    source,
    cwd,
    title,
    startedAt,
    endedAt,
    messageCount,
    toolCallCount,
    totalTokens,
    totalCostUsd,
    model,
    hasSubagents,
    entries: parsedEntries,
    tree,
  };

  return { detail, skippedLines, parseErrors };
}

function normalizeCodexEntries(entries: RawEntry[]): RawEntry[] {
  const out: RawEntry[] = [];
  let sessionId = '';
  let cwd = '';
  let model = '';
  let lastUuid: string | null = null;
  let seq = 0;
  const seenUsageKeys = new Set<string>();

  const push = (entry: RawEntry) => {
    const uuid = entry.uuid ?? `codex-${++seq}`;
    const parentUuid =
      typeof entry.parentUuid === 'string' || entry.parentUuid === null
        ? entry.parentUuid
        : lastUuid;
    out.push({
      ...entry,
      uuid,
      parentUuid,
      sessionId,
      cwd: typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : cwd,
    });
    lastUuid = uuid;
  };

  for (const e of entries) {
    const payload = objectPayload(e);
    if (e.type === 'session_meta') {
      sessionId = stringField(payload, 'id') || sessionId;
      cwd = stringField(payload, 'cwd') || cwd;
      push({
        ...e,
        type: 'session_meta',
        timestamp: e.timestamp || stringField(payload, 'timestamp'),
        cwd,
        parentUuid: null,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Codex session started' }],
        },
      });
      continue;
    }

    if (e.type === 'turn_context') {
      cwd = stringField(payload, 'cwd') || cwd;
      model = stringField(payload, 'model') || model;
      push({
        ...e,
        type: 'turn_context',
        timestamp: e.timestamp,
        cwd,
        message: {
          role: 'assistant',
          model,
          content: [],
        },
      });
      continue;
    }

    if (e.type === 'response_item') {
      const kind = stringField(payload, 'type');
      if (kind === 'message') {
        const role = stringField(payload, 'role');
        const content = normalizeCodexContent(payload.content);
        if (role === 'user' || role === 'assistant') {
          push({
            ...e,
            type: role,
            timestamp: e.timestamp,
            message: {
              id: stringField(payload, 'id') || `${e.timestamp ?? ''}:${seq + 1}`,
              role,
              model: role === 'assistant' ? model || undefined : undefined,
              content,
            },
          });
        }
      } else if (
        kind === 'function_call' ||
        kind === 'custom_tool_call' ||
        kind === 'local_shell_call'
      ) {
        const callId = stringField(payload, 'call_id') || stringField(payload, 'id');
        const name = stringField(payload, 'name') || kind;
        push({
          ...e,
          type: 'assistant',
          timestamp: e.timestamp,
          message: {
            id: callId || `${e.timestamp ?? ''}:${seq + 1}`,
            role: 'assistant',
            model: model || undefined,
            content: [
              {
                type: 'tool_use',
                id: callId || `codex-call-${seq + 1}`,
                name,
                input: normalizeCodexToolInput(payload),
              },
            ],
          },
        });
      } else if (
        kind === 'function_call_output' ||
        kind === 'custom_tool_call_output' ||
        kind === 'local_shell_call_output'
      ) {
        const callId = stringField(payload, 'call_id') || stringField(payload, 'id');
        if (callId) {
          push({
            ...e,
            type: 'user',
            timestamp: e.timestamp,
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: callId,
                  content: normalizeCodexToolOutput(payload),
                  is_error: isCodexToolError(payload),
                },
              ],
            },
          });
        }
      } else if (kind === 'reasoning') {
        const text = normalizeCodexReasoning(payload);
        if (text) {
          push({
            ...e,
            type: 'assistant',
            timestamp: e.timestamp,
            message: {
              id: stringField(payload, 'id') || `${e.timestamp ?? ''}:${seq + 1}`,
              role: 'assistant',
              model: model || undefined,
              content: [{ type: 'thinking', thinking: text }],
            },
          });
        }
      }
      continue;
    }

    if (e.type === 'event_msg') {
      const kind = stringField(payload, 'type');
      if (kind === 'task_started') {
        push({
          ...e,
          type: 'system',
          timestamp: e.timestamp,
          subtype: 'task_started',
        });
      } else if (kind === 'task_complete') {
        push({
          ...e,
          type: 'system',
          timestamp: e.timestamp,
          subtype: 'turn_duration',
          durationMs: Number(payload.duration_ms) || 0,
        });
      } else if (kind === 'token_count') {
        const usageKey = codexUsageKey(payload);
        if (seenUsageKeys.has(usageKey)) continue;
        seenUsageKeys.add(usageKey);
        const usage = normalizeCodexUsage(payload);
        push({
          ...e,
          type: 'assistant',
          timestamp: e.timestamp,
          message: {
            id: `usage:${e.timestamp ?? seq + 1}`,
            role: 'assistant',
            model: model || undefined,
            content: [],
            usage,
          },
        });
      }
    }
  }

  return out;
}

function objectPayload(e: RawEntry): Record<string, unknown> {
  const payload = (e as { payload?: unknown }).payload;
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function normalizeCodexContent(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const out: ContentBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const type = stringField(b, 'type');
    const text = stringField(b, 'text');
    if ((type === 'input_text' || type === 'output_text' || type === 'text') && text) {
      out.push({ type: 'text', text });
    } else if (type === 'reasoning_text' && text) {
      out.push({ type: 'thinking', thinking: text });
    }
  }
  return out;
}

function normalizeCodexToolInput(payload: Record<string, unknown>): Record<string, unknown> {
  const raw = payload.arguments ?? payload.input ?? {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: raw };
    } catch {
      return { value: raw };
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function normalizeCodexToolOutput(payload: Record<string, unknown>): unknown {
  if ('output' in payload) return payload.output;
  if ('result' in payload) return payload.result;
  if ('error' in payload) return payload.error;
  return '';
}

function isCodexToolError(payload: Record<string, unknown>): boolean {
  if (payload.success === false || payload.is_error === true) return true;
  const status = stringField(payload, 'status').toLowerCase();
  if (status === 'failed' || status === 'error') return true;
  const output = String(payload.output ?? payload.result ?? payload.error ?? '');
  const exitCode = output.match(/Exit code:\s*(-?\d+)/i);
  return !!exitCode && Number(exitCode[1]) !== 0;
}

function normalizeCodexReasoning(payload: Record<string, unknown>): string {
  const summary = payload.summary;
  if (Array.isArray(summary)) {
    return summary
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          return stringField(obj, 'text') || stringField(obj, 'summary');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return stringField(payload, 'text') || stringField(payload, 'summary');
}

function normalizeCodexUsage(payload: Record<string, unknown>): TokenUsage {
  const info = payload.info && typeof payload.info === 'object'
    ? (payload.info as Record<string, unknown>)
    : {};
  const last = info.last_token_usage && typeof info.last_token_usage === 'object'
    ? (info.last_token_usage as Record<string, unknown>)
    : {};
  const input = Number(last.input_tokens) || 0;
  const cached = Number(last.cached_input_tokens) || 0;
  return {
    input_tokens: Math.max(0, input - cached),
    output_tokens: Number(last.output_tokens) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    priced: false,
    reasoning_output_tokens: Number(last.reasoning_output_tokens) || 0,
    total_tokens: Number(last.total_tokens) || 0,
  };
}

function codexUsageKey(payload: Record<string, unknown>): string {
  const info = payload.info && typeof payload.info === 'object'
    ? (payload.info as Record<string, unknown>)
    : {};
  return JSON.stringify({
    total: info.total_token_usage ?? null,
    last: info.last_token_usage ?? null,
    context: info.model_context_window ?? null,
  });
}

function normalizeKimiEntries(entries: RawEntry[]): RawEntry[] {
  const out: RawEntry[] = [];
  let seq = 0;
  let cwd = '';
  let model = '';
  let lastUuid: string | null = null;

  type Step = {
    content: ContentBlock[];
    usage: TokenUsage | null;
    timestamp: string | undefined;
  };
  let currentStep: Step | null = null;
  let lastKimiUsage: {
    inputOther: number;
    output: number;
    inputCacheRead: number;
    inputCacheCreation: number;
  } | null = null;

  const pushEntry = (entry: RawEntry) => {
    const uuid = entry.uuid ?? `kimi-${++seq}`;
    const parentUuid =
      typeof entry.parentUuid === 'string' || entry.parentUuid === null
        ? entry.parentUuid
        : lastUuid;
    out.push({
      ...entry,
      uuid,
      parentUuid,
      cwd: typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : cwd,
    });
    lastUuid = uuid;
  };

  const ensureStep = (ts: string | undefined) => {
    if (!currentStep) currentStep = { content: [], usage: null, timestamp: ts };
  };

  const flushStep = () => {
    if (!currentStep || currentStep.content.length === 0) {
      currentStep = null;
      return;
    }
    pushEntry({
      type: 'assistant',
      timestamp: currentStep.timestamp,
      message: {
        role: 'assistant',
        model,
        content: currentStep.content,
        usage: currentStep.usage || undefined,
      },
    });
    currentStep = null;
  };

  const attachUsageToLastAssistant = (usage: TokenUsage) => {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].type === 'assistant') {
        const msg = out[i].message;
        if (msg) msg.usage = usage;
        break;
      }
    }
  };

  for (const e of entries) {
    const ts = e.timestamp || kimiTimestamp(e);

    if (e.type === 'config.update') {
      const cfg = e as Record<string, unknown>;
      if (typeof cfg.cwd === 'string' && cfg.cwd) cwd = cfg.cwd;
      if (typeof cfg.modelAlias === 'string' && cfg.modelAlias) model = cfg.modelAlias;
      continue;
    }

    if (e.type === 'turn.prompt') {
      flushStep();
      const text = extractKimiPromptText((e as { input?: unknown }).input);
      if (text) {
        pushEntry({
          ...e,
          type: 'user',
          timestamp: ts,
          message: { role: 'user', content: [{ type: 'text', text }] },
        });
      }
      continue;
    }

    if (e.type === 'context.append_message') {
      const msg = (e as { message?: unknown }).message;
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as { role?: string; content?: unknown };
      if (m.role === 'user') continue; // duplicate of turn.prompt
      if (m.role === 'assistant') {
        flushStep();
        const content = normalizeKimiContent(m.content);
        if (content.length > 0) {
          pushEntry({
            ...e,
            type: 'assistant',
            timestamp: ts,
            message: { role: 'assistant', model, content },
          });
        }
      }
      continue;
    }

    if (e.type === 'context.append_loop_event') {
      const event = (e as { event?: unknown }).event;
      if (!event || typeof event !== 'object') continue;
      const ev = event as Record<string, unknown>;
      const eventType = typeof ev.type === 'string' ? ev.type : '';

      if (eventType === 'step.begin') {
        flushStep();
        currentStep = { content: [], usage: null, timestamp: ts };
      } else if (eventType === 'step.end') {
        flushStep();
      } else if (eventType === 'content.part') {
        const part = ev.part;
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        const partType = typeof p.type === 'string' ? p.type : '';
        ensureStep(ts);
        if (partType === 'think') {
          const text = String(p.thinking ?? '');
          if (text) currentStep!.content.push({ type: 'thinking', thinking: text });
        } else if (partType === 'text') {
          const text = String(p.text ?? '');
          if (text) currentStep!.content.push({ type: 'text', text });
        }
      } else if (eventType === 'tool.call') {
        ensureStep(ts);
        const id = String(ev.toolCallId || `kimi-call-${++seq}`);
        const name = String(ev.name || 'tool');
        currentStep!.content.push({
          type: 'tool_use',
          id,
          name,
          input: normalizeKimiToolInput(ev.args),
        });
      } else if (eventType === 'tool.result') {
        const toolCallId = typeof ev.toolCallId === 'string' ? ev.toolCallId : '';
        if (toolCallId) {
          flushStep();
          pushEntry({
            ...e,
            type: 'user',
            timestamp: ts,
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolCallId,
                  content: ev.result,
                  is_error: ev.is_error === true,
                },
              ],
            },
          });
        }
      }
      continue;
    }

    if (e.type === 'usage.record') {
      const usageResult = normalizeKimiUsage((e as { usage?: unknown }).usage, lastKimiUsage);
      if (usageResult) {
        lastKimiUsage = usageResult.current;
        if (currentStep) {
          currentStep.usage = usageResult.usage;
        } else {
          attachUsageToLastAssistant(usageResult.usage);
        }
      }
      continue;
    }

    if (e.type === 'permission.record_approval_result') {
      flushStep();
      const toolName = String((e as { toolName?: unknown }).toolName || 'tool');
      pushEntry({
        ...e,
        type: 'system',
        timestamp: ts,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `Approved: ${toolName}` }],
        },
      });
    }
  }

  flushStep();
  return out;
}

function kimiTimestamp(e: RawEntry): string | undefined {
  const t = (e as { time?: unknown }).time;
  if (typeof t === 'number') return new Date(t).toISOString();
  return e.timestamp;
}

function extractKimiPromptText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const type = String((item as { type?: unknown }).type);
    if (type === 'text') {
      const text = String((item as { text?: unknown }).text ?? '');
      if (text) return text;
    }
  }
  return '';
}

function normalizeKimiContent(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: ContentBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const type = typeof b.type === 'string' ? b.type : '';
    if (type === 'text') {
      const text = String(b.text ?? '');
      if (text) out.push({ type: 'text', text });
    }
  }
  return out;
}

function normalizeKimiToolInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object') return args as Record<string, unknown>;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
    return { value: args };
  }
  return {};
}

function normalizeKimiUsage(
  usage: unknown,
  previous: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number } | null,
): { usage: TokenUsage; current: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number } } | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const current = {
    inputOther: Number(u.inputOther) || 0,
    output: Number(u.output) || 0,
    inputCacheRead: Number(u.inputCacheRead) || 0,
    inputCacheCreation: Number(u.inputCacheCreation) || 0,
  };
  const prev = previous ?? {
    inputOther: 0,
    output: 0,
    inputCacheRead: 0,
    inputCacheCreation: 0,
  };
  return {
    usage: {
      input_tokens: Math.max(0, current.inputOther - prev.inputOther),
      output_tokens: Math.max(0, current.output - prev.output),
      cache_read_input_tokens: Math.max(0, current.inputCacheRead - prev.inputCacheRead),
      cache_creation_input_tokens: Math.max(0, current.inputCacheCreation - prev.inputCacheCreation),
      priced: false,
    },
    current,
  };
}

function extractFirstText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

function isSyntheticContextText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.startsWith('<environment_context>') ||
    t.startsWith('<permissions instructions>') ||
    t.startsWith('<git-context>')
  );
}

function extractFirstHumanText(content: unknown): string {
  if (typeof content === 'string') {
    return isSyntheticContextText(content) ? '' : content;
  }
  if (!Array.isArray(content)) return '';
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    if (isSyntheticContextText(block.text)) continue;
    return block.text;
  }
  return '';
}

function hasConversationContent(e: ParsedEntry): boolean {
  const content = e.message?.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.length > 0;
}

function addUsage(into: TokenUsage, src: TokenUsage) {
  into.input_tokens = (into.input_tokens || 0) + (Number(src.input_tokens) || 0);
  into.output_tokens = (into.output_tokens || 0) + (Number(src.output_tokens) || 0);
  into.cache_creation_input_tokens =
    (into.cache_creation_input_tokens || 0) + (Number(src.cache_creation_input_tokens) || 0);
  into.cache_read_input_tokens =
    (into.cache_read_input_tokens || 0) + (Number(src.cache_read_input_tokens) || 0);
}

function pickTopModel(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [m, n] of counts) if (n > bestN) ((bestN = n), (best = m));
  return best;
}

function buildTree(entries: ParsedEntry[]): TreeNode | null {
  if (entries.length === 0) return null;
  const byUuid = new Map<string, TreeNode>();
  for (const e of entries) {
    if (!e.uuid) continue;
    byUuid.set(e.uuid, {
      uuid: e.uuid,
      parentUuid: e.parentUuid ?? null,
      children: [],
      isSidechain: !!e.isSidechain,
    });
  }
  let root: TreeNode | null = null;
  for (const e of entries) {
    if (!e.uuid) continue;
    const node = byUuid.get(e.uuid)!;
    const parentId = e.parentUuid;
    if (parentId && byUuid.has(parentId)) {
      byUuid.get(parentId)!.children.push(node);
    } else if (!root) {
      root = node;
    }
  }
  return root;
}

/**
 * Pair tool_use blocks (in assistant entries) with their tool_result blocks
 * (in subsequent user entries). Returns a flat list keyed by tool_use_id.
 */
export type ToolCallPair = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  assistantUuid: string | undefined;
  assistantTimestamp: string | undefined;
  result?: {
    content: unknown;
    isError: boolean;
    userUuid: string | undefined;
    userTimestamp: string | undefined;
    /** outer toolUseResult — some Claude Code versions store result payload here */
    outer?: unknown;
  };
};

export function pairToolCalls(entries: ParsedEntry[]): ToolCallPair[] {
  const pairs = new Map<string, ToolCallPair>();
  for (const e of entries) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type !== 'tool_use') continue;
      const b = block as { id?: unknown; name?: unknown; input?: unknown };
      const id = typeof b.id === 'string' ? b.id : '';
      if (!id) continue;
      pairs.set(id, {
        id,
        name: typeof b.name === 'string' ? b.name : 'unknown',
        input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
        assistantUuid: e.uuid,
        assistantTimestamp: e.timestamp,
      });
    }
  }
  for (const e of entries) {
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type !== 'tool_result') continue;
      const b = block as { tool_use_id?: unknown; content?: unknown; is_error?: unknown };
      const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
      if (!id) continue;
      const pair = pairs.get(id);
      if (!pair) continue;
      pair.result = {
        content: b.content,
        isError: !!b.is_error,
        userUuid: e.uuid,
        userTimestamp: e.timestamp,
        outer: e.toolUseResult,
      };
    }
  }
  return [...pairs.values()];
}

export { resolvePricing };
