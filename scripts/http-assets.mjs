import {createHash} from 'node:crypto';
import {gzip, brotliCompress, constants} from 'node:zlib';
import {promisify} from 'node:util';

const gzipAsync = promisify(gzip), brotliAsync = promisify(brotliCompress);
// Only successful static responses, after dispatch/authentication. Never cache API bodies.
const encodedAssets = new Map();
const MAX_ASSETS = 96, MAX_BYTES = 32 * 1024 * 1024;
let cachedBytes = 0;
const header = (request, name) => request.headers?.get?.(name) ?? request.headers?.[name] ?? '';
function encodingFor(request) {
  const qualities = new Map(String(header(request, 'accept-encoding')).toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';');
    const raw = parameters.find(item => item.trim().startsWith('q='));
    const value = raw ? Number(raw.trim().slice(2)) : 1;
    return [name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0];
  }));
  const q = name => qualities.get(name) ?? qualities.get('*') ?? 0;
  return q('br') > 0 && q('br') >= q('gzip') ? 'br' : q('gzip') > 0 ? 'gzip' : '';
}
function varyEncoding(headers) {
  const values = String(headers.get('vary') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!values.some(value => value.toLowerCase() === 'accept-encoding') && !values.includes('*')) values.push('Accept-Encoding');
  headers.set('vary', values.join(', '));
}
const compress = (bytes, encoding) => encoding === 'br'
  ? brotliAsync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 4}})
  : gzipAsync(bytes);
function trimCache() {
  while (encodedAssets.size > MAX_ASSETS || cachedBytes > MAX_BYTES) {
    const first = encodedAssets.keys().next().value;
    if (first === undefined) break;
    cachedBytes -= encodedAssets.get(first).size;
    encodedAssets.delete(first);
  }
}
async function encoded(asset, encoding, digest) {
  if (!encoding) return asset.bytes;
  if (!asset[encoding]) {
    asset[encoding] = compress(asset.bytes, encoding).then(bytes => {
      if (encodedAssets.get(digest) === asset) {
        asset.size += bytes.length; cachedBytes += bytes.length; trimCache();
      }
      return bytes;
    }).catch(error => { delete asset[encoding]; throw error; });
  }
  return asset[encoding];
}
export async function compressTextResponse(request, response) {
  if (!['GET', 'HEAD'].includes(request.method) || response.status !== 200) return response;
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!/^(?:application\/json|text\/html|text\/plain|image\/svg\+xml)\b/.test(type) || response.headers.get('content-encoding')) return response;
  const encoding = encodingFor(request);
  if (!encoding || request.method === 'HEAD') return response;
  const bytes = Buffer.from(await response.arrayBuffer()), headers = new Headers(response.headers);
  if (bytes.length < 1024) return new Response(bytes, {status: response.status, headers});
  const body = await compress(bytes, encoding);
  varyEncoding(headers);
  headers.set('content-encoding', encoding); headers.set('content-length', String(body.length));
  return new Response(body, {status: response.status, headers});
}
export async function prepareAssetResponse(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (!['GET', 'HEAD'].includes(request.method) || response.status !== 200 || path.startsWith('/api/') || path.startsWith('/auth/') || !/\.(?:js|mjs|css)$/.test(path) || !/^(?:application\/(?:java|ecma)script|text\/(?:css|javascript))\b/.test(response.headers.get('content-type') || '') || response.headers.get('content-encoding')) return response;
  const encoding = encodingFor(request), headers = new Headers(response.headers);
  const trustedDigest = headers.get('x-ouvrane-asset-sha256');
  headers.delete('x-ouvrane-asset-sha256');
  let digest = /^[a-f0-9]{64}$/.test(trustedDigest || '') ? trustedDigest : '';
  let asset = digest ? encodedAssets.get(digest) : null;
  // A bodyless upstream HEAD must never populate a digest cache with empty bytes.
  if (request.method === 'HEAD' && !response.body && !asset) return new Response(null, {status: response.status, headers});
  if (asset) {
    encodedAssets.delete(digest); encodedAssets.set(digest, asset);
    await response.body?.cancel();
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    digest ||= createHash('sha256').update(bytes).digest('hex');
    asset = encodedAssets.get(digest);
    if (!asset) {
      asset = {bytes, size: bytes.length}; encodedAssets.set(digest, asset);
      cachedBytes += bytes.length; trimCache();
    }
  }
  const etag = '"' + digest + '-' + (encoding || 'identity') + '"';
  headers.set('cache-control', 'private, max-age=0, must-revalidate');
  varyEncoding(headers); headers.set('etag', etag);
  if (String(header(request, 'if-none-match')).split(',').map(value => value.trim()).some(value => value === etag || value === 'W/' + etag || value === '*')) {
    headers.delete('content-length'); headers.delete('content-encoding');
    return new Response(null, {status: 304, headers});
  }
  const body = await encoded(asset, encoding, digest);
  if (encoding) headers.set('content-encoding', encoding);
  headers.set('content-length', String(body.length));
  return new Response(request.method === 'HEAD' ? null : body, {status: 200, headers});
}
