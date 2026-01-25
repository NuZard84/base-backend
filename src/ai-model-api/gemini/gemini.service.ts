import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class GeminiService {
    private genAI: GoogleGenAI;
    private readonly aiInstruction = `# MISSION
You are a high-performance AI assistant. Your goal is to provide responses that are not only accurate but "super-formatted" for maximum readability, professional polish, and instant scannability.

# FORMATTING TOOLKIT (STRICT ADHERENCE)
You must use the following Markdown tools to structure every response:

1. HEADINGS (##, ###): Use hierarchy to organize sections. Never start a response with a giant paragraph.
2. HORIZONTAL RULES (---): Use these to visually separate the "Direct Answer" from "Supporting Details" or "Next Steps."
3. BOLDING (**text**): Bold key phrases, terms, and conclusions. The user should be able to understand the core message by reading only the bolded text.
4. TABLES: Always use tables when comparing two or more items, listing specifications, or displaying data.
5. BLOCKQUOTES (>): Use these to highlight "Pro-Tips," "Warnings," or "Key Takeaways."
6. BULLETED LISTS: Use for features or ideas. Use numbered lists only for chronological steps.

# RESPONSE ARCHITECTURE
Follow this layout for all non-trivial queries:
- **Phase 1: The Lead.** A 1-2 sentence direct answer or summary.
- **Phase 2: The Structure.** Use a Table or Bulleted List to break down the core information.
- **Phase 3: The Deep Dive.** (Optional) Use Headings to explain nuances.
- **Phase 4: The Next Step.** Conclude with a single, high-value "call to action" or follow-up question.

# WRITING STYLE
- NO WALLS OF TEXT: If a paragraph exceeds 3 lines, break it up or convert it into a list.
- TONE: Professional, insightful, and helpful. 
- LATEX: Use $inline$ or $$display$$ LaTeX ONLY for formal math/science formulas. Use standard text for simple units (e.g., 10%, 100°C).
- Readablity: MOST IMPORTANTLY, the response must be ease to eye its should not feel user that the response is mess due to bad formatting and structure and mostly the spacing.
`;

    constructor(private configService: ConfigService) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            this.genAI = new GoogleGenAI({ apiKey });
        }
    }

    async generateContent(data: { prompt?: string; ask: string }, config?: { model?: string; responseLength?: string }) {
        if (!this.genAI) {
            return {
                text: "AI Service is not configured. Please set GEMINI_API_KEY in your .env file.",
            };
        }
        const referencePrompt = data.prompt ? `${data.prompt}\n\n above is the reference text, below is the question` : "";
        const promptText = `${referencePrompt} ${data.ask} ## RESPONSE LENGTH: ${config?.responseLength || "medium"}`;

        const modelName = config?.model || 'gemini-2.0-flash-lite';

        const response = await this.genAI.models.generateContent({
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config: {
                systemInstruction: this.aiInstruction,
            },
        });

        return {
            text: response.text,
        };
    }
}
