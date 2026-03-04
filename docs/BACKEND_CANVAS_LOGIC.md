# Backend Canvas Logic — Node Types, Storage & Data Flow

Documentation of how the backend manages node types, node data, parent-child relationships, edges, and storage.

---

## 1. Data Model Overview

```
User
  └── Canvas (1:N)
        ├── Node (1:N)     — nodes on the canvas
        ├── Edge (1:N)     — connections between nodes
        ├── CanvasSnapshot
        └── AIConversation

Node (self-referential for hierarchy)
  ├── parent   → Node?
  └── children → Node[]

Edge
  ├── sourceNode → Node
  └── targetNode → Node
```

---

## 2. Node Type System

### 2.1 Frontend → Backend Type Mapping

The frontend sends node `type` as a string (React Flow component name). The backend maps it to the Prisma `NodeType` enum:

| Frontend Type   | Backend NodeType | Notes                                           |
|-----------------|------------------|-------------------------------------------------|
| `QuestionNode`  | `QUESTION`       | User prompt input                               |
| `ResponseNode`  | `RESPONSE`       | AI response display                             |
| `LoadingNode`   | `RESPONSE`       | Loading state; persisted as RESPONSE when synced |
| `ImageNode`     | `IMAGE`          | Image content                                   |
| `CommentNode`   | `COMMENT`        | Comment/annotation                              |
| `NotesNode`     | `NOTES`          | Rich text notes                                 |
| `YoutubeNode`   | `EMBED`          | YouTube embed                                   |
| *(unknown)*     | `TEXT`           | Fallback                                        |

**Backend mapping** (`canvases.service.ts`):

```ts
const NODE_TYPE_MAP: Record<string, NodeType> = {
  QuestionNode: NodeType.QUESTION,
  ResponseNode: NodeType.RESPONSE,
  LoadingNode: NodeType.RESPONSE,
  ImageNode: NodeType.IMAGE,
  CommentNode: NodeType.COMMENT,
  NotesNode: NodeType.NOTES,
  YoutubeNode: NodeType.EMBED,
  default: NodeType.TEXT,
};
```

**Frontend reverse mapping** (`canvasApi.ts`):

```ts
const NODE_TYPE_TO_FRONTEND = {
  QUESTION: 'QuestionNode',
  RESPONSE: 'ResponseNode',
  IMAGE: 'ImageNode',
  COMMENT: 'CommentNode',
  NOTES: 'NotesNode',
  EMBED: 'YoutubeNode',
  VIDEO: 'YoutubeNode',
  TEXT: 'NotesNode',
  default: 'ResponseNode',
};
```

---

## 3. Node Storage Structure

### 3.1 Node Table (Prisma)

| Column       | Type     | Purpose                                              |
|--------------|----------|------------------------------------------------------|
| `id`         | UUID     | Internal DB primary key                              |
| `clientId`   | String?  | Frontend ID (e.g. timestamp) — used for sync/upsert   |
| `canvasId`   | String   | FK to Canvas                                         |
| `x`, `y`     | Float    | Position                                             |
| `width`, `height` | Float | Size (default 360×240)                          |
| `zIndex`     | Int      | Stacking order (default 0)                            |
| `nodeType`   | NodeType | QUESTION, RESPONSE, IMAGE, etc.                       |
| `role`       | NodeRole | INPUT, OUTPUT, GROUP (all synced as INPUT)            |
| `content`    | Json     | Type-specific data (question, prompt, aiResponse...) |
| `metadata`   | Json     | Extra metadata                                       |
| `style`      | Json     | Styling                                              |
| `bboxMinX/Y`, `bboxMaxX/Y` | Float? | Bounding box for spatial queries        |
| `tileIds`    | Int[]    | Tile IDs for viewport queries                         |
| `parentNodeId` | String? | FK for parent in node tree (currently unused in sync) |
| `title`      | String?  | Optional title                                       |
| `isLocked`, `isCollapsed` | Boolean | UI state                                 |

**Unique constraint:** `(canvasId, clientId)` — used for idempotent upsert during sync.

---

### 3.2 Content JSON by Node Type

`content` stores all type-specific data as JSON. Structure varies by `nodeType`:

| NodeType  | Content Fields (typical)                     | Example                                   |
|-----------|-----------------------------------------------|-------------------------------------------|
| QUESTION  | `question`, `prompt`, `model`, `responseLength` | `{ question: "How does X work?", model: "gemini-2.5-flash" }` |
| RESPONSE  | `prompt`, `ask`, `config`, `type`, `aiResponse` | `{ ask: "Explain...", aiResponse: "..." }` |
| IMAGE     | `src`                                         | `{ src: "https://..." }`                  |
| COMMENT   | `value`                                       | `{ value: "Nice idea!" }`                 |
| NOTES     | `content`                                     | `{ content: "<p>Rich text...</p>" }`      |
| EMBED     | `url`, `model`, `responseLength`              | `{ url: "https://youtube.com/embed/..." }` |

The sync accepts arbitrary `data`; the backend stores it as-is in `content`. No strict schema — flexibility for different node kinds.

---

## 4. Parent-Child (Node Tree)

### 4.1 Schema Support

```prisma
model Node {
  parentNodeId String?
  parent      Node?   @relation("NodeTree", fields: [parentNodeId], references: [id], onDelete: SetNull)
  children    Node[]  @relation("NodeTree")
  // ...
}
```

- `parentNodeId`: optional FK to another node.
- `onDelete: SetNull`: if parent is deleted, child’s `parentNodeId` becomes null.
- Index: `@@index([parentNodeId])` for queries.

### 4.2 Current Usage

Sync does **not** send or update `parentNodeId`. All synced nodes are treated as root-level (`parentNodeId = null`).

This is for possible future features (e.g. grouped/nested nodes). Today:

- Nodes are flat on the canvas.
- Connectivity is expressed via **edges** (source → target), not hierarchy.

---

## 5. Edges (Connections)

### 5.1 Edge Model

| Column        | Type   | Purpose                                           |
|---------------|--------|---------------------------------------------------|
| `id`          | UUID   | Primary key                                      |
| `canvasId`    | String | FK to Canvas                                     |
| `sourceNodeId`| String | FK to Node (source)                              |
| `targetNodeId`| String | FK to Node (target)                              |
| `edgeType`    | EdgeType | MANUAL, GENERATED, REFERENCE, PARENT_CHILD    |
| `metadata`    | Json   | Optional edge metadata                           |

**Unique constraint:** `(canvasId, sourceNodeId, targetNodeId, edgeType)` — one edge per (source, target, type) in a canvas.

### 5.2 Sync Behavior

- Frontend sends edges with `source` and `target` as **clientIds**.
- Backend maps clientIds → internal UUIDs.
- Edges are **replaced** each sync: all canvas edges deleted, then recreated from payload.
- Only edges whose both endpoints exist in the payload are stored.

```ts
// Backend: map clientId → DB id
const clientIdToNodeId = new Map(/* ... */);
const validEdges = edges.filter(
  (e) => clientIdToNodeId.has(e.source) && clientIdToNodeId.has(e.target)
);
```

---

## 6. ID Strategy: clientId vs id

| ID        | Where    | Format      | Role                                      |
|-----------|----------|-------------|-------------------------------------------|
| `clientId`| Frontend | e.g. `"1709123456789"` (timestamp) | Stable ID for sync, used in edges |
| `id`      | Backend  | UUID        | Primary key in DB, internal references   |

- Frontend keeps using `clientId` for nodes and edges.
- Backend keeps `id` (UUID) and `clientId` in sync.
- Upsert key: `(canvasId, clientId)`.
- API responses can map back to clientIds via `nodeIdMap` and edge `source`/`target` using clientIds.

---

## 7. Sync Flow (Step-by-Step)

```
1. ensureCanvasOwnership(userId, canvasId)
   └── 404 if user doesn't own canvas

2. Load existing nodes (id, clientId)

3. Diff
   └── Nodes in DB but not in payload → mark for delete
   └── Delete their edges first, then nodes

4. Build clientId → DB id map from existing nodes

5. For each node in payload:
   a. Compute bbox (bboxMinX/Y, bboxMaxX/Y)
   b. Compute tileIds from bbox
   c. Map type → NodeType
   d. Upsert by (canvasId, clientId):
      - content = node.data (entire JSON)
      - role = INPUT
      - parentNodeId = not set (stays null)

6. Delete all edges for canvas

7. Create edges from payload (only where source & target exist)

8. Update canvas:
   - nodeCount, edgeCount
   - boundsMin/Max (from all node bboxes)
   - viewportX, viewportY, viewportZoom

9. Return { nodeCount, edgeCount, nodeIdMap, edges }
```

---

## 8. Bounding Box & Tiles

- **Bbox:** `bboxMinX = x`, `bboxMinY = y`, `bboxMaxX = x + width`, `bboxMaxY = y + height`
- **Tiles:** 512×512 grid; `tileId = tileY * 10000 + tileX`
- Stored for spatial/viewport queries (see `CANVAS_SYNC_LOGIC.md`).

---

## 9. Other Models (Related)

| Model            | Relation to Canvas           | Purpose                        |
|------------------|------------------------------|--------------------------------|
| AIConversation   | canvasId, nodeId             | AI request/response per node   |
| CanvasSnapshot   | canvasId                     | Versioned canvas snapshots     |
| Edge             | canvasId, sourceNodeId, targetNodeId | Connections between nodes |

---

## 10. Summary

| Aspect          | Behavior                                                   |
|-----------------|------------------------------------------------------------|
| **Node types**  | Mapped from frontend strings to `NodeType` enum             |
| **Node data**   | Stored in `content` JSON; structure varies by type         |
| **Parent-child**| Schema exists; sync does not use it; nodes are flat         |
| **Edges**       | Replaced each sync; source/target by clientId              |
| **IDs**         | `clientId` from frontend; `id` UUID in DB; upsert by clientId |
| **Sync**        | Atomic; full replace of edges; upsert nodes by clientId    |
| **Content**     | Flexible JSON; no strict validation per type               |
