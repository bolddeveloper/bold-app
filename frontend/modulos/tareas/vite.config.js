import { defineConfig as define_config } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";


// Defines the Vite setup for the Bold tasks PWA.
export default define_config({
    resolve: {
        dedupe: ["react", "react-dom", "lucide-react"]
    },
    server: {
        proxy: {
            "/api": "http://127.0.0.1:8000",
            "/ws": { target: "ws://127.0.0.1:8000", ws: true, headers: { Origin: "http://localhost:5173" } }
        },
        fs: {
            allow: [fileURLToPath(new URL("..", import.meta.url))]
        }
    },
    preview: {
        allowedHosts: [
            ".onrender.com"
        ]
    },
    plugins: [
        react()
    ]
});
