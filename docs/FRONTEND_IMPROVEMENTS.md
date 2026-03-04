# Frontend Canvas — Improvement Plan

Plan to improve client-side performance, storage, and scalability.

---

## 1. Current Problems

| Problem | Impact | Root Cause |
|---------|--------|------------|
| **Full nodes/edges in localStorage** | 5–10MB limit hit; slow parse/reload; large JSON | `partialize` persists entire `projects` (including nodes, edges) |
| **Duplicate storage** | Higher memory use | Same data in React state + Zustand |
| **Full canvas fetch on load** | Slow initial load; overfetch | Always `GET /canvases/:id` (all nodes/edges) |
| **No viewport-based loading** | Poor scaling for large canvases | Viewport API exists but is unused |
| **All nodes rendered** | Slower UI with many nodes | React Flow renders everything |

---

## 2. Improvement Tiers

| Tier | Effort | Goal |
|------|--------|------|
| **1** | Low | Don't persist nodes/edges for backend projects |
| **2** | Medium | Separate metadata from content; smarter persistence |
| **3** | High | Viewport-based loading for large canvases |

---

## 3. Tier 1: Don't Persist Backend Nodes/Edges

### Problem

`useCanvasStore` persists `projects` and `activeProject`. Each project can have large `nodes` and `edges` arrays stored in localStorage.

### Solution

Exclude `nodes` and `edges` from persisted data for backend projects (where `id` is a string UUID).

**File:** `base/src/store/useCanvasStore.ts`

```ts
partialize: (state) => ({
  projects: state.projects.map((p) => {
    // Backend projects: persist metadata only
    if (typeof p.id === 'string') {
      const { nodes, edges, ...meta } = p;
      return { ...meta, nodes: [], edges: [] };
    }
    // Local projects: keep nodes/edges
    return p;
  }),
  activeProject: state.activeProject
    ? (typeof state.activeProject.id === 'string'
        ? { ...state.activeProject, nodes: [], edges: [] }
        : state.activeProject)
    : null,
}),
```

### Load Flow

When rehydrating from localStorage, backend projects have `nodes: []`, `edges: []`. Existing logic handles this:

```ts
if (activeProject.nodes?.length || activeProject.edges?.length) {
  setNodes(activeProject.nodes || []);
  return;
}
if (isBackendProject(activeProject.id)) {
  loadCanvasContent(activeProject.id as string)... // Re-fetch
}
```

### Outcome

- localStorage usage drops significantly for backend projects
- Rehydration faster
- Backend projects always fresh on reload

---

## 4. Tier 2: Metadata-Only Persistence

### Problem

Even with Tier 1, `updateProject` writes nodes/edges to Zustand, which can cause memory overhead.

### Solution

Store only metadata in Zustand for backend projects:

**Metadata (persisted):** `id`, `name`, `description`, `nodeCount`, `edgeCount`, `time`, `boundsMinX/Y`, `boundsMaxX/Y`, `viewportX/Y/Zoom`

**Content (in-memory only):** `nodes`, `edges` stay in React Flow state only

### Changes

1. `partialize`: Never persist `nodes` or `edges` for any backend project
2. `updateProject`: For backend projects, only update metadata fields
3. Optional: Add in-memory LRU cache for last 2–3 viewed canvases

### Outcome

- Single source of truth: React Flow state for nodes/edges
- Zustand holds only metadata for backend projects
- Faster state updates

---

## 5. Tier 3: Viewport-Based Loading

### Problem

Large canvases (100+ nodes) load all nodes at once, causing slow initial fetch and rendering.

### Solution

Load only nodes in the visible viewport; fetch more as user pans/zooms.

### When to Use

Enable when `nodeCount > 100` (configurable threshold).

### Flow

```
1. Switch to large canvas
2. Fetch canvas metadata + all edges
3. loadNodesInViewport(canvasId, { minX, minY, maxX, maxY })
4. setNodes(viewportNodes), setEdges(allEdges)
5. On pan/zoom (debounced 200ms):
   - Compute new bbox
   - loadNodesInViewport → merge into nodes
   - Optionally unload nodes outside viewport + margin
```

### 5.1 Fix loadNodesInViewport Bug

**File:** `base/src/app/hooks/useCanvasApi.ts`

**Issue:** Backend returns `nodeType` as enum (`QUESTION`, `RESPONSE`). React Flow needs `QuestionNode`, `ResponseNode`.

**Fix:** Use `backendNodeToReactFlow`:

```ts
import { backendNodeToReactFlow } from '@/lib/canvasApi';

const loadNodesInViewport = useCallback(
  async (canvasId: string, params?: { minX?: number; minY?: number; maxX?: number; maxY?: number; tileIds?: number[] }): Promise<Node[]> => {
    if (!isAuthenticated) return [];
    setError(null);
    try {
      const backendNodes = await fetchNodesInViewport(canvasId, params);
      return backendNodes.map((n) => backendNodeToReactFlow(n)); // FIX: Use proper mapping
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load nodes';
      setError(msg);
      return [];
    }
  },
  [isAuthenticated]
);
```

### 5.2 Viewport → Bbox Helper

**File:** `base/src/lib/canvasApi.ts`

```ts
export function viewportToBbox(viewport: { x: number; y: number; zoom: number }, padding = 200) {
  const minX = (-viewport.x - padding) / viewport.zoom;
  const minY = (-viewport.y - padding) / viewport.zoom;
  const maxX = minX + (window.innerWidth + padding * 2) / viewport.zoom;
  const maxY = minY + (window.innerHeight + padding * 2) / viewport.zoom;
  return { minX, minY, maxX, maxY };
}
```

### 5.3 onViewportChange

**File:** `base/src/app/draw/page.tsx`

```tsx
const debouncedViewportLoad = useDebounceCallback((viewport) => {
  if (!isBackendProject(activeProject?.id) || nodeCount <= 100) return;
  const bbox = viewportToBbox(viewport);
  loadNodesInViewport(activeProject.id, bbox).then((newNodes) => {
    setNodes((prev) => mergeNodes(prev, newNodes));
  });
}, 200);

// In ReactFlow:
<ReactFlow onViewportChange={debouncedViewportLoad} ... />
```

### 5.4 Edge Handling

**Option A (Recommended):** Fetch all edges once on load (edges are usually fewer than nodes).

**Option B:** Filter edges client-side to visible nodes only (some edges may be hidden until both endpoints load).

### 5.5 Merge Strategy

```ts
function mergeNodes(existing: Node[], incoming: Node[]): Node[] {
  const map = new Map(existing.map(n => [n.id, n]));
  incoming.forEach(n => map.set(n.id, n));
  return Array.from(map.values());
}
```

**Optional unload:** Remove nodes outside `viewport + margin * 2` to cap memory.

---

## 6. Implementation Checklist

### Tier 1 (Quick Win)
- [ ] Update `useCanvasStore` partialize to exclude nodes/edges for backend projects
- [ ] Test: backend project load, switch, refresh
- [ ] Verify localStorage size reduction

### Tier 2 (Metadata Only)
- [ ] Refactor partialize to persist only metadata fields
- [ ] Update `updateProject` to skip nodes/edges for backend projects
- [ ] Optional: Add in-memory LRU cache

### Tier 3 (Viewport Loading)
- [ ] Fix `loadNodesInViewport` to use `backendNodeToReactFlow`
- [ ] Add `viewportToBbox` helper to `canvasApi.ts`
- [ ] Add `onViewportChange` with debouncing in `page.tsx`
- [ ] Implement viewport-load flow for canvases with nodeCount > 100
- [ ] Choose edge strategy (A or B) and implement
- [ ] Add `mergeNodes` and optional unload logic
- [ ] Test with large canvas (100+ nodes)

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `store/useCanvasStore.ts` | partialize: exclude nodes/edges for backend projects |
| `hooks/useCanvasApi.ts` | Fix loadNodesInViewport type mapping with `backendNodeToReactFlow` |
| `lib/canvasApi.ts` | Add viewportToBbox helper; export NODE_TYPE_TO_FRONTEND if needed |
| `draw/page.tsx` | Add onViewportChange, viewport-load branch, mergeNodes |
| `hooks/useCanvasLoader.ts` | Optional: metadata-only load path for large canvases |

---

## 8. Expected Results

| Metric | Before | After Tier 1 | After Tier 3 |
|--------|--------|--------------|--------------|
| **localStorage size** | Full canvas (can hit 5–10MB) | Metadata only (~KB) | Metadata only |
| **Initial load (1000 nodes)** | Full fetch (~1–2s) | Full fetch | Viewport fetch (~50–200 nodes, <500ms) |
| **Memory (1000 nodes)** | ~2x (React + Zustand duplication) | ~2x | Viewport-only (~100–300 nodes) |
| **API calls on pan/zoom** | 0 | 0 | Debounced viewport fetch (200ms) |
| **Rehydration speed** | Slow (parse large JSON) | Fast (metadata only) | Fast |

---

## See Also

- **FRONTEND_CANVAS_LOGIC.md** — Current flow and viewport API status
- **CANVAS_SYNC_LOGIC.md** — Save logic and debouncing
- **BACKEND_CANVAS_LOGIC.md** — Node types, storage, parent-child
