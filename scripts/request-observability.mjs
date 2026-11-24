import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

// Query strings, cookies, payloads and account names never enter these records.
export function createRequestTrace(incoming, {logger = console, version = 'development', slowMs = 1500, logAll = false, now = () => performance.now()} = {}) {
  const id = randomUUID(), started = now();
  let pathname = '/invalid', finished = false;
  try { pathname = new URL(incoming.url || '/', 'http://localhost').pathname.slice(0, 256); } catch {}
  const base = {requestId: id, method: String(incoming.method || 'GET').slice(0, 12), path: pathname, version: String(version).slice(0, 16)};
  return {
    id,
    headers(source = {}) {
      const headers = new Headers(source);
      headers.set('x-request-id', id); headers.set('x-ouvrane-version', base.version);
      const timing = 'app;dur=' + Math.max(0, now() - started).toFixed(1);
      headers.set('server-timing', [headers.get('server-timing'), timing].filter(Boolean).join(', '));
      return headers;
    },
    finish(status, {error, stopping = false} = {}) {
      if (finished) return; finished = true;
      const durationMs = Math.round(Math.max(0, now() - started));
      const record = {...base, status, durationMs, stopping, ...(error ? {errorName: String(error.name || 'Error').slice(0, 80)} : {})};
      if (error || status >= 500) logger.error?.('ouvrane.request', record);
      else if (durationMs >= slowMs) (logger.warn || logger.log)?.call(logger, 'ouvrane.request.slow', record);
      else if (logAll) logger.log?.('ouvrane.request', record);
      return record;
    }
  };
}
