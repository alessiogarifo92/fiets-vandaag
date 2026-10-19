import { parseHash, type Route } from './routes';

export type { Route };

export const nav = $state<{ route: Route | null }>({ route: parseHash(globalThis.location?.hash ?? '') });

export function go(route: Route): void {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
  nav.route = route;
}

globalThis.addEventListener?.('hashchange', () => {
  nav.route = parseHash(location.hash);
});
