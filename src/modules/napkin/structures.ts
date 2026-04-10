/**
 * Napkin.ai structure definitions.
 *
 * Each structure has:
 *  - `label`       — shown in the UI dropdown
 *  - `hint`        — short tooltip / hint line in the UI
 *  - `systemPrompt`— Gemini system instruction that expands vague user input into
 *                    rich, structure-specific plain text that Napkin's AI can render well
 *  - `buildContent`— simple fallback template (used when Gemini is unavailable)
 *
 * Credit & token efficiency:
 *  - Gemini expansion uses gemini-2.0-flash-lite (~$0.00003 per call) — negligible vs Napkin credits
 *  - Napkin charges per visual generated (number_of_visuals × 1 credit each)
 *  - Better first-attempt quality from expanded prompts → fewer regenerations → net credit saving
 *  - SVG format avoids PNG-conversion credit cost; status polling is always free
 */

export type StructureKey =
    | 'none'
    | 'mindmap'
    | 'process'
    | 'data'
    | 'timeline'
    | 'comparison'
    | 'business_framework'
    | 'brainstorming'
    | 'parts_whole'
    | 'problem_solution'
    | 'visual_metaphor'
    | 'narrative'
    | 'cause_effect'
    | 'hierarchy';

interface StructureDef {
    label: string;
    hint: string;
    systemPrompt: string;
    buildContent: (userText: string) => string;
}

// ─── SHARED RULES injected into every system prompt ──────────────────────────
const BASE_RULES = `
OUTPUT RULES (strictly enforced):
- Plain text ONLY — no markdown, no asterisks, no hashtags, no bullet hyphens styled as "**bold**"
- Hyphens for bullets are fine (- item)
- No preamble, no explanation, no closing remarks — just the structured content
- Keep total output under 480 characters so Napkin renders it cleanly
- Infer domain knowledge to fill any gaps the user left vague
`.trim();

// ─────────────────────────────────────────────────────────────────────────────

export const STRUCTURES: Record<StructureKey, StructureDef> = {

    none: {
        label: 'Auto (AI decides)',
        hint: 'Let Napkin choose the best structure for your content',
        systemPrompt: '',
        buildContent: (t) => t,
    },

    mindmap: {
        label: 'Mind Map',
        hint: 'Central topic radiating into branches and sub-ideas',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a MIND MAP.

Format (copy exactly, replace brackets):
[Central Topic]

[Category A]: [item1], [item2], [item3]
[Category B]: [item1], [item2], [item3]
[Category C]: [item1], [item2], [item3]
[Category D]: [item1], [item2], [item3]
[Category E]: [item1], [item2], [item3]

- 4-6 categories, 3-4 items each
- Category names 1-3 words; items 1-4 words (noun phrases)
${BASE_RULES}`,
        buildContent: (t) =>
            `MIND MAP — ${t}\n\nCentral concept with branching categories and subtopics. Show all major themes, grouped relationships, and hierarchical connections radiating outward.`,
    },

    process: {
        label: 'Process / Flow',
        hint: 'Sequential steps with arrows showing flow direction',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a PROCESS FLOW diagram.

Format:
[Process Title]

Step 1: [action — verb + object, max 8 words]
Step 2: [action]
Step 3: [action]
...
Step N: [action]

Decision: If [condition] → [path A] / [path B]
(include 1-2 decisions or feedback loops where natural)

- 5-8 steps total
- Steps start with strong action verbs (collect, validate, transform, deploy…)
${BASE_RULES}`,
        buildContent: (t) =>
            `PROCESS FLOW — ${t}\n\nSequential steps with clear start and end. Each step leads to the next. Show decision points and feedback loops where relevant.`,
    },

    data: {
        label: 'Data / Statistics',
        hint: 'Charts, metrics, and numerical comparisons',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a DATA VISUALIZATION.

Format:
[Title]

Key Metrics:
[Label]: [Value or %]
[Label]: [Value or %]
[Label]: [Value or %]
[Label]: [Value or %]
[Label]: [Value or %]

Key Insights:
- [insight in 5-7 words]
- [insight in 5-7 words]
- [insight in 5-7 words]

- Use real/realistic numbers from your knowledge if the user was vague
- Metrics should be the most impactful figures for the topic
${BASE_RULES}`,
        buildContent: (t) =>
            `DATA VISUALIZATION — ${t}\n\nKey metrics, statistics, and figures. Present numbers prominently with clear labels and comparisons.`,
    },

    timeline: {
        label: 'Timeline',
        hint: 'Chronological events from past to present / future',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a TIMELINE.

Format:
[Timeline Title]

[Date/Year/Period]: [milestone — max 7 words]
[Date/Year/Period]: [milestone]
[Date/Year/Period]: [milestone]
[Date/Year/Period]: [milestone]
[Date/Year/Period]: [milestone]
[Date/Year/Period]: [milestone]

- 5-8 entries in strict chronological order
- Dates can be absolute (1969, Q1 2024) or relative (Month 1, Phase 2)
- Use historically accurate dates from your knowledge when user is vague
${BASE_RULES}`,
        buildContent: (t) =>
            `TIMELINE — ${t}\n\nChronological milestones from earliest to latest. Show dates, key events, and turning points in sequence.`,
    },

    comparison: {
        label: 'Comparison',
        hint: 'Side-by-side analysis across multiple criteria',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a COMPARISON.

Format:
[Option A] vs [Option B]

[Criterion]: [A value, 1-5 words] | [B value, 1-5 words]
[Criterion]: [A value] | [B value]
[Criterion]: [A value] | [B value]
[Criterion]: [A value] | [B value]
[Criterion]: [A value] | [B value]
[Criterion]: [A value] | [B value]

Verdict: [A] wins at [strength]; [B] wins at [strength]

- 5-7 criteria covering performance, cost, ease, scalability, use-case etc.
- Criteria labels 1-3 words
${BASE_RULES}`,
        buildContent: (t) =>
            `COMPARISON — ${t}\n\nSide-by-side analysis across key criteria. Show similarities, differences, trade-offs, pros and cons.`,
    },

    business_framework: {
        label: 'Business Framework',
        hint: 'SWOT, Porter\'s Five Forces, BCG Matrix, etc.',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a BUSINESS FRAMEWORK.

1. Identify the BEST framework for the topic (SWOT, Porter's Five Forces, BCG Matrix, PESTEL, Business Model Canvas, Ansoff Matrix, McKinsey 7S, etc.)
2. Use the framework's exact section names.

Format:
Framework: [Framework Name]
Subject: [Topic]

[Section 1]:
- [point, max 7 words]
- [point, max 7 words]

[Section 2]:
- [point]
- [point]

(repeat for all sections of the framework)

- 2-3 bullet points per section
- Points are specific and insightful, not generic
${BASE_RULES}`,
        buildContent: (t) =>
            `BUSINESS FRAMEWORK — ${t}\n\nApply the most appropriate strategic framework. Organize into the framework's standard sections with specific, insightful points.`,
    },

    brainstorming: {
        label: 'Brainstorming',
        hint: 'Cluster of diverse ideas around a central question',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a BRAINSTORMING cluster.

Format:
Central Theme: [main topic or question]

[Cluster A — label]: [idea1], [idea2], [idea3], [idea4]
[Cluster B — label]: [idea1], [idea2], [idea3], [idea4]
[Cluster C — label]: [idea1], [idea2], [idea3], [idea4]
[Cluster D — label]: [idea1], [idea2], [idea3], [idea4]
[Cluster E — label]: [idea1], [idea2], [idea3]

- 4-5 clusters of related ideas
- Cluster labels 1-2 words (e.g. "Quick Wins", "Long-term", "People", "Tech")
- Ideas are 1-4 word noun/verb phrases
- Emphasise diversity — mix conventional and creative ideas
${BASE_RULES}`,
        buildContent: (t) =>
            `BRAINSTORMING — ${t}\n\nDiverse ideas clustered by theme. Show quantity and variety of possibilities around the central topic.`,
    },

    parts_whole: {
        label: 'Parts of a Whole',
        hint: 'Components that make up a complete system',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a PARTS OF A WHOLE diagram.

Format:
Whole: [system or concept name]

[Part 1 name] — [role in 4-6 words] — [% or relative size if applicable]
[Part 2 name] — [role in 4-6 words] — [%]
[Part 3 name] — [role in 4-6 words] — [%]
[Part 4 name] — [role in 4-6 words] — [%]
[Part 5 name] — [role in 4-6 words]

Integration: [one sentence on how parts work together]

- 4-7 parts
- If proportions are known, include them; otherwise omit
- Part names 1-4 words
${BASE_RULES}`,
        buildContent: (t) =>
            `PARTS OF A WHOLE — ${t}\n\nBreakdown of components that form the complete system. Show each part's role, proportion, and contribution.`,
    },

    problem_solution: {
        label: 'Problems & Solutions',
        hint: 'Problems paired with actionable solutions',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a PROBLEMS AND SOLUTIONS diagram.

Format:
Context: [domain, max 5 words]

Problem 1: [clear problem, max 8 words]
Solution 1: [concrete action, max 8 words]

Problem 2: [clear problem, max 8 words]
Solution 2: [concrete action, max 8 words]

Problem 3: [clear problem, max 8 words]
Solution 3: [concrete action, max 8 words]

Problem 4: [clear problem, max 8 words]
Solution 4: [concrete action, max 8 words]

- 3-5 pairs
- Solutions must be specific and actionable (start with a verb)
- Problems and solutions are mirror pairs — clearly connected
${BASE_RULES}`,
        buildContent: (t) =>
            `PROBLEMS AND SOLUTIONS — ${t}\n\nClear problems paired with concrete solutions. Show cause, impact, and resolution for each issue.`,
    },

    visual_metaphor: {
        label: 'Visual Metaphor',
        hint: 'Abstract concept expressed through a visual analogy',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a VISUAL METAPHOR.

Choose a powerful, universally recognisable metaphor (iceberg, tree, bridge, puzzle, ladder, journey, ocean, mountain, etc.).

Format:
Concept: [abstract idea]
Metaphor: [chosen real-world image]

Mapping:
[concept element] = [metaphor element]
[concept element] = [metaphor element]
[concept element] = [metaphor element]
[concept element] = [metaphor element]

Key Message: [one memorable sentence, max 12 words]

- 4-5 mapping points
- Metaphor should be immediately visual and intuitive
${BASE_RULES}`,
        buildContent: (t) =>
            `VISUAL METAPHOR — ${t}\n\nAbstract concept through an intuitive visual analogy. Map each element of the concept to the metaphor clearly.`,
    },

    narrative: {
        label: 'Narrative / Story',
        hint: 'Journey with beginning, turning point, and outcome',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a NARRATIVE story arc.

Format:
[Story Title]

Setup: [context and starting state, max 10 words]
Challenge: [problem or journey that begins, max 10 words]
Rising Action: [escalation or key events, max 10 words]
Climax: [turning point or decisive moment, max 10 words]
Resolution: [outcome and transformation, max 10 words]

Theme: [central message in 6 words]
Lesson: [takeaway in 6 words]

- 5 story beats with clear narrative progression
- Each beat is vivid and specific
${BASE_RULES}`,
        buildContent: (t) =>
            `NARRATIVE — ${t}\n\nVisual story arc: setup, challenge, turning point, and resolution. Show the journey and transformation.`,
    },

    cause_effect: {
        label: 'Cause & Effect',
        hint: 'Root causes chained to their resulting effects',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a CAUSE AND EFFECT diagram.

Format:
Central Problem: [main issue, max 7 words]

Root Causes:
- [cause 1] → [direct effect]
- [cause 2] → [direct effect]
- [cause 3] → [direct effect]
- [cause 4] → [direct effect]

Compounding Effects:
- [effect that leads to another effect]
- [effect that leads to another effect]

Feedback Loop: [A] → [B] → back to [A]

Final Outcome: [ultimate consequence, max 8 words]

- 4-5 root causes with direct effects
- Include 1 feedback loop
${BASE_RULES}`,
        buildContent: (t) =>
            `CAUSE AND EFFECT — ${t}\n\nRoot causes mapped to direct and compounding effects. Show causal chains, feedback loops, and the ultimate outcome.`,
    },

    hierarchy: {
        label: 'Hierarchy / Org Chart',
        hint: 'Tree structure showing levels and nested relationships',
        systemPrompt: `You prepare content for Napkin, an AI infographic generator. Output a HIERARCHY / ORG CHART.

Use indentation to show levels:
[Root — Level 0]
  [Child A — Level 1]
    [Grandchild — Level 2]
    [Grandchild — Level 2]
  [Child B — Level 1]
    [Grandchild — Level 2]
    [Grandchild — Level 2]
  [Child C — Level 1]
    [Grandchild — Level 2]

- Maximum 3-4 levels deep
- 2-4 children per parent
- Node names 1-4 words
- Use real names/roles from your knowledge when user is vague
${BASE_RULES}`,
        buildContent: (t) =>
            `HIERARCHY — ${t}\n\nTop-down tree showing levels, authority, or nested classification from the root to the most detailed sub-items.`,
    },
};

/** Ordered list for the UI dropdown — logical groupings */
export const STRUCTURE_ORDER: StructureKey[] = [
    'none',
    'mindmap', 'process', 'hierarchy', 'timeline',
    'comparison', 'parts_whole', 'data',
    'cause_effect', 'problem_solution',
    'business_framework', 'brainstorming',
    'narrative', 'visual_metaphor',
];
