# Frontend Canvas Logic — State, API Usage & Viewport Loading

Documentation of frontend canvas flow: state management, when APIs are called, and viewport-based node loading (current vs remaining).

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js + React Flow)                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│  useCanvasStore (Zustand)          useCanvasApi             useCanvasLoader       │
│  - projects[]                      - loadCanvases           - createProject       │
│  - activeProject                   - loadCanvas (full)      - loadCanvasContent    │
│  - updateProject                   - loadNodesInViewport    - isBackendProject    │
│  - setActiveProject                - saveToBackend         - deleteProject       │
│                                    - createCanvas                                 │
│  useSavedProject ───────────────────────────────────────────────────────────────│
│  useAddNode (saveNodes, saveEdges) ──► AddNodes.tsx                              │
│  page.tsx (Flow) ──► onNodesChange, onNodeDragStop, onEdgesChange, onConnect     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. State Flow

### 2.1 Project Types

| Type | id | Source | Nodes/Edges |
|------|-----|--------|-------------|
| **Local** | number (timestamp) | `addProject` | Stored in Zustand only |
| **Backend** | string (UUID) | `loadCanvases` | Fetched via API when selected |

**Detection:** `isBackendProject(id) === typeof id === 'string'`

### 2.2 useCanvasStore (Zustand + localStorage)

- **projects:** List of canvases (local + backend list items)
- **activeProject:** Currently selected canvas
- **Persisted:** `projects`, `activeProject` (localStorage key: `canvas-storage`)

### 2.3 useSavedProject

Re-exports `useCanvasStore` + `useAuthStore`. Used for project CRUD and auth.

---

## 3. Canvas Load Flow

### 3.1 On Auth (Logged In)

1. `useCanvasLoader` useEffect runs when `isAuthenticated` and `auth` are set
2. `loadCanvases()` → `GET /canvases` → List of canvases
3. Maps to projects: `{ id, name, nodes: [], edges: [] }` (nodes/edges empty)
4. `setProjects(backendProjects)` — replaces store
5. `setActiveProject(projects[0])` if any

### 3.2 On Project Switch (activeProject.id change)

1. `page.tsx` useEffect watches `activeProject?.id`
2. If `activeProject.nodes?.length || activeProject.edges?.length` — use cached data, `setNodes`/`setEdges`
3. Else if `isBackendProject(activeProject.id)`:
   - `loadCanvasContent(activeProject.id)` → `loadCanvas(id)` → `GET /canvases/:id`
   - Full canvas with nodes + edges
   - `backendCanvasToReactFlow(canvas)` → React Flow nodes/edges
   - `setNodes`, `setEdges`, `updateProject` (cache in store)
4. Else (local project) — use `activeProject.nodes`/`edges`

**Current behavior:** Always full load. No viewport-based loading.

---

## 4. Save Flow

### 4.1 When saveNodes / saveEdges Runs

| Trigger | Calls |
|---------|-------|
| Node add/remove (non-position, non-select, non-dimensions) | `debouncingSaveNode` (200ms) |
| Edge change / connect | `debouncingSaveEdge` (200ms) |
| Node drag stop | `saveNodes` directly (after 250ms) |
| QuestionNode/YoutubeNode Submit | `saveNodes` directly |
| CommentNode Add | `saveNodes` directly |

### 4.2 saveNodes Logic (AddNodes.tsx)

```
1. nodes = getNodes(), edges = getEdges()
2. updateProject(targetId, { nodes, edges })  // Always — local store
3. If isAuthenticated && typeof targetId === 'string':
   viewport = getViewport()
   saveToBackend(targetId, nodes, edges, viewport)
```

`saveToBackend` → `buildSyncPayload` → `PUT /canvases/:id/sync`

---

## 5. API Usage Summary

| API | Used By | When |
|-----|---------|------|
| `GET /canvases` | useCanvasLoader | On auth |
| `GET /canvases/:id` | loadCanvasContent | When switching to backend project |
| `POST /canvases` | createNewCanvas | Create project (auth) |
| `PUT /canvases/:id/sync` | saveToBackend | On save triggers |
| `PATCH /canvases/:id/rename` | renameCanvasById | Rename in NavBar |
| `DELETE /canvases/:id` | removeCanvas | Delete project |
| `GET /canvases/:id/nodes?minX=&maxX=&minY=&maxY=` | **Not used** | — |
| `GET /canvases/:id/nodes?tileIds=` | **Not used** | — |

---

## 6. Viewport-Based Node Loading

### 6.1 What Exists (Implemented)

| Layer | Status | Notes |
|-------|--------|-------|
| **Backend** | Done | `GET /canvases/:id/nodes` with minX, maxX, minY, maxY or tileIds |
| **canvasApi.ts** | Done | `fetchNodesInViewport(canvasId, params)` |
| **useCanvasApi** | Done | `loadNodesInViewport(canvasId, params)` returns `Node[]` |
| **Usage** | **Not wired** | No component calls `loadNodesInViewport` |

### 6.2 Bug in loadNodesInViewport

`loadNodesInViewport` maps backend nodes like this:

```ts
return backendNodes.map((n) => ({
  id: n.clientId ?? n.id,
  type: n.nodeType,  // BUG: "QUESTION" not "QuestionNode"
  ...
}))
```

Backend `nodeType` is enum: `QUESTION`, `RESPONSE`, `IMAGE`, etc. React Flow expects `QuestionNode`, `ResponseNode`, etc. Must use `NODE_TYPE_TO_FRONTEND` from canvasApi.

### 6.3 Current Logic (Full Load)

```
Switch to backend project
  → loadCanvas(id)
  → GET /canvases/:id (full canvas)
  → backendCanvasToReactFlow → setNodes, setEdges
  → All nodes loaded at once
```

### 6.4 Remaining Logic (Viewport-Based Load)

To support loading only nodes in viewport for large canvases:

| Step | Task | Details |
|------|------|---------|
| 1 | **Fix loadNodesInViewport** | Use `NODE_TYPE_TO_FRONTEND[nodeType]` for `type` |
| 2 | **Initial load** | On project switch, fetch canvas **metadata** (edges, bounds) + nodes in initial viewport |
| 3 | **Viewport change handler** | On React Flow `onViewportChange` (pan/zoom), compute visible bbox or tileIds, call `loadNodesInViewport` |
| 4 | **Merge strategy** | Merge fetched nodes with existing (by id); unload nodes that scroll out of view (optional) |
| 5 | **Edges** | Edges reference nodes — need full edge list or edges for visible nodes only. Current backend returns nodes only from viewport; edges come from full canvas. Options: (a) Fetch full edges once on load, (b) Add endpoint for edges in viewport |
| 6 | **Tile ID computation** | Frontend must compute tileIds from viewport: same formula as backend (`tileId = tileY * 10000 + tileX`, TILE_SIZE=512) |

### 6.5 Bbox / Tile Computation (Frontend)

To get `minX, minY, maxX, maxY` from viewport:

```ts
// React Flow viewport: { x, y, zoom }
// Visible area in canvas coordinates:
const minX = -viewport.x / viewport.zoom;
const minY = -viewport.y / viewport.zoom;
const maxX = minX + window.innerWidth / viewport.zoom;
const maxY = minY + window.innerHeight / viewport.zoom;
```

Add padding for prefetching if desired.

### 6.6 Suggested Integration Points

| File | Change |
|------|--------|
| `useCanvasApi.ts` | Fix `loadNodesInViewport` to use `NODE_TYPE_TO_FRONTEND` |
| `page.tsx` or new hook | Add `onViewportChange` → compute bbox → `loadNodesInViewport` → merge nodes |
| `useCanvasLoader` / load flow | For large canvases, load metadata + viewport nodes first; defer full load |
| `canvasApi.ts` | Add `fetchCanvasMeta(id)` if needed (canvas without nodes, or with edge list only) |

---

## 7. Key Files

| File | Role |
|------|------|
| `lib/canvasApi.ts` | API functions, buildSyncPayload, backendCanvasToReactFlow, NODE_TYPE_TO_FRONTEND |
| `hooks/useCanvasApi.ts` | loadCanvases, loadCanvas, loadNodesInViewport, saveToBackend, etc. |
| `hooks/useCanvasLoader.ts` | On-auth load, createProject, loadCanvasContent, isBackendProject |
| `hooks/useSavedProject.tsx` | Bridge to useCanvasStore + useAuthStore |
| `store/useCanvasStore.ts` | projects, activeProject, updateProject, persistence |
| `draw/page.tsx` | React Flow, onNodesChange, onNodeDragStop, onEdgesChange, load flow |
| `draw/components/AddNodes.tsx` | saveNodes, saveEdges, addNode helpers, getViewport for sync |
| `hooks/useViewport.tsx` | getCenter (viewport → screen center in canvas coords) |

---

## 8. Summary

| Topic | Current | Remaining |
|-------|---------|-----------|
| **Load** | Full canvas on project switch | Viewport-based load for large canvases |
| **Save** | Event-driven, debounced, change-filtered | — |
| **Viewport API** | Implemented, unused | Wire onViewportChange, fix node type mapping, define merge/unload strategy |

---

## See Also

- **CANVAS_SYNC_LOGIC.md** — Debouncing, change filtering, when saves happen
- **BACKEND_CANVAS_LOGIC.md** — Node types, storage, parent-child
- **CANVAS_API.md** — API contracts and viewport query params
