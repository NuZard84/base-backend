# Frontend Canvas — Improvement Plan

Plan to improve client-side performance, storage, and scalability for the canvas frontend.

---

## 1. Current Problems

| Problem | Impact | Root Cause |
|---------|--------|------------|
| **Full nodes/edges in localStorage** | 5–10MB limit hit; slow parse/reload; large JSON | `partialize` persists entire `projects` (including nodes, edges) |
| **Duplicate storage** | Higher memory use | Same data in React state + Zustand |
| **Full canvas fetch on load** | Slow initial load; overfetch | Always `GET /canvases/:id` (all nodes/edges) |
| **No viewport-based loading** | Poor scaling | Viewport API exists but is unused |
| **All nodes rendered** | Slower UI with many nodes | React Flow renders everything |

---

## 2. Improvement Tiers

### Tier 1 — Quick wins (low effort, immediate impact)

Stop persisting nodes/edges for backend projects.

### Tier 2 — Medium effort (better caching & load)

Separate metadata from content; smarter persistence.

### Tier 3 — Larger changes (viewport loading)

Viewport-based loading for large canvases.

---

## 3. Tier 1: Don’t Persist Backend Nodes/Edges

**Goal:** Avoid storing full canvas data in localStorage for backend projects.

### 3.1 Problem

`useCanvasStore` persists `projects` and `activeProject`. Each project can have large `nodes` and `edges` arrays.

### 3.2 Approach

Exclude `nodes` and `edges` from persisted data for backend projects (where `id` is a string UUID).

### 3.3 Implementation

**File:** `base/src/store/useCanvasStore.ts`

**Option A — Slim projects before persist**

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

**Option B — Custom `storage` with a `reviver`**

- On save: omit nodes/edges for backend projects.
- On load: hydrate from API when a backend project becomes active.

### 3.4 Load Flow Change

When rehydrating from localStorage, backend projects have `nodes: []`, `edges: []`. The existing logic already handles that:

```ts
if (activeProject.nodes?.length || activeProject.edges?.length) {
  setNodes(activeProject.nodes || []);
  setEdges(activeProject.edges || []);
  return;
}
if (isBackendProject(activeProject.id)) {
  loadCanvasContent(activeProject.id as string)...
}
```

So backend projects will re-fetch on tab reload.

### 3.5 Outcome

- localStorage usage drops for backend projects.
- Rehydration faster.
- Offline restore of backend canvases is lost (acceptable; they’re always fetched when online).

---

## 4. Tier 2: Separate Metadata From Content

**Goal:** Store only essential data in Zustand; treat nodes/edges as transient.

### 4.1 Project Shape

**Current:** `Project` includes `nodes`, `edges`, etc., all persisted.

**Proposed:**

- **Metadata (persisted):** `id`, `name`, `description`, `nodeCount`, `edgeCount`, `time`, `boundsMinX/Y`, `boundsMaxX/Y`, `viewportX/Y/Zoom`.
- **Content (in-memory only):** `nodes`, `edges`.

### 4.2 Changes

1. **partialize:** Persist only metadata; never persist `nodes` or `edges`.
2. **updateProject:** Continue updating `nodes`/`edges` in memory for UI; they are not written to localStorage.
3. **Single source of truth:** Keep React Flow’s nodes/edges as the primary in-memory source. Zustand can hold metadata only for backend projects.

### 4.3 Caching Strategy

- Backend project open → fetch full canvas → store in memory (e.g. React state or a non-persisted cache).
- On project switch away → optionally keep a small LRU cache in memory (e.g. last 2–3 canvases).
- No localStorage for canvas content.

---

## 5. Tier 3: Viewport-Based Loading

**Goal:** Load only nodes in the visible viewport for large canvases.

### 5.1 When to Use

- Enable for canvases where `nodeCount` exceeds a threshold (e.g. 50–100).
- Keep full load for small canvases.

### 5.2 Flow

```
1. Switch to backend project
2. If nodeCount > THRESHOLD:
   a. Fetch canvas metadata + edges (new endpoint or existing with nodes: [])
   b. Get viewport (initial or stored)
   c. loadNodesInViewport(canvasId, { minX, minY, maxX, maxY })
   d. setNodes(viewportNodes), setEdges(allEdges)
3. On viewport change (pan/zoom):
   a. Debounce 150–300ms
   b. Compute new bbox
   c. loadNodesInViewport → merge into nodes
   d. Optionally unload nodes outside viewport + margin
```

### 5.3 Fix loadNodesInViewport

**File:** `base/src/app/hooks/useCanvasApi.ts`

Backend returns `nodeType` (e.g. `QUESTION`, `RESPONSE`). React Flow needs `QuestionNode`, `ResponseNode`. Use `backendNodeToReactFlow` from canvasApi (reuse existing mapping):

```ts
import { backendNodeToReactFlow } from '@/lib/canvasApi';

// In loadNodesInViewport:
return backendNodes.map((n) => backendNodeToReactFlow(n));
```

Or export `NODE_TYPE_TO_FRONTEND` from `canvasApi.ts` and map `type` manually.

### 5.4 Viewport → Bbox Helper

**File:** `base/src/lib/canvasApi.ts` or a new `useViewportBbox` hook

```ts
export function viewportToBbox(viewport: { x: number; y: number; zoom: number }, padding = 100) {
  const minX = (-viewport.x - padding) / viewport.zoom;
  const minY = (-viewport.y - padding) / viewport.zoom;
  const maxX = minX + (window.innerWidth + padding * 2) / viewport.zoom;
  const maxY = minY + (window.innerHeight + padding * 2) / viewport.zoom;
  return { minX, minY, maxX, maxY };
}
```

### 5.5 React Flow onViewportChange

**File:** `base/src/app/draw/page.tsx`

```tsx
const onViewportChange = useCallback(({ x, y, zoom }) => {
  if (!isBackendProject(activeProject?.id) || nodeCount <= VIEWPORT_THRESHOLD) return;
  // Debounced loadNodesInViewport with { minX, minY, maxX, maxY }
}, [activeProject, nodeCount]);
```

### 5.6 Edge Handling

- Viewport endpoint returns nodes only.
- Edges reference nodes by id; options:
  - **A:** Fetch full edges once when entering viewport mode (`GET /canvases/:id` with a “metadata only” option).
  - **B:** Filter edges client-side to those whose `source`/`target` are in loaded nodes (some edges may be missing until both ends are loaded).
  - **C:** New backend endpoint that returns edges for given node IDs.

### 5.7 Merge / Unload Strategy

- **Merge:** New viewport nodes merged by `id`; existing nodes updated.
- **Unload:** Optionally remove nodes outside `viewport + margin` to cap memory.
- **Debounce:** ~200–300ms on viewport change to avoid too many API calls.

---

## 6. Implementation Checklist

### Tier 1 (Quick)

- [ ] Update `useCanvasStore` partialize to exclude nodes/edges for backend projects.
- [ ] Re-test: backend project load, switch, refresh.
- [ ] Check localStorage size before/after.

### Tier 2 (Medium)

- [ ] Define clear Project metadata vs content schema.
- [ ] Refactor partialize to only persist metadata.
- [ ] Add in-memory cache for recently viewed canvases (optional).
- [ ] Remove duplicate writes of nodes/edges to store where redundant.

### Tier 3 (Viewport)

- [ ] Add `NODE_TYPE_TO_FRONTEND` usage in `loadNodesInViewport`.
- [ ] Implement `viewportToBbox` helper.
- [ ] Add `onViewportChange` with debouncing.
- [ ] Implement viewport-load flow for large canvases (nodeCount > threshold).
- [ ] Decide edge strategy (A, B, or C) and implement.
- [ ] Add merge/unload logic for viewport nodes.
- [ ] Test with large canvas (100+ nodes).

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `store/useCanvasStore.ts` | partialize: exclude nodes/edges for backend projects |
| `hooks/useCanvasApi.ts` | Fix loadNodesInViewport type mapping |
| `lib/canvasApi.ts` | Add viewportToBbox (optional) |
| `draw/page.tsx` | onViewportChange, viewport-load branch |
| `hooks/useCanvasLoader.ts` | Optional: metadata-only load path |

---

## 8. Expected Results

| Metric | Before | After Tier 1 | After Tier 2 | After Tier 3 |
|--------|--------|--------------|--------------|--------------|
| localStorage size | Full canvas | Metadata only (backend) | Metadata only | Metadata only |
| Initial load (large canvas) | Full fetch | Full fetch | Full fetch | Viewport fetch |
| Memory (1000 nodes) | ~2x (React + Zustand) | ~2x | ~1x + metadata | ~viewport-only |
| API calls on pan/zoom | 0 | 0 | 0 | Debounced viewport |

---

## See Also

- **FRONTEND_CANVAS_LOGIC.md** — Current flow and viewport API status
- **CANVAS_SYNC_LOGIC.md** — Save logic and debouncing
