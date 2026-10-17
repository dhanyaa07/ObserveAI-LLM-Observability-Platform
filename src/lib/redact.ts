// Redaction utility: Redacts emails and phone numbers from user inputs
export function redactPII(text: string): string {
  if (!text) return "";
  // Email regex
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  // Phone regex (international & US formats)
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  
  return text
    .replace(emailRegex, "[REDACTED_EMAIL]")
    .replace(phoneRegex, "[REDACTED_PHONE]");
}

export function calculateTokens(text: string): number {
  if (!text) return 0;
  // Approximate standard tokenization: ~4 chars per token or 0.75 words per token
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  return Math.max(1, Math.round((words * 1.3 + chars / 4) / 2));
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1M: number,
  outputPricePer1M: number
): number {
  const inputCost = (inputTokens / 1_000_000) * inputPricePer1M;
  const outputCost = (outputTokens / 1_000_000) * outputPricePer1M;
  return Number((inputCost + outputCost).toFixed(6));
}
