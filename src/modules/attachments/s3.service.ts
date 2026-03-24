import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AttachmentType } from './attachments.constants';

export interface UploadInput {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
}

export interface PresignedGetInput {
    key: string;
    expiresIn?: number;
    filename?: string;
    /** `inline` = show in browser / &lt;img src&gt;; `attachment` = force download */
    disposition?: 'inline' | 'attachment';
}

/** Production-grade S3 bucket service for file storage (images, PDF, CSV, etc.) */
@Injectable()
export class S3Service {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly region: string;

    constructor(private readonly config: ConfigService) {
        const accessKey = this.config.get<string>('AWS_S3_ACCESS_KEY');
        const secretKey = this.config.get<string>('AWS_S3_SECRET_KEY');
        this.region = this.config.get<string>('AWS_S3_REGION', 'us-east-1');
        this.bucket = this.config.get<string>('AWS_S3_BUCKET', '');

        if (!accessKey || !secretKey || !this.bucket) {
            throw new Error(
                'Missing S3 config: AWS_S3_ACCESS_KEY, AWS_S3_SECRET_KEY, AWS_S3_BUCKET are required',
            );
        }

        this.client = new S3Client({
            region: this.region,
            credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        });
    }

    async upload(input: UploadInput): Promise<string> {
        const { key, body, contentType, metadata = {} } = input;

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: metadata,
        });

        await this.client.send(command);
        return key;
    }

    async delete(key: string): Promise<void> {
        const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
        await this.client.send(command);
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            return true;
        } catch {
            return false;
        }
    }

    /** Returns a presigned PUT URL so the browser can upload directly to S3. */
    async getPresignedPutUrl(input: {
        key: string;
        contentType: string;
        expiresIn?: number;
    }): Promise<string> {
        const { key, contentType, expiresIn = 300 } = input; // 5-minute window
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        });
        return getSignedUrl(this.client, command, { expiresIn });
    }

    /** Returns a presigned GET URL (time-limited). Use inline for thumbnails/previews. */
    async getPresignedUrl(input: PresignedGetInput): Promise<string> {
        const { key, expiresIn = 3600, filename, disposition = 'attachment' } = input;

        const safeName = filename?.replace(/"/g, '\\"');
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ...(safeName && {
                ResponseContentDisposition:
                    disposition === 'inline'
                        ? `inline; filename="${safeName}"`
                        : `attachment; filename="${safeName}"`,
            }),
        });

        return getSignedUrl(this.client, command, { expiresIn });
    }

    /** Downloads a file from S3 and returns its content as a Buffer */
    async getBuffer(key: string): Promise<Buffer> {
        const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
        const response = await this.client.send(command);
        const stream = response.Body as NodeJS.ReadableStream;
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }

    /** Builds a stable S3 key for an attachment */
    buildKey(userId: string, type: AttachmentType, extension: string): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).slice(2, 10);
        const ext = extension.startsWith('.') ? extension : `.${extension}`;
        return `attachments/${userId}/${type.toLowerCase()}/${timestamp}-${random}${ext}`;
    }
}
