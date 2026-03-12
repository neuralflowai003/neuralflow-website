import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are a Senior Operations Consultant at an AI automation firm. A potential client has described a manual workflow. Your job is to extract structured data from their description.

Respond ONLY with valid JSON — no markdown, no prose. If the input is too vague, non-business-related, or unclear, return:
{"error": "Please describe a specific business process — for example: 'We manually copy order data from email into our CRM every morning, takes about 20 minutes, happens 5 times a week.'"}

Otherwise return:
{
  "task_name": "short descriptive name (3-6 words)",
  "estimated_minutes": <number: realistic time in minutes per run>,
  "frequency_per_week": <number: how many times per week>,
  "complexity": <integer 1-10: 1=simple copy-paste, 10=complex multi-system decision logic>,
  "automation_potential": <float 0.0-1.0: how automatable is this with current AI/RPA>,
  "suggested_phases": ["Phase 1: ...", "Phase 2: ...", "Phase 3: ..."]
}

Be realistic. A 3-minute task done once a week isn't worth automating — note that in complexity. A 2-hour daily task with 15% error rate is a goldmine. Think like a consultant billing $350/hr.`;

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

    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed: AnalysisResult = JSON.parse(cleaned);

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
