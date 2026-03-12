import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are a Senior Operations Consultant at an AI automation firm. A potential client has described their business pain points or workflow. Your job is to extract structured ROI data.

CRITICAL: Respond ONLY with a single valid JSON object. No markdown fences, no prose, no explanation — just the raw JSON object and nothing else.

If the input has zero business context (e.g. random words, gibberish), return exactly:
{"error": "Please describe a business workflow or pain point — for example: 'My team spends 2 hours a day manually entering orders into our system.'"}

For ANY real business description — even if it mentions multiple pain points or asks ROI questions — pick the single highest-impact workflow to model and return:
{
  "task_name": "short descriptive name (3-6 words)",
  "estimated_minutes": <number: realistic time in minutes per occurrence>,
  "frequency_per_week": <number: realistic occurrences per week>,
  "complexity": <integer 1-10>,
  "automation_potential": <float 0.0-1.0>,
  "suggested_phases": ["Phase 1: ...", "Phase 2: ...", "Phase 3: ..."]
}

Examples of valid inputs you MUST handle: nail salon missing bookings, no-show rates, phone interruptions, manual scheduling, data entry, invoice processing, inventory ordering, customer follow-ups. These are all automatable workflows — never reject them.`;

interface AnalysisResult {
  task_name: string;
  estimated_minutes: number;
  frequency_per_week: number;
  complexity: number;
  automation_potential: number;
  suggested_phases: string[];
  error?: string;
}

const MOCK_RESPONSE: AnalysisResult = {
  task_name: 'Manual Data Entry & Sync',
  estimated_minutes: 45,
  frequency_per_week: 5,
  complexity: 4,
  automation_potential: 0.87,
  suggested_phases: [
    'Phase 1: Build automated data extraction from source systems',
    'Phase 2: Deploy validation layer with error flagging',
    'Phase 3: Set up real-time sync with monitoring dashboard',
  ],
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userInput = typeof body.userInput === 'string' ? body.userInput.trim() : '';

    if (!userInput || userInput.length < 10) {
      return NextResponse.json(
        { error: 'Please describe your workflow in more detail.' },
        { status: 400 }
      );
    }

    // No API key — return mock for local dev
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey && !openaiKey) {
      await new Promise((r) => setTimeout(r, 1800)); // simulate latency
      return NextResponse.json(MOCK_RESPONSE);
    }

    let rawText = '';

    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userInput }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}`);
      const data = await res.json();
      rawText = data.content?.[0]?.text ?? '';
    } else if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 512,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userInput },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = await res.json();
      rawText = data.choices?.[0]?.message?.content ?? '';
    }

    // Extract JSON object — handles accidental markdown fences or trailing prose
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    const parsed: AnalysisResult = JSON.parse(jsonMatch[0]);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[analyze-workflow]', err);
    return NextResponse.json(
      { error: 'Something went wrong analyzing your workflow. Please try again.' },
      { status: 500 }
    );
  }
}
