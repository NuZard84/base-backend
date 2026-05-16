import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class SocketService {
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  /** Emit an event to all sockets belonging to a specific user. */
  emitToUser(userId: string, event: string, data: unknown): void {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
