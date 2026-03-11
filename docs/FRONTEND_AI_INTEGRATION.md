# Frontend AI Integration Guide

## Endpoint

```
POST /ai/gemini/generate
Authorization: Bearer <accessToken>
Content-Type: application/json
```

---

## TypeScript Types

```ts
interface AiRequest {
  data: {
    ask: string;
    prompt?: string;           // optional reference context
    history?: { role: 'user' | 'model'; text: string }[];
  };
  config?: {
    model?: string;
    responseLength?: 'short' | 'medium' | 'long';
    isSearch?: boolean;        // ← enable real-time web grounding
  };
}

interface AiSource {
  title: string;
  url: string;
}

interface AiResponse {
  success: boolean;
  text: string;                // markdown string
  sources?: AiSource[];        // only present when isSearch: true
}
```

---

## API Call

```ts
async function askAI(ask: string, isSearch = false, model?: string): Promise<AiResponse> {
  const res = await fetch('/ai/gemini/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      data: { ask },
      config: { isSearch, model }, // model is optional; used for both search and non-search
    }),
  });
  return res.json();
}
```

---

## Rendering the Response

### 1. Install `react-markdown`

```bash
npm install react-markdown
```

### 2. Component

```tsx
import ReactMarkdown from 'react-markdown';

function AiResult({ response }: { response: AiResponse }) {
  if (!response.success) return <p>Error: {response.text}</p>;

  return (
    <div>
      {/* Markdown Answer */}
      <div className="prose">
        <ReactMarkdown>{response.text}</ReactMarkdown>
      </div>

      {/* Sources — only shown when isSearch was true */}
      {response.sources && response.sources.length > 0 && (
        <div className="sources">
          <span>📡 Sources</span>
          {response.sources.map((src, i) => {
            const domain = new URL(src.url).hostname.replace('www.', '');
            return (
              <a key={i} href={src.url} target="_blank" rel="noreferrer">
                <img
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                  alt=""
                />
                {src.title || domain}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

### 3. Minimal Source Styles

```css
.sources {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 13px;
}

.sources a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  text-decoration: none;
  color: inherit;
}

.sources a:hover {
  background: #f1f5f9;
}
```

---

## Usage Examples

```ts
// Regular AI chat (usually uses gemini-2.0-flash-lite)
const reply = await askAI('Explain how React hooks work');

// Real-time search with custom model
const reply = await askAI('What is Bitcoin price today?', true, 'gemini-3-pro-preview');
// request config will be { isSearch: true, model: 'gemini-3-pro-preview' }
// reply.sources → [{ title: 'CoinMarketCap', url: '...' }, ...]
```

> [!TIP]
> **Dynamic Model Support:**
> - When `isSearch` is **off**, the backend defaults to `gemini-2.0-flash-lite`.
> - When `isSearch` is **on**, the backend defaults to `gemini-3.1-pro-preview` (if no model is provided).
> - You can override the model at any time by passing `config: { model: '...' }`. Just ensure the selected model supports Google Search Grounding if `isSearch` is true.
