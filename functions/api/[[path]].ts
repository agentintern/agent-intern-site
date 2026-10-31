import type { Ctx, Env } from '../../src/worker/env';
import { handle } from '../../src/worker/index';

export const onRequest = (context: { request: Request; env: Env; waitUntil: Ctx['waitUntil'] }): Promise<Response> =>
  handle(context.request, context.env, { waitUntil: context.waitUntil.bind(context) });
