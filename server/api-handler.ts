import { createApp } from './app.js';
import { migrate } from './db.js';

let app: any;
let startupError: any = null;

try {
  app = createApp();
  migrate().catch(err => {
    console.warn('[Vercel Serverless] Auto-migration notice:', err?.message || err);
  });
} catch (e: any) {
  startupError = e;
  console.error('[Vercel Serverless] Startup error:', e);
}

export default function handler(req: any, res: any) {
  if (startupError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Serverless initialization failed',
      message: startupError.message || String(startupError),
      stack: startupError.stack
    }));
  }
  return app(req, res);
}
