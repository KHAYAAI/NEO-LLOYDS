import type { AnalystFindingInput, AnalystProvider } from '@neo-lloyds/domain';

/**
 * The default provider when no LLM key is configured. It degrades cleanly
 * rather than failing: it returns a single grounded MISSING_INFORMATION
 * finding rather than fabricating an assessment. This is what lets Phase 2
 * run and be tested with zero external dependencies, and it's also the
 * correct behaviour in production if a key is ever unset or the call fails —
 * "no opinion" beats "a made-up opinion" (ADR-0006).
 */
export class NullAnalystProvider implements AnalystProvider {
  readonly modelId = 'null-provider';
  readonly modelVersion = '1.0.0';

  async analyse(input: {
    riskId: string;
    riskLabel: string;
    graphSummary: string;
    knownFactors: readonly string[];
  }): Promise<readonly AnalystFindingInput[]> {
    const now = new Date().toISOString();
    return [
      {
        kind: 'MISSING_INFORMATION',
        statement:
          'No AI provider is configured (ANTHROPIC_API_KEY unset). This is a placeholder finding, not an assessment.',
        confidence: 1,
        referencedData: [input.riskId],
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        generatedAt: now,
      },
    ];
  }
}

/**
 * Anthropic-backed provider. Calls the Messages API directly (no SDK
 * dependency, to keep the domain/API boundary thin) and asks for strict JSON
 * so findings can be validated before they're allowed to become
 * AnalystFinding objects. Any parse failure or API error surfaces as a
 * degraded report upstream — it never falls back to inventing a finding.
 */
export class AnthropicAnalystProvider implements AnalystProvider {
  readonly modelId = 'claude-sonnet-5';
  readonly modelVersion = '2026-08';

  constructor(private readonly apiKey: string) {}

  async analyse(input: {
    riskId: string;
    riskLabel: string;
    graphSummary: string;
    knownFactors: readonly string[];
  }): Promise<readonly AnalystFindingInput[]> {
    const prompt = [
      'You are a risk analyst for a risk-capital marketplace. You are strictly',
      'advisory: you never approve, price, or bind anything. Given the risk',
      'below, return a JSON array of findings. Each finding must be an object',
      '{"kind": one of SUMMARY|DEPENDENCY|MISSING_INFORMATION|CONFLICTING_INFORMATION|PROPOSED_FACTOR|UNDERWRITING_QUESTION|ANOMALY,',
      '"statement": string, "confidence": number 0-1}. Ground every statement',
      'only in the data given; if you are uncertain, say so with low confidence',
      'and prefer a MISSING_INFORMATION finding over a guess. Return ONLY the',
      'JSON array, no prose.',
      '',
      `Risk: ${input.riskLabel} (${input.riskId})`,
      `Graph summary: ${input.graphSummary}`,
      `Known factors: ${input.knownFactors.join('; ') || 'none declared'}`,
    ].join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API returned ${response.status}`);
    }

    const body = (await response.json()) as {
      content: { type: string; text?: string }[];
    };
    const text = body.content.find((b) => b.type === 'text')?.text ?? '[]';
    const parsed = JSON.parse(text) as { kind: string; statement: string; confidence: number }[];

    const now = new Date().toISOString();
    return parsed.map((finding) => ({
      kind: finding.kind as AnalystFindingInput['kind'],
      statement: finding.statement,
      confidence: finding.confidence,
      referencedData: [input.riskId],
      modelId: this.modelId,
      modelVersion: this.modelVersion,
      generatedAt: now,
    }));
  }
}

export function createAnalystProvider(): AnalystProvider {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  return apiKey ? new AnthropicAnalystProvider(apiKey) : new NullAnalystProvider();
}
