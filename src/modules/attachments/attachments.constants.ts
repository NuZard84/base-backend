/** Attachment type (matches Prisma schema enum) */
export type AttachmentType = 'IMAGE' | 'PDF' | 'CSV' | 'OTHER';

/** Allowed MIME types mapped to attachment type and max size (bytes) */
export const ALLOWED_TYPES: Record<string, { type: AttachmentType; maxSize: number }> = {
    // Images
    'image/jpeg': { type: 'IMAGE', maxSize: 10 * 1024 * 1024 },      // 10 MB
    'image/png': { type: 'IMAGE', maxSize: 10 * 1024 * 1024 },
    'image/gif': { type: 'IMAGE', maxSize: 10 * 1024 * 1024 },
    'image/webp': { type: 'IMAGE', maxSize: 10 * 1024 * 1024 },
    'image/svg+xml': { type: 'IMAGE', maxSize: 2 * 1024 * 1024 },    // 2 MB

    // PDF
    'application/pdf': { type: 'PDF', maxSize: 25 * 1024 * 1024 },   // 25 MB

    // CSV / spreadsheets
    'text/csv': { type: 'CSV', maxSize: 10 * 1024 * 1024 },
    'application/csv': { type: 'CSV', maxSize: 10 * 1024 * 1024 },
    'text/plain': { type: 'CSV', maxSize: 5 * 1024 * 1024 },        // .csv often sent as text/plain
};

/** File extensions mapped to attachment type for fallback */
export const EXTENSION_TO_TYPE: Record<string, AttachmentType> = {
    jpg: 'IMAGE',
    jpeg: 'IMAGE',
    png: 'IMAGE',
    gif: 'IMAGE',
    webp: 'IMAGE',
    svg: 'IMAGE',
    pdf: 'PDF',
    csv: 'CSV',
};

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB global cap
