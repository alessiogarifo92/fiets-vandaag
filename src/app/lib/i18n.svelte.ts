// Reactive language for the Svelte screens; the strings come from the shared core catalog.

import { pickLang, t, type MessageKey, type Params } from '../../core/i18n';
import type { Lang } from '../../core/validate';
import { updateLang } from './device';
import { save } from './store';

export const locale = $state<{ lang: Lang }>({ lang: pickLang(globalThis.navigator?.languages ?? []) });

export function tr(key: MessageKey, params?: Params): string {
  return t(locale.lang, key, params);
}

export function setLang(lang: Lang): void {
  locale.lang = lang;
  document.documentElement.lang = lang;
  void save('lang', lang).catch(() => {});
  // The server localizes the pushes; no-op until the device is registered.
  void updateLang(lang).catch(() => {});
}
