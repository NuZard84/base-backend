# Canvas Sync Logic — Full System Documentation

End-to-end documentation of the canvas sync system: bounding box indexing, tile-based spatial queries, frontend debouncing, and when API calls occur.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js + React Flow)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  User Actions ──► React Flow Events ──► Change Filter ──► Debounce ──► saveNodes │
│       │                    │                  │              │           │    │
│       │                    │                  │              │           ▼    │
│       └── Input typing ────► Local state only (NO updateNodeData)               │
│       └── Submit/Add ──────► updateNodeData + saveNodes (API call)             │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ PUT /canvases/:id/sync
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (NestJS + Prisma)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Sync API ──► Compute bbox/tileIds per node ──► Upsert nodes ──► Store        │
│  Viewport API ──► Bbox overlap or tileIds ──► Return nodes in viewport        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Logic

### 2.1 Bounding Box (Bbox) Indexing

Each node has a rectangular bounding box derived from position and size:

```
bboxMinX = x
bboxMinY = y
bboxMaxX = x + width
bboxMaxY = y + height
```

**Schema (Node model):**
- `bboxMinX`, `bboxMinY`, `bboxMaxX`, `bboxMaxY` — stored for spatial queries
- Index: `@@index([canvasId, bboxMinX, bboxMaxX, bboxMinY, bboxMaxY])`

---

### 2.2 Tile Indexing (Figma-Style Grid)

Canvas space is divided into a grid of **512×512 px tiles**. Each node computes which tiles it intersects.

**Tile ID formula:** `tileId = tileY * 10000 + tileX`

```
tileX = floor(x / 512)
tileY = floor(y / 512)
```

**Example:** Node at (600, 1200) with size 360×240:
- bbox: (600, 1200) → (960, 1440)
- Tiles: X=1,2 and Y=2,3 → IDs: [20001, 20002, 30001, 30002]

**Why tiles?**
- Fast viewport queries: send visible tile IDs instead of full bbox
- Scales better for large canvases
- Simple integer array lookup: `tileIds: { hasSome: tileIds }`

---

### 2.3 Sync Flow (`PUT /canvases/:id/sync`)

1. **Ownership check** — Ensure user owns the canvas  
2. **Diff vs existing nodes** — Nodes in DB but not in payload → delete (and their edges)  
3. **Per-node processing:**
   - Compute `bboxMinX/Y, bboxMaxX/Y` from x, y, width, height
   - Compute `tileIds` from bbox
   - Map frontend type (e.g. `QuestionNode`) → backend enum (`QUESTION`)
   - Upsert node on `(canvasId, clientId)`
4. **Edges** — Delete all, recreate from payload (only edges between existing nodes)  
5. **Canvas metadata** — Update `nodeCount`, `edgeCount`, `boundsMin/Max`, `viewportX/Y/Zoom`  
6. **Transaction** — Entire sync runs in one DB transaction (≈30s timeout)

---

### 2.4 Viewport Query (`GET /canvases/:id/nodes`)

Two query modes:

| Mode    | Params           | Logic                                                                 |
|---------|------------------|-----------------------------------------------------------------------|
| **Tiles** | `tileIds=1,2,3` | `tileIds: { hasSome: tileIds }` — nodes in those tiles                |
| **Bbox**  | `minX,minY,maxX,maxY` | Overlap: `bboxMinX < maxX AND bboxMaxX > minX AND bboxMinY < maxY AND bboxMaxY > minY` |

Both use indexed fields for efficient lookups.

---

## 3. Frontend Logic

### 3.1 No Polling — Event-Driven Only

There is **no** `setInterval` or polling. Sync is only triggered by explicit user actions or React Flow events.

---

### 3.2 When API Calls Happen (Save to Backend)

| Trigger               | Saves? | Notes                                       |
|-----------------------|--------|---------------------------------------------|
| **Node drag stop**    | Yes    | After 250ms (after collision resolution)    |
| **Add node**          | Yes    | Debounced 200ms                             |
| **Remove node**       | Yes    | Debounced 200ms                             |
| **Connect edge**      | Yes    | Debounced 200ms                             |
| **Edge change**      | Yes    | Debounced 200ms                             |
| **Submit (QuestionNode, YoutubeNode)** | Yes | Immediate                                |
| **Add (CommentNode)** | Yes    | Immediate                                  |
| **Typing in input**   | No     | Local state only                            |
| **Node select**       | No     | No persisted state                          |
| **Pan/zoom**          | No     | Viewport sent with next save, not as a trigger |

---

### 3.3 Change Filtering (`onNodesChange`)

React Flow emits many change types. We **skip** saves for:

| Change Type  | Why Skip                                                |
|--------------|---------------------------------------------------------|
| `position`   | Dragging — sync handled in `onNodeDragStop`            |
| `select`    | Selection is UI-only, not persisted                     |
| `dimensions` | Fired when content/typing changes node size — avoid API on typing |

**Only sync for:** `add`, `remove`, `replace` (or other structural changes).

```ts
// page.tsx
const isPositionOnly = changes.every(c => c.type === "position");
const isSelectOnly = changes.every(c => c.type === "select");
const isDimensionsOnly = changes.every(c => c.type === "dimensions");
if (!isPositionOnly && !isSelectOnly && !isDimensionsOnly) {
  debouncingSaveNode();
}
```

---

### 3.4 Debouncing

**`useDebounceCallback`:** Resets a timeout on each call; invokes the callback only after `delay` ms of no new calls.

- `debouncingSaveNode`: 200ms
- `debouncingSaveEdge`: 200ms

**Node drag:** No debounce — one save 250ms after drag stop (after collision resolution at 200ms).

---

### 3.5 Input Fields — No `updateNodeData` While Typing

**QuestionNode, CommentNode, YoutubeNode:**

- **While typing:** Update only local state (`setNodeData`, `setValue`, `setData`)
- **On Submit/Add:** Call `updateNodeData` to sync to React Flow, then `saveNodes`

Avoids `updateNodeData` during typing, which would trigger React Flow events (e.g. `dimensions`) and unwanted API calls.

---

### 3.6 Save Flow (`saveNodes` / `saveEdges`)

1. `getNodes()`, `getEdges()` from React Flow
2. `updateProject()` — update local project store
3. If authenticated and backend project → `saveToBackend(canvasId, nodes, edges, viewport)`
4. Backend: `buildSyncPayload` → `PUT /canvases/:id/sync`

---

## 4. Data Flow Summary

```
┌──────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  React Flow      │     │  useAddNode         │     │  Backend API    │
│  (nodes, edges)  │────►│  saveNodes()        │────►│  /sync          │
└──────────────────┘     │  - getNodes/Edges   │     └────────┬────────┘
        ▲                │  - updateProject    │              │
        │                │  - saveToBackend   │              ▼
        │                └─────────────────────┘     ┌─────────────────┐
        │                          ▲                 │  Prisma         │
        │                          │                 │  - bbox/tileIds │
  onNodesChange          debouncingSaveNode          │  - upsert      │
  onNodeDragStop         saveNodes (immediate)       │  - transaction  │
  onEdgesChange          debouncingSaveEdge          └─────────────────┘
  onSubmit (nodes)
```

---

## 5. Key Files

| Layer   | File                         | Responsibility                                  |
|---------|------------------------------|-------------------------------------------------|
| Backend | `canvases.service.ts`       | Sync, bbox, tiles, viewport query               |
| Backend | `schema.prisma`             | Node (bbox, tileIds), Canvas, Edge               |
| Frontend| `page.tsx`                  | onNodesChange, onNodeDragStop, change filter    |
| Frontend| `AddNodes.tsx`              | saveNodes, saveEdges, buildSyncPayload usage    |
| Frontend| `canvasApi.ts`             | buildSyncPayload, syncCanvas, fetchNodesInViewport |
| Frontend| `useDebounceCallback.ts`   | Generic debounce hook                           |
| Frontend| `QuestionNode.tsx` etc.     | Local state while typing, save only on Submit   |

---

## 6. Robustness Summary

| Concern                  | Approach                                                  |
|--------------------------|-----------------------------------------------------------|
| Avoid saves while typing | No `updateNodeData` during typing; skip `dimensions`      |
| Avoid saves while dragging | Skip `position`; single save on drag stop               |
| Avoid noisy selection saves | Skip `select`                                            |
| Batched structural changes | 200ms debounce for add/remove/edge                       |
| Collision vs. save order  | Drag stop → 200ms collision → 250ms save                 |
| Large canvases           | Bbox + tile indexing for spatial queries                 |
| Sync consistency         | Single transaction for full sync                         |
| ID stability             | `clientId` (frontend) vs `id` (DB UUID) for idempotency   |
