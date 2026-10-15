import type { HealthResponse } from '../../core/api';
import { json } from '../http';

export function handleHealth(version: string): Response {
  const body: HealthResponse = { ok: true, version };
  return json(body);
}
