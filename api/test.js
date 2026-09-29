export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      isVercel: !!process.env.VERCEL,
      nodeVersion: process.version
    }
  });
}
