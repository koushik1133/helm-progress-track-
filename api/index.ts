import { createApp } from '../server/app.js';
import { migrate } from '../server/db.js';

// Run background auto-migration on cold start
migrate().catch(err => {
  console.warn('[Vercel Serverless] Auto-migration notice:', err?.message || err);
});

const app = createApp();

export default app;
