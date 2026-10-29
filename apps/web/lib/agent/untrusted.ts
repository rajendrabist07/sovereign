export const MAX_UNTRUSTED_CHARS = 8000;

// Matches "<untrusted", "</untrusted" and spaced variants such as "< / untrusted".
const TAG_PATTERN = /<\s*(\/?)\s*untrusted/gi;

/** Stops text from opening or closing one of our own <untrusted> tags. */
export function neutraliseTags(text: string): string {
  return text.replace(TAG_PATTERN, "<$1untrusted-escaped");
}

/**
 * Wraps outside data (customer input, web pages, tool results) so the model
 * can tell it apart from instructions. This is defence in depth, not a
 * guarantee: a model can still be talked into ignoring tags. The real limits
 * are what the tools can do and the validation of every answer.
 */
export function wrapUntrusted(label: string, text: string, maxChars = MAX_UNTRUSTED_CHARS): string {
  const source = label.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "data";
  const body = neutraliseTags(text.slice(0, maxChars));
  const note = text.length > maxChars ? "\n[truncated]" : "";
  return `<untrusted source="${source}">\n${body}${note}\n</untrusted>`;
}
