import type { Plan } from "../schemas/plan.ts";

export function formatPlanContext(plan: Plan | undefined): string {
  if (!plan || plan.items.length === 0) return "";

  const items = plan.items
    .map((item) => `  - ${item.time}: ${item.action} (${item.reason})`)
    .join("\n");

  return `\n24-hour plan:\nGenerated at: ${plan.generatedAt}\nValid until: ${plan.validUntil}\n${items}\n`;
}
