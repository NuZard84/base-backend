import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DOCUMENT_EVENTS } from '../rag/processing/processing.constants';

/**
 * DocumentsGateway
 *
 * Clients join their personal room by emitting:
 *   socket.emit('join:documents', { userId })
 *
 * They will then receive these server-push events:
 *   document:processing_started  — worker started parsing
 *   document:chunked             — text split into chunks
 *   document:ready               — fully embedded, ready to query
 *   document:failed              — processing error
 *
 * Each event payload: { documentId, filename, status, ...meta }
 */
@WebSocketGateway()
export class DocumentsGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DocumentsGateway.name);

  @SubscribeMessage('join:documents')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    if (!data?.userId) return;
    const room = `documents:${data.userId}`;
    client.join(room);
    this.logger.debug(`Socket ${client.id} joined room ${room}`);
  }

  /** Called by BullMQ processors to push status updates to the user */
  emitToUser(userId: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(`documents:${userId}`).emit(event, payload);
  }

  emitProcessingStarted(userId: string, documentId: string, filename: string) {
    this.emitToUser(userId, DOCUMENT_EVENTS.PROCESSING_STARTED, {
      documentId,
      filename,
      status: 'PROCESSING',
    });
  }

  emitChunked(userId: string, documentId: string, filename: string, chunkCount: number) {
    this.emitToUser(userId, DOCUMENT_EVENTS.CHUNKED, {
      documentId,
      filename,
      status: 'EMBEDDING',
      chunkCount,
    });
  }

  emitReady(userId: string, documentId: string, filename: string, chunkCount: number) {
    this.emitToUser(userId, DOCUMENT_EVENTS.READY, {
      documentId,
      filename,
      status: 'COMPLETED',
      chunkCount,
    });
  }

  emitFailed(userId: string, documentId: string, filename: string, error: string) {
    this.emitToUser(userId, DOCUMENT_EVENTS.FAILED, {
      documentId,
      filename,
      status: 'FAILED',
      error,
    });
  }
}
