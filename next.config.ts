import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Allow longer streaming responses
  },
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
