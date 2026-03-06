# Frontend: Gemini Context Implementation Guide

This document describes how to implement **multi-turn context** support in the frontend so that the AI has access to prior questions and responses in the conversation chain.

The backend API already supports an optional `history` parameter. The frontend must build this history from the canvas graph and pass it when calling the Gemini API.

---

## 1. API Contract

### Endpoint

```
POST /ai/gemini/generate
```

### Request Body (updated)

```json
{
  "data": {
    "prompt": "Optional reference text (e.g. selected text from parent response)",
    "ask": "The current question (required)",
    "type": "Optional query type, e.g. 'vid_summarize'",
    "history": [
      { "role": "user", "text": "What is a bit?" },
      { "role": "model", "text": "A bit is the smallest unit of data..." },
      { "role": "user", "text": "Can you explain that in simpler terms?" }
    ]
  },
  "config": {
    "model": "gemini-2.0-flash-lite",
    "responseLength": "medium"
  }
}
```

### `history` Format

- **Optional.** If omitted, the API behaves as before (single turn).
- **Array of objects** with `role` (`"user"` | `"model"`) and `text` (string).
- **Order:** Chronological (oldest first). Must alternate `user` → `model` → `user` → ...
- **Last item** before the current request should be a `model` message (the most recent AI response).

---

## 2. Graph Structure (Canvas)

The canvas uses the following flow:

- **QuestionNode** → **LoadingNode** → (becomes **ResponseNode** when done)
- **Nested "Ask" flow:** User selects text in ResponseNode → new **QuestionNode** (with `prompt` = selected text) → **LoadingNode**

Edges:

- `QuestionNode` (source) → `LoadingNode` (target)
- `ResponseNode` (source) → `QuestionNode` (target) — when user asks a follow-up from selected text

---

## 3. Implementation Steps

### Step 1: Create `getConversationContext` utility

Add a new file, e.g. `base/src/lib/getConversationContext.ts`:

```ts
import type { Node, Edge } from '@xyflow/react';

export interface HistoryMessage {
  role: 'user' | 'model';
  text: string;
}

/**
 * Builds conversation history by traversing backwards from the current LoadingNode
 * through the canvas graph (Question -> Response -> Question -> ...).
 */
export function getConversationContext(
  currentNodeId: string,
  nodes: Node[],
  edges: Edge[]
): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  const visited = new Set<string>();
  let currentId: string | null = edges.find((e) => e.target === currentNodeId)?.source ?? null;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.find((n) => n.id === currentId);
    if (!node) break;

    if (node.type === 'QuestionNode') {
      if (node.data?.prompt) {
        // This question came from a ResponseNode (user selected text). Traverse back.
        const respEdge = edges.find((e) => e.target === currentId);
        if (!respEdge) break;
        const respNode = nodes.find((n) => n.id === respEdge.source);
        if (!respNode?.data?.aiResponse) break;
        const qEdge = edges.find((e) => e.target === respEdge.source);
        if (!qEdge) break;
        const qNode = nodes.find((n) => n.id === qEdge.source);
        if (!qNode?.data?.question) break;

        history.unshift({ role: 'model', text: respNode.data.aiResponse });
        history.unshift({ role: 'user', text: qNode.data.question });
        currentId = qEdge.source;
      } else {
        // Root question — no more history
        break;
      }
    } else {
      break;
    }
  }

  return history;
}
```

### Step 2: Update `GeminiApi.tsx`

Extend the `data` type to include `history`:

```ts
// base/src/app/Gemini/GeminiApi.tsx

import api from "@/lib/api";

interface HistoryMessage {
  role: 'user' | 'model';
  text: string;
}

const CallGemini = async ({
  data,
  config
}: {
  data: {
    prompt?: string;
    ask: string;
    type?: string;
    history?: HistoryMessage[];
  };
  config?: { model?: string; responseLength?: string };
}) => {
  try {
    const response = await api.post('/ai/gemini/generate', { data, config });
    return response.data;
  } catch (error) {
    console.error("Error calling Gemini backend:", error);
    throw error;
  }
};

export default CallGemini;
```

### Step 3: Update `loadingNode.tsx`

1. Import `getConversationContext` and use `getNodes` / `getEdges` from `useReactFlow`.
2. Before calling `CallGemini`, compute history and pass it in `data`:

```ts
// In loadingNode.tsx, inside the component:
const { getNodes, getEdges, updateNodeData } = useReactFlow();

// Inside fetchContent, before CallGemini:
const nodes = getNodes();
const edges = getEdges();
const history = getConversationContext(id, nodes, edges);

const response = await CallGemini({
  data: {
    prompt: data.prompt,
    ask,
    type: data.type,
    history: history.length > 0 ? history : undefined,
  },
  config: data.config,
});
```

### Full `fetchContent` snippet (loadingNode.tsx)

```ts
const fetchContent = async () => {
  if (hasFetched.current) return;
  if (!data.aiResponse) {
    if (!ask) return;
    try {
      hasFetched.current = true;
      setLoading(true);

      const nodes = getNodes();
      const edges = getEdges();
      const history = getConversationContext(id, nodes, edges);

      const response = await CallGemini({
        data: {
          prompt: data.prompt,
          ask,
          type: data.type,
          history: history.length > 0 ? history : undefined,
        },
        config: data.config,
      }).then((res) => res).catch((error) => {
        hasFetched.current = false;
        console.error("Gemini API Error:", error);
        return error;
      });

      const _text = `${response.text}`;
      setHtmlContent(md.render(_text));
      updateNodeData(id, { aiResponse: _text });
      setLoading(false);
    } catch (error) {
      hasFetched.current = false;
      console.error("Gemini API Error:", error);
      setHtmlContent(md.render("**Error generating content.**"));
      setLoading(false);
    }
  } else if (data.aiResponse) {
    setHtmlContent(md.render(data.aiResponse));
    setLoading(false);
  }
};
```

---

## 4. Summary Checklist

| File | Change |
|------|--------|
| `base/src/lib/getConversationContext.ts` | **Create** – utility to build history from graph |
| `base/src/app/Gemini/GeminiApi.tsx` | Add `history?: HistoryMessage[]` to `data` type |
| `base/src/app/draw/Nodes/loadingNode.tsx` | Use `getNodes`, `getEdges`, call `getConversationContext`, pass `history` to `CallGemini` |

---

## 5. Behavior

- **Root question:** No `prompt`, no incoming chain → `history` is empty → same behavior as before.
- **Follow-up question:** User selects text in ResponseNode and asks → new QuestionNode has `prompt` → `getConversationContext` walks back and collects prior Q&A pairs → AI receives full context.

---

## 6. Edge Cases

- **Video/Image summarization** (`type: 'vid_summarize'`): History may still be useful for follow-up questions; include it if the chain exists.
- **Stale data:** `getNodes()` / `getEdges()` reflect current React Flow state. Ensure the canvas is synced before the user triggers a request.
- **HTML in aiResponse:** The backend and model receive raw text. If `aiResponse` is stored as HTML (from highlight), consider stripping tags or using a text-only representation for history.
