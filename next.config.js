/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { allowedOrigins: ['*'] } },
  // Tekmetric tokens last 24h - keep server-only.
  // Long-running data pulls happen in route handlers; keep timeouts generous.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};
module.exports = nextConfig;
