import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  /* config options here */
  transpilePackages: ['@icon-park/react'],
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  devIndicators: {
  },
  allowedDevOrigins: [
    'https://6000-firebase-studio-1761782845873.cluster-ikslh4rdsnbqsvu5nw3v4dqjj2.cloudworkstations.dev',
    '10.14.0.2'
  ]
};

export default nextConfig;
