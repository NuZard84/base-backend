export interface NormalizedTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Normalizes raw token usage metadata from any AI provider into a consistent shape.
 * Returns null if no usage data is present or all counts are zero.
 *
 * Provider field mappings:
 *   Gemini:  usageMetadata.promptTokenCount / candidatesTokenCount / totalTokenCount
 *   OpenAI:  usage.prompt_tokens / completion_tokens / total_tokens
 *   Claude:  usage.input_tokens / output_tokens  (no total field — must compute)
 */
export function normalizeTokenUsage(
  provider: 'gemini' | 'openai' | 'claude',
  rawUsage: Record<string, any> | null | undefined,
): NormalizedTokenUsage | null {
  if (!rawUsage) return null;

  switch (provider) {
    case 'gemini': {
      const p = rawUsage.promptTokenCount ?? 0;
      const c = rawUsage.candidatesTokenCount ?? 0;
      const t = rawUsage.totalTokenCount ?? (p + c);
      return t === 0 ? null : { promptTokens: p, completionTokens: c, totalTokens: t };
    }
    case 'openai': {
      const p = rawUsage.prompt_tokens ?? 0;
      const c = rawUsage.completion_tokens ?? 0;
      const t = rawUsage.total_tokens ?? (p + c);
      return t === 0 ? null : { promptTokens: p, completionTokens: c, totalTokens: t };
    }
    case 'claude': {
      // Claude does not provide a total field — must compute from input + output
      const p = rawUsage.input_tokens ?? 0;
      const c = rawUsage.output_tokens ?? 0;
      const t = p + c;
      return t === 0 ? null : { promptTokens: p, completionTokens: c, totalTokens: t };
    }
    default:
      return null;
  }
}
