// URLSearchParams is a DOM/Workers global, which core's tsconfig deliberately leaves out.

/** "a=1&b=x%20y" from a record, in insertion order. */
export function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
