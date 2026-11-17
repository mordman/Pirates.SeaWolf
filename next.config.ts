import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Task 78+: превью-прокси песочницы (preview-chat-*.space-z.ai) грузит /_next/*
  // как cross-origin — разрешаем, иначе прокси/кэш рвут подгрузку чанков и HMR
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
