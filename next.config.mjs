import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces .next/standalone with a self-contained server, so the published
  // package does not need `next` (or React) as a runtime dependency.
  output: 'standalone',
  // A package-lock.json in the parent folder makes Next infer the wrong
  // workspace root. Pin it to this project.
  outputFileTracingRoot: here,
  // better-sqlite3 is a native module: keep it external to the server bundle.
  serverExternalPackages: ['better-sqlite3'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
