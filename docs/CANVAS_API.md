# Canvas API - Sync & Viewport

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/canvases` | Create canvas |
| GET | `/canvases` | List all canvases (includes nodeCount, edgeCount, bounds) |
| GET | `/canvases/:id` | Get full canvas with nodes and edges |
| GET | `/canvases/:id/nodes?minX=&minY=&maxX=&maxY=` | Fetch nodes in viewport (spatial query) |
| GET | `/canvases/:id/nodes?tileIds=1,2,3` | Fetch nodes by tile IDs |
| PUT | `/canvases/:id/sync` | Bulk sync nodes + edges (atomic upsert) |
| PATCH | `/canvases/:id/rename` | Rename canvas |
| DELETE | `/canvases/:id` | Delete canvas |

## Sync Payload (PUT /canvases/:id/sync)

```json
{
  "nodes": [
    {
      "id": "1709123456789",
      "x": 100,
      "y": 200,
      "width": 360,
      "height": 240,
      "type": "QuestionNode",
      "data": { "value": "how can i help?" }
    }
  ],
  "edges": [
    { "source": "1709123456789", "target": "1709123456790" }
  ],
  "viewportX": 0,
  "viewportY": 0,
  "viewportZoom": 1
}
```

## Response

```json
{
  "nodeCount": 2,
  "edgeCount": 1,
  "nodeIdMap": { "1709123456789": "uuid-1", "1709123456790": "uuid-2" },
  "edges": [{ "id": "edge-uuid", "source": "1709123456789", "target": "1709123456790" }]
}
```

## Schema Migration

After pulling schema changes, run:

```bash
npx prisma db push
# or, if you have drift: npx prisma db push --accept-data-loss
```

Then regenerate: `npx prisma generate`
