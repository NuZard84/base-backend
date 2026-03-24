export const QUEUES = {
  DOCUMENT_PROCESS: 'document-process',
  DOCUMENT_CHUNK: 'document-chunk',
  DOCUMENT_EMBED: 'document-embed',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DOCUMENT_EVENTS = {
  PROCESSING_STARTED: 'document:processing_started',
  CHUNKED: 'document:chunked',
  READY: 'document:ready',
  FAILED: 'document:failed',
} as const;

/** Typed job data flowing through each queue */
export interface DocumentJobData {
  documentId: string;
}
