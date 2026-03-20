import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CanvasSharesService } from './canvas-shares/canvas-shares.service';
import { CanvasRole } from '@prisma/client';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: 'canvases',
})
export class CanvasesGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(CanvasesGateway.name);

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private canvasSharesService: CanvasSharesService,
    ) {}

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token || client.handshake.headers['authorization']?.split(' ')[1];
            if (!token) {
                client.disconnect();
                return;
            }

            const payload = this.jwtService.verify(token, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });

            client.data.userId = payload.sub;
            this.logger.log(`Client connected: ${client.id} (User: ${payload.sub})`);
        } catch (e) {
            this.logger.warn(`Failed to authenticate socket ${client.id}: ${e.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('join_canvas')
    async handleJoinCanvas(client: Socket, canvasId: string) {
        const userId = client.data.userId;
        if (!userId || !canvasId) return;

        try {
            await this.canvasSharesService.ensureCanvasAccess(userId, canvasId, CanvasRole.VIEWER);
            
            // Join the specific canvas room
            const roomName = `canvas:${canvasId}`;
            await client.join(roomName);
            this.logger.log(`Client ${client.id} joined ${roomName}`);
            
            return { event: 'joined', data: { canvasId } };
        } catch (e) {
            this.logger.error(`Join error for ${client.id} on canvas ${canvasId}: ${e.message}`);
            return { event: 'error', data: { message: 'Cannot join canvas room' } };
        }
    }

    @SubscribeMessage('leave_canvas')
    async handleLeaveCanvas(client: Socket, canvasId: string) {
        if (!canvasId) return;
        
        const roomName = `canvas:${canvasId}`;
        await client.leave(roomName);
        this.logger.log(`Client ${client.id} left ${roomName}`);
    }

    // This method is called by CanvasesService after a successful sync
    broadcastCanvasUpdate(canvasId: string, payload: any, senderUserId?: string) {
        const roomName = `canvas:${canvasId}`;
        
        // We broadcast to everyone in the room except the sender
        // Note: sender is identified by the senderUserId passed here.
        // We will include senderUserId so clients can filter out their own echoes, 
        // or we can use io.sockets to emit everywhere and let frontend filter
        this.server.to(roomName).emit('canvas_updated', {
            ...payload,
            senderUserId
        });
    }
}
