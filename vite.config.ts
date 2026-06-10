import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "apple-touch-icon-180.png",
        "pwa-192.png",
        "pwa-512.png",
        "maskable-512.png",
        "samples/fictitious_questions.csv"
      ],
      manifest: {
        id: ".",
        lang: "ja",
        name: "ICU MCQ",
        short_name: "ICU MCQ",
        description: "個人利用・ローカル完結の集中治療科専門医試験MCQ学習PWA",
        theme_color: "#0f766e",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,csv,webmanifest}"]
      }
    })
  ]
});
