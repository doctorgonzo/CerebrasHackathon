import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS project. There's a stray package-lock.json
  // in the home directory, so Next would otherwise infer ~/ as the root and
  // make `next dev` watch the entire home folder — pegging CPU/memory
  // ("compiling forever" + machine freeze). This scopes file-watching to the
  // project.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
