import { createApp } from '../server/app.js';
import { migrate } from '../server/db.js';

let appInstance: any;
let migratePromise: Promise<void> | null = null;

async function getApp() {
  if (!migratePromise) {
    migratePromise = migrate().catch(err => {
      console.error('[Vercel Serverless] Auto-migration error:', err);
    });
  }
  await migratePromise;

  if (!appInstance) {
    appInstance = createApp();
  }
  return appInstance;
}

export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err: any) {
    console.error('[Vercel Serverless] Handler error:', err);
    res.status(500).json({
      error: 'Vercel Serverless Function Error',
      message: err?.message || String(err),
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      isVercel: !!process.env.VERCEL
    });
  }
}
