import { SITE } from '../../src/worker/config';
import type { Env } from '../../src/worker/env';
import { getShift } from '../../src/worker/shifts';

const CSP = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`;

function replaceMeta(html: string, property: string, value: string): string {
  const safe = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return html.replace(new RegExp(`(<meta (?:property|name)="${property}" content=")[^"]*(">)`), `$1${safe}$2`);
}

// Serves the one shift page, with its own title and ship card for link previews.
export async function onRequest(context: { request: Request; env: Env & { ASSETS: { fetch: typeof fetch } }; params: { id: string } }): Promise<Response> {
  const { request, env, params } = context;
  const page = await env.ASSETS.fetch(new URL('/shift-detail', request.url).toString());
  let html = await page.text();
  const id = Number(params.id);
  const shift = Number.isInteger(id) && id > 0 ? await getShift(env, id) : null;
  if (shift) {
    const title = `Shift ${shift.id}: ${shift.status} | Agent Intern`;
    const card = `${SITE.siteOrigin}/api/shifts/${shift.id}/card.png`;
    html = html.replace(/<title>[^<]*<\/title>/, `<title>Shift ${shift.id} | Agent Intern</title>`);
    for (const [key, value] of [
      ['og:title', title], ['twitter:title', title], ['og:description', shift.task_text], ['twitter:description', shift.task_text],
      ['description', shift.task_text], ['og:image', card], ['twitter:image', card], ['og:url', `${SITE.siteOrigin}/shift/${shift.id}`],
    ] as const) {
      html = replaceMeta(html, key, value);
    }
  }
  return new Response(html, {
    status: shift ? 200 : 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate, no-transform',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}
