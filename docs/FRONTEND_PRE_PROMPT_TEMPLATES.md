# Frontend: Pre-Prompt Templates Implementation Guide

---

## Backend Prerequisites (Run Before Frontend Implementation)

**Backend developers:** After the Pre-Prompt Templates feature is implemented in the backend, run the following **before** the frontend team starts integration:

1. **Apply schema and generate client** — Sync the `pre_prompt_templates` table and regenerate the Prisma Client:
   ```bash
   cd base-backend
   npx prisma db push && npx prisma generate
   ```

2. **Seed default templates** — Insert the system templates (Technical Writer, Senior Software Engineer, Marketing Copywriter):
   ```bash
   npx prisma db seed
   ```
   Or: `npm run prisma:seed`

3. **Verify** — Ensure `GET /api/pre-prompts` returns the seeded templates when called with a valid JWT.

---

## Overview

Pre-Prompt Templates are reusable instruction blocks that define how the AI should behave. When the user sends a prompt, the selected template's prompt is prepended before the user's prompt.

---

## API Contract

**Authentication:** All endpoints require `Authorization: Bearer <accessToken>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pre-prompts` | Fetch system + current user's templates |
| POST | `/api/pre-prompts` | Create a new template |
| PATCH | `/api/pre-prompts/:id` | Edit a user-owned template |
| DELETE | `/api/pre-prompts/:id` | Delete a user-owned template |

### GET Response

```json
[
  { "id": "uuid", "name": "Technical Writer", "prompt": "You are an expert technical writer...", "type": "system" },
  { "id": "uuid", "name": "Senior Software Engineer", "prompt": "You are a senior software engineer...", "type": "system" },
  { "id": "uuid", "name": "My Custom", "prompt": "You are a professional data analyst...", "type": "user" }
]
```

### POST Request

```json
{
  "name": "Data Analyst",
  "prompt": "You are a professional data analyst. Provide insights using structured analysis.",
  "type": "system"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name (max 255 chars) |
| `prompt` | string | Yes | Instruction text |
| `type` | string | No | `"system"` \| `"user"` \| `"feature"` (default: `"system"`) |

### PATCH Request (Edit)

`PATCH /api/pre-prompts/:id`

```json
{
  "name": "Updated Name",
  "prompt": "Updated instruction text...",
  "type": "user"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Display name (max 255 chars) |
| `prompt` | string | No | Instruction text |
| `type` | string | No | `"system"` \| `"user"` \| `"feature"` |

All fields are optional; only provided fields are updated. Returns the updated template. **System templates** (seeded, `userId` null) cannot be edited — returns 403.

### DELETE Request

`DELETE /api/pre-prompts/:id`

Returns `{ "success": true }` on success. **System templates** cannot be deleted — returns 403.

---

## Implementation Steps

### Step 1: Add TypeScript Types

Create `base/src/types/prePrompts.ts` (or similar):

```ts
export interface PrePromptTemplate {
  id: string;
  name: string;
  prompt: string;
  type: 'system' | 'user' | 'feature';
}

export interface CreatePrePromptDto {
  name: string;
  prompt: string;
  type?: 'system' | 'user' | 'feature';
}

export interface UpdatePrePromptDto {
  name?: string;
  prompt?: string;
  type?: 'system' | 'user' | 'feature';
}
```

### Step 2: Create API Client

Add `base/src/lib/prePromptsApi.ts`:

```ts
import api from './api';
import type { PrePromptTemplate, CreatePrePromptDto, UpdatePrePromptDto } from '@/types/prePrompts';

export async function fetchPrePrompts(): Promise<PrePromptTemplate[]> {
  const { data } = await api.get<PrePromptTemplate[]>('/api/pre-prompts');
  return data;
}

export async function createPrePrompt(dto: CreatePrePromptDto): Promise<PrePromptTemplate> {
  const { data } = await api.post<PrePromptTemplate>('/api/pre-prompts', dto);
  return data;
}

export async function updatePrePrompt(id: string, dto: UpdatePrePromptDto): Promise<PrePromptTemplate> {
  const { data } = await api.patch<PrePromptTemplate>(`/api/pre-prompts/${id}`, dto);
  return data;
}

export async function deletePrePrompt(id: string): Promise<{ success: boolean }> {
  const { data } = await api.delete<{ success: boolean }>(`/api/pre-prompts/${id}`);
  return data;
}
```

Ensure `api` includes the auth token (axios interceptor or `Authorization` header).

### Step 3: Template Selector UI

Add a template selector (dropdown, list, or cards) where the user composes their prompt:

- **On mount:** Call `fetchPrePrompts()` and store in state (or React Query / SWR).
- **Display:** Show `name` for each template; optionally show `prompt` on hover.
- **Selection:** Store the selected template in component state.

```tsx
const [templates, setTemplates] = useState<PrePromptTemplate[]>([]);
const [selectedTemplate, setSelectedTemplate] = useState<PrePromptTemplate | null>(null);

useEffect(() => {
  fetchPrePrompts().then(setTemplates);
}, []);
```

### Step 4: Integrate with AI Request

When building the final prompt for the Gemini request:

```
FINAL_PROMPT = (selectedTemplate?.prompt ?? '') + '\n\n' + userPrompt
```

Example:

```ts
const fullPrompt = selectedTemplate?.prompt
  ? `${selectedTemplate.prompt}\n\n${userPrompt}`
  : userPrompt;
await CallGemini({ data: { ask: fullPrompt, ... }, config });
```

### Step 5: Create Template Flow (Optional)

- Add a form with `name` and `prompt` (and optionally `type`).
- On submit: `createPrePrompt({ name, prompt, type })`.
- Refresh the template list or append the new template to state.

---

## Default System Templates (Seeded)

| Name | Purpose |
|------|---------|
| Technical Writer | Clear explanations, structured formatting, bullet points |
| Senior Software Engineer | Production-ready code with comments |
| Marketing Copywriter | Persuasive SaaS marketing copy |

---

## Summary Checklist

| Task | File / Location |
|------|-----------------|
| Add `PrePromptTemplate`, `CreatePrePromptDto`, `UpdatePrePromptDto` types | `types/prePrompts.ts` |
| Add `fetchPrePrompts`, `createPrePrompt`, `updatePrePrompt`, `deletePrePrompt` API functions | `lib/prePromptsApi.ts` |
| Fetch templates on load | Template selector component |
| Render template selector (dropdown, list, cards) | Same component |
| Store selected template in state | Same component |
| Prepend template prompt to user prompt before AI call | `GeminiApi` / `loadingNode` |
| (Optional) Create template form | Settings or template management UI |

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User-created templates are private.
- **POST scope:** New templates are always linked to the authenticated user.
- **Empty selection:** If no template is selected, use only the user prompt (no prepended instruction).

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User A never sees User B's custom templates.
- **POST scope:** Creates templates linked to the authenticated user. `userId` is set automatically from the JWT.
- **Empty selection:** If no template is selected, use only the user prompt. No prepended text.

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User A never sees User B's custom templates.
- **POST scope:** New templates are always linked to the authenticated user.
- **Type casing:** API returns `type` in lowercase (`system`, `user`, `feature`).

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. Other users' templates are never returned.
- **POST scope:** New templates are always linked to the authenticated user via `userId`.
- **Type casing:** API returns `type` in lowercase (`system`, `user`, `feature`). Use as-is in the frontend.

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User-created templates are private.
- **POST scope:** Creates templates linked to the authenticated user. The `type` field affects categorization; all user-created templates have a `userId`.
- **Empty selection:** If no template is selected, use only the user prompt. Do not send an empty template prompt.

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. Other users' templates are never returned.
- **POST scope:** New templates are always linked to the authenticated user.
- **Empty selection:** If no template is selected, use only the user prompt (no prepended instruction).

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User-created templates are private.
- **POST scope:** Creates a template linked to the authenticated user. The `type` field affects categorization; all user-created templates are stored with the user's ID.
- **Empty selection:** If no template is selected, use only the user prompt. Do not send an empty string for the template portion.

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User A never sees User B's templates.
- **POST scope:** Creates a template linked to the authenticated user. `userId` is set automatically from the JWT.
- **Type casing:** API returns `type` in lowercase (`system`, `user`, `feature`). Use as-is in the frontend.

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User A never sees User B's custom templates.
- **POST scope:** New templates are stored with the authenticated user's `userId`.
- **Type casing:** API returns `type` in lowercase (`system`, `user`, `feature`).
ism
---

## Notes

- **Empty selection:** If no template is selected, use only the user prompt.
- **API errors:** Handle 401 (unauthorized) by redirecting to login; 400/422 for validation errors.
- **Caching:** Consider caching templates in React Query or SWR with a short stale time.
---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User-created templates are scoped per user.
- **POST scope:** Creates a template linked to the authenticated user. The `type` field affects categorization; all user-created templates have `userId` set.
- **Empty selection:** If no template is selected, use only the user prompt. No prepended text.

---

## Future Integration

The backend may later support layered prompts (`system_prompt`, `workspace_prompt`, `template_prompt`, `feature_prompt`, `user_prompt`). The frontend can be structured to pass `templatePrompt` as a separate field when the API supports it.

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User-created templates are private.
- **POST scope:** Creates a template linked to the authenticated user. The `type` field affects categorization, not visibility.
- **Empty selection:** If no template is selected, use only the user prompt. No prepended instruction.

---

## Notes

- **GET** returns only system templates (`userId` null) and the current user's templates. User-created templates are scoped per user.
- **POST** always associates the new template with the authenticated user.
- If no template is selected, use only the user prompt (no prepended instruction).

---

## Notes

- **GET** returns only system templates (`userId` null) and the current user's templates. User-created templates are scoped per user.
- **POST** stores the template with the authenticated user's `userId`.
- If no template is selected, use only the user prompt (no prepended instruction).

---

## Notes

- **GET scope:** Returns only system templates (`userId` null) and the current user's templates. User A never sees User B's custom templates.
- **POST scope:** New templates are always linked to the authenticated user.
- If no template is selected, use only the user prompt (no prepended instruction).
