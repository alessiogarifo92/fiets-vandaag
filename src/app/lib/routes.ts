// Hash routes, so the static assets need no server-side routing.

export const ROUTES = ['install', 'setup', 'today', 'hours', 'privacy', 'about'] as const;
export type Route = (typeof ROUTES)[number];

export function parseHash(hash: string): Route | null {
  const name = hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : null;
}
