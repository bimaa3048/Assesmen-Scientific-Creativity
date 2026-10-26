/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./db/schema.sql'],
  },
};

module.exports = nextConfig;
