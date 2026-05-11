import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import type { ContentBlock, ParsedEntry, SessionDetail } from '../lib/types';
import { truncate } from '../lib/format';
import { EmptyState } from '../components/EmptyState';

type NodeKind = 'user' | 'assistant' | 'task' | 'system';

export function AgentTree({ detail }: { detail: SessionDetail }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges, entriesByUuid } = useMemo(() => buildGraph(detail), [detail]);

  if (nodes.length === 0) {
    return <EmptyState title="Empty session — nothing to graph" />;
  }

  const selectedEntry = selected ? entriesByUuid.get(selected) : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 relative">
        <ReactFlow
          nodes={nodes.map((n) => ({
            ...n,
            selected: n.id === selected,
          }))}
          edges={edges}
          onNodeClick={(_, node) => setSelected(node.id)}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selectedEntry && (
        <aside className="w-96 border-l border-gray-200 dark:border-gray-800 overflow-y-auto p-4 bg-white dark:bg-gray-950 shrink-0">
          <NodeDetail entry={selectedEntry} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}

function buildGraph(detail: SessionDetail): {
  nodes: Node[];
  edges: Edge[];
  entriesByUuid: Map<string, ParsedEntry>;
} {
  const conversation = detail.entries.filter(
    (e) => (e.type === 'user' || e.type === 'assistant') && e.uuid,
  );
  const entriesByUuid = new Map<string, ParsedEntry>();
  for (const e of conversation) entriesByUuid.set(e.uuid!, e);

  type NodeMeta = { id: string; kind: NodeKind; label: string; isSidechain: boolean };
  const nodeList: NodeMeta[] = [];
  const taskNodes: { id: string; parentUuid: string; description: string }[] = [];
  const allParentUuids = new Map<string, string>(); // uuid -> nearest convo ancestor uuid

  // Resolve parentUuid to its nearest conversation-entry ancestor, since
  // some assistant entries point to system/attachment uuids in between.
  const allByUuid = new Map<string, ParsedEntry>();
  for (const e of detail.entries) if (e.uuid) allByUuid.set(e.uuid, e);
  for (const e of conversation) {
    let p: string | null = e.parentUuid ?? null;
    while (p && !entriesByUuid.has(p)) {
      const node = allByUuid.get(p);
      if (!node || !node.parentUuid) {
        p = null;
        break;
      }
      p = node.parentUuid ?? null;
    }
    if (e.uuid && p) allParentUuids.set(e.uuid, p);
  }

  for (const e of conversation) {
    const kind: NodeKind = e.type === 'user' ? 'user' : 'assistant';
    nodeList.push({
      id: e.uuid!,
      kind,
      label: kind === 'user' ? userPreview(e) : assistantPreview(e),
      isSidechain: !!e.isSidechain,
    });
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const block of e.message!.content as ContentBlock[]) {
        if (block.type === 'tool_use' && (block as { name?: unknown }).name === 'Task') {
          const tid = String((block as { id?: unknown }).id || '');
          const input = (block as { input?: Record<string, unknown> }).input || {};
          const desc = String(input.description ?? input.prompt ?? 'Task');
          if (tid) taskNodes.push({ id: 'task-' + tid, parentUuid: e.uuid!, description: desc });
        }
      }
    }
  }

  // Build dagre layout.
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 20, ranksep: 40 });

  const W = 240;
  const H = 70;
  for (const n of nodeList) g.setNode(n.id, { width: W, height: H });
  for (const tn of taskNodes) g.setNode(tn.id, { width: W, height: 50 });

  const edgeList: { source: string; target: string; isTask?: boolean }[] = [];
  for (const e of conversation) {
    const childId = e.uuid!;
    const parentId = allParentUuids.get(childId);
    if (parentId) {
      edgeList.push({ source: parentId, target: childId });
      g.setEdge(parentId, childId);
    }
  }
  for (const tn of taskNodes) {
    edgeList.push({ source: tn.parentUuid, target: tn.id, isTask: true });
    g.setEdge(tn.parentUuid, tn.id);
  }

  dagre.layout(g);

  const nodes: Node[] = nodeList.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: 'default',
      position: { x: pos.x - W / 2, y: pos.y - H / 2 },
      data: { label: <NodeBody kind={n.kind} label={n.label} sidechain={n.isSidechain} /> },
      style: nodeStyle(n.kind, n.isSidechain),
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });
  for (const tn of taskNodes) {
    const pos = g.node(tn.id);
    nodes.push({
      id: tn.id,
      type: 'default',
      position: { x: pos.x - W / 2, y: pos.y - 25 },
      data: {
        label: <NodeBody kind="task" label={truncate(tn.description, 60)} sidechain={false} />,
      },
      style: nodeStyle('task', false),
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
  }

  const edges: Edge[] = edgeList.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    style: {
      stroke: e.isTask ? '#ec4899' : '#9ca3af',
      strokeWidth: e.isTask ? 2 : 1,
    },
    animated: !!e.isTask,
  }));

  return { nodes, edges, entriesByUuid };
}

function NodeBody({ kind, label, sidechain }: { kind: NodeKind; label: string; sidechain: boolean }) {
  return (
    <div className="text-left">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[9px] uppercase tracking-wide opacity-70">
          {kind === 'task' ? 'TASK' : kind}
        </span>
        {sidechain && (
          <span className="text-[9px] px-1 rounded bg-pink-200 text-pink-800 dark:bg-pink-900 dark:text-pink-100">
            sub
          </span>
        )}
      </div>
      <div className="text-[11px] leading-tight whitespace-normal break-words">{label}</div>
    </div>
  );
}

function nodeStyle(kind: NodeKind, sidechain: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: 8,
    fontSize: 11,
    border: '1px solid',
    borderRadius: 6,
    background: 'white',
    width: 240,
  };
  if (kind === 'task') {
    return { ...base, background: '#fdf2f8', borderColor: '#f9a8d4', color: '#831843' };
  }
  if (kind === 'user') {
    return { ...base, background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e3a8a' };
  }
  if (sidechain) {
    return { ...base, background: '#fdf2f8', borderColor: '#f9a8d4', color: '#831843' };
  }
  return { ...base, background: '#f9fafb', borderColor: '#e5e7eb', color: '#111827' };
}

function userPreview(e: ParsedEntry): string {
  const c = e.message?.content;
  if (typeof c === 'string') return truncate(c, 70);
  if (Array.isArray(c)) {
    for (const b of c as ContentBlock[]) {
      if (b.type === 'text' && typeof (b as { text?: unknown }).text === 'string') {
        return truncate((b as { text: string }).text, 70);
      }
      if (b.type === 'tool_result') return '[tool result]';
    }
  }
  return '(empty)';
}

function assistantPreview(e: ParsedEntry): string {
  const c = e.message?.content;
  if (Array.isArray(c)) {
    for (const b of c as ContentBlock[]) {
      if (b.type === 'text' && typeof (b as { text?: unknown }).text === 'string') {
        const t = (b as { text: string }).text.trim();
        if (t) return truncate(t, 70);
      }
      if (b.type === 'tool_use') {
        return '→ ' + String((b as { name?: unknown }).name ?? 'tool');
      }
    }
  }
  return '(thinking)';
}

function NodeDetail({ entry, onClose }: { entry: ParsedEntry; onClose: () => void }) {
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {entry.type}
          {entry.isSidechain && ' · sub-agent'}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          ✕
        </button>
      </div>
      {entry.timestamp && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{entry.timestamp}</div>
      )}
      {entry.message?.model && (
        <div className="text-xs font-mono mb-2">{entry.message.model}</div>
      )}
      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-800 dark:text-gray-200">
        {previewFull(entry)}
      </div>
    </div>
  );
}

function previewFull(entry: ParsedEntry): string {
  const c = entry.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '(no content)';
  const parts: string[] = [];
  for (const b of c as ContentBlock[]) {
    if (b.type === 'text' && typeof (b as { text?: unknown }).text === 'string') {
      parts.push((b as { text: string }).text);
    } else if (b.type === 'thinking') {
      parts.push(`[thinking]\n${(b as { thinking?: string }).thinking ?? ''}`);
    } else if (b.type === 'tool_use') {
      parts.push(`[tool_use: ${(b as { name?: string }).name}]`);
    } else if (b.type === 'tool_result') {
      parts.push(`[tool_result]`);
    }
  }
  return parts.join('\n\n');
}
