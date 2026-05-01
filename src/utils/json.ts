export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
