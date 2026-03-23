# Attachments API (Frontend Guide)

**Base path:** `GET/POST/DELETE /attachments`  
**Auth:** Bearer JWT required on all endpoints.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/attachments/upload` | Upload file (multipart/form-data) |
| `GET`  | `/attachments` | List attachments |
| `GET`  | `/attachments/:id` | Get one attachment |
| `DELETE` | `/attachments/:id` | Delete attachment |

---

## Upload

**`POST /attachments/upload`**

- **Content-Type:** `multipart/form-data`
- **Form fields:**
  - `file` (required) — the file
  - `entityType` (optional) — e.g. `canvas`
  - `entityId` (optional) — e.g. canvas UUID

**Allowed types:** images (jpeg, png, gif, webp, svg), PDF, CSV  
**Max size:** 25 MB

---

## Response shape

```ts
{
  id: string;
  userId: string;
  key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  type: "IMAGE" | "PDF" | "CSV" | "OTHER";
  entityType: string | null;
  entityId: string | null;
  createdAt: string;  // ISO
  downloadUrl: string;   // presigned, use for "Download" button
  previewUrl?: string;  // presigned inline — IMAGE, PDF, CSV only
}
```

- **`downloadUrl`** — `Content-Disposition: attachment`, for download/save.
- **`previewUrl`** — `Content-Disposition: inline`, for display:
  - **Images:** `<img src={previewUrl} />`
  - **PDF:** `<iframe src={previewUrl} />` or open in new tab
  - **CSV:** open in tab or embed
- URLs expire in **1 hour**; refetch to get new ones.

---

## List (filter by entity)

**`GET /attachments?entityType=canvas&entityId=<uuid>`**

Query params are optional. Use them to filter by linked canvas/node.

---

## Errors

| Status | Meaning |
|--------|---------|
| `400` | Invalid file type or size |
| `401` | Not authenticated |
| `403` | Not your attachment |
| `404` | Attachment not found |
