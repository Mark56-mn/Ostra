/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-side only secrets are read in route handlers / the agent runtime,
  // never bundled into the client. No env vars are exposed via `env`/`publicRuntimeConfig`.
};

export default nextConfig;
