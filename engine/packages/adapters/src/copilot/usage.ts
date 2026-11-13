import type { ModelUsage, RuntimeEventOf, UsageMetrics } from "@pica/core";

// Totals over the `assistant.usage` events this session has seen.
export class UsageTotals {
  private readonly byModel = new Map<string, ModelUsage>();

  add(data: RuntimeEventOf<"assistant.usage">["data"]): void {
    const current = this.byModel.get(data.model) ?? {
      model: data.model,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      calls: 0,
    };
    this.byModel.set(data.model, {
      model: data.model,
      inputTokens: current.inputTokens + data.inputTokens,
      cachedInputTokens: current.cachedInputTokens + data.cachedInputTokens,
      outputTokens: current.outputTokens + data.outputTokens,
      calls: current.calls + 1,
    });
  }

  metrics(): UsageMetrics {
    const byModel = [...this.byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
    const sum = (pick: (entry: ModelUsage) => number): number => byModel.reduce((total, entry) => total + pick(entry), 0);
    return {
      inputTokens: sum((entry) => entry.inputTokens),
      cachedInputTokens: sum((entry) => entry.cachedInputTokens),
      outputTokens: sum((entry) => entry.outputTokens),
      byModel,
    };
  }
}
