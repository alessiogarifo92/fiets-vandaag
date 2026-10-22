// The invite code travels in the invite link or QR code: https://<origin>/?invite=<code> (docs/architecture.md §2).

import { MAX_INVITE_LENGTH } from '../../core/validate';

/** The invite in a URL, and the same URL without it (so it does not linger in history or a bookmark). */
export function readInvite(href: string): { invite: string | null; clean: string } {
  const url = new URL(href);
  const raw = url.searchParams.get('invite');
  url.searchParams.delete('invite');
  const invite = raw?.trim() ?? '';
  return {
    invite: invite && invite.length <= MAX_INVITE_LENGTH ? invite : null,
    clean: raw === null ? href : `${url.pathname}${url.search}${url.hash}`,
  };
}
