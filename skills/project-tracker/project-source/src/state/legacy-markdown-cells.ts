/** Legacy v1 display encoding; exact verification values live in metadata. */
export function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " <br> ").trim();
}
export function unescapeCell(value: string): string {
  return value.replace(/<br>/g, "\n").replace(/\\\|/g, "|").replace(/\\\\/g, "\\").trim();
}
