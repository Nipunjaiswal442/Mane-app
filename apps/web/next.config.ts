import type { NextConfig } from 'next';
import path from 'node:path';
const apiOrigin = process.env.API_URL || 'http://127.0.0.1:4000';
const config: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@mane/product-config', '@mane/shared'],
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/socket.io', destination: `${apiOrigin}/socket.io/` },
      { source: '/api/:path*', destination: `${apiOrigin}/:path*` },
      { source: '/socket.io/:path*', destination: `${apiOrigin}/socket.io/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
