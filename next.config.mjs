/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Document Management System writes uploaded files into ./storage. That
  // folder is inside the project, so exclude it from the dev file-watcher —
  // otherwise every upload would trigger a needless recompile / reload.
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: ["**/node_modules/**", "**/.next/**", "**/storage/**"],
    };
    return config;
  },
};

export default nextConfig;
