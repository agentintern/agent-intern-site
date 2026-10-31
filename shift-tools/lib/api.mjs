import { existsSync, readFileSync } from 'node:fs';
import { CONFIG, SECRETS_FILE } from './paths.mjs';

export function readSecrets() {
  if (!existsSync(SECRETS_FILE)) {
    throw new Error(`No ${SECRETS_FILE}. Run npm run setup first.`);
  }
  return JSON.parse(readFileSync(SECRETS_FILE, 'utf8'));
}

const siteUrl = () => process.env.AGENT_INTERN_SITE || CONFIG.siteUrl;

export async function getJson(path) {
  const response = await fetch(`${siteUrl()}${path}`, { headers: { accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function postJson(path, token, body) {
  const response = await fetch(`${siteUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (!response.ok) throw new Error(parsed.error ?? `HTTP ${response.status}`);
  return parsed;
}
