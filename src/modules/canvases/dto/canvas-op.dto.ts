export type CanvasOpType =
    | 'node_move'     // data: { x, y, width, height }   ← include width/height to avoid DB read on flush
    | 'node_resize'   // data: { x, y, width, height }
    | 'node_style'    // data: { style: Record<string, unknown> }
    | 'node_zindex';  // data: { zIndex: number }

export interface NodeMoveData    { x: number; y: number; width: number; height: number }
export interface NodeResizeData  { x: number; y: number; width: number; height: number }
export interface NodeStyleData   { style: Record<string, unknown> }
export interface NodeZIndexData  { zIndex: number }

export interface CanvasOp {
    /** client-side sequence number echoed back in op_ack for correlation */
    seq?: number;
    type: CanvasOpType;
    /** clientId of the node */
    nodeId: string;
    data: NodeMoveData | NodeResizeData | NodeStyleData | NodeZIndexData;
}

// ── Op log entry stored in Redis ───────────────────────────────────────────
export interface OpLogEntry {
    serverSeq: number;
    timestamp: number;
    senderUserId: string;
    op: CanvasOp;
}

// ── WebSocket payload types ────────────────────────────────────────────────
export interface CanvasOpPayload    { canvasId: string; op: CanvasOp }
export interface CursorMovePayload  { canvasId: string; x: number; y: number }
export interface SelectionChangePayload { canvasId: string; selectedNodeIds: string[] }
export interface ForceFlushPayload  { canvasId: string }

/** Client sends this on reconnect to receive ops it missed while offline */
export interface SyncSincePayload   { canvasId: string; lastSeq: number }

/** join_canvas now accepts an object so lastSeq can be passed at join time */
export interface JoinCanvasPayload  { canvasId: string; lastSeq?: number }
