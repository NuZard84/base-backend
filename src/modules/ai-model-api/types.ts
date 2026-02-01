export const queryType = {
    VID_SUMMARIZE: 'vid_summarize'
}

export type AiRequestType = 'vid_summarize' | null;

export class AiRequestData {
    prompt?: string;
    ask: string;
    type?: AiRequestType;
}

export class AiRequestConfig {
    model?: string;
    responseLength?: string;
}

export class AiResponse {
    success: boolean;
    text: string;
}
