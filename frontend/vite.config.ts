import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      "/chat": "http://localhost:8000",
      "/health": "http://localhost:8000",
      "/sessions": "http://localhost:8000",
      "/ws/speech": {
        target: "ws://localhost:8000",
        ws: true
      },
      "/ws/tts": {
        target: "ws://localhost:8000",
        ws: true
      }
    }
  }
});
