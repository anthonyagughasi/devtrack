import app from './_server.mjs';

export default function handler(req, res) {
  const rawUrl = req.url || '/api';
  const parsed = new URL(rawUrl, 'http://localhost');
  const capturedPath = parsed.searchParams.getAll('__vercel_path').join('/');
  parsed.searchParams.delete('__vercel_path');

  if (parsed.pathname === '/api/index' || parsed.pathname === '/api/index.mjs') {
    const normalizedSubPath = capturedPath.replace(/^\/+/, '');
    parsed.pathname = normalizedSubPath ? `/api/${normalizedSubPath}` : '/api';
  }

  const search = parsed.searchParams.toString();
  req.url = search ? `${parsed.pathname}?${search}` : parsed.pathname;

  return app(req, res);
}
