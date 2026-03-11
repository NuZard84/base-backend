export const queryType = {
    VID_SUMMARIZE: 'vid_summarize'
}

export type AiRequestType = 'vid_summarize' | null;

/** Single message in conversation history for multi-turn context */
export interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
}

export class AiRequestData {
    prompt?: string;
    ask: string;
    type?: AiRequestType;
    /** Optional conversation history for multi-turn context (alternating user/model) */
    history?: HistoryMessage[];
}

export class AiRequestConfig {
    model?: string;
    responseLength?: string;
    /** When true, enables Google Search Grounding for real-time internet data */
    isSearch?: boolean;
}

export class AiResponse {
    success: boolean;
    text: string;
    /** Populated only when isSearch is true — grounded web sources */
    sources?: { title: string; url: string }[];
}
