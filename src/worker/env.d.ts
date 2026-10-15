declare const __APP_VERSION__: string;

interface Env {
  // Secrets (README.md); absent until set with `wrangler secret put`.
  VAPID_PRIVATE_KEY?: string;
  INVITE_CODE?: string;
}
