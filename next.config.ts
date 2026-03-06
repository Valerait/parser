import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep these packages as server-only (not bundled by webpack)
  serverExternalPackages: ['cheerio', 'playwright-core', '@sparticuz/chromium'],
};

export default nextConfig;
