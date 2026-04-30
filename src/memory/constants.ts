export const L4_NAMESPACE = ["memory", "L4"] as const;
export const L4_KEY = "current";

export const DEFAULT_L4_MAX_CHARS = 1000;

export const DEFAULT_L4_PROMPT = `Update the persistent memory with any new durable facts, user preferences, user patterns, habit, or events from the expiring 6-hour summary. Preserve existing important facts; drop stale or trivial details. Keep the result concise (under {l4MaxChars} characters). Output only the new persistent memory text, no preamble.

Current persistent memory:
{l4Current}

Expiring 6-hour summaries:
{l3Entries}`;
