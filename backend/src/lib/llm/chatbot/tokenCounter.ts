export const TOKEN_BUDGET_LIMIT = 50_000;
export const TOKEN_BUDGET_WARNING = 45_000;

export interface TokenUsage {
  input: number;
  output: number;
}

export const recordUsage = (
  currentTotal: number | undefined,
  usage: TokenUsage,
): number => {
  const base = currentTotal ?? 0;
  return base + Math.max(0, usage.input) + Math.max(0, usage.output);
};

export const isBudgetExceeded = (totalTokens: number | undefined): boolean => {
  return (totalTokens ?? 0) >= TOKEN_BUDGET_LIMIT;
};

export const isBudgetWarning = (totalTokens: number | undefined): boolean => {
  return (totalTokens ?? 0) >= TOKEN_BUDGET_WARNING;
};
