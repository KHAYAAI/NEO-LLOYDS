/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enables a minimal, self-contained server bundle for containerised
  // deployment (infrastructure/aws) -- see each portal's Dockerfile.
  output: 'standalone',
};

export default nextConfig;
