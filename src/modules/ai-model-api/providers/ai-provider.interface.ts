/** The parsed content from a file before sending to an AI provider */
export interface ParsedFileContent {
  /** Plain text extracted from the file */
  text?: string;
  /** Raw buffer (used for image multimodal providers) */
  buffer?: Buffer;
  /** MIME type of the original file */
  mimeType: string;
  /** Original filename */
  filename: string;
  /** File type label */
  fileType: 'PDF' | 'CSV' | 'IMAGE' | 'OTHER';
  /** Extra metadata (page count, row count, etc.) */
  meta?: Record<string, unknown>;
}

/** Options that callers can pass when requesting a summary */
export interface SummarizeOptions {
  /** Custom instruction appended to the summarization prompt */
  customPrompt?: string;
  /** Max length hint: 'short' | 'medium' | 'long' */
  responseLength?: 'short' | 'medium' | 'long';
  /** AI model override (provider-specific model name) */
  model?: string;
}

/** Result returned by any summarize provider */
export interface SummarizeResult {
  summary: string;
  provider: string;
  model: string;
}

/** Every AI provider (Gemini, OpenAI, Claude …) must implement this interface */
export interface ISummarizeProvider {
  /** Unique name used to look up the provider: 'gemini' | 'openai' | 'claude' */
  readonly name: string;
  /** False when the required API key / credentials are missing */
  readonly isConfigured: boolean;
  summarize(content: ParsedFileContent, options?: SummarizeOptions): Promise<SummarizeResult>;
}
