import { defineConfig as define_config } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";


// Defines the Vite setup for the Bold tasks PWA.
export default define_config({
    resolve: {
        dedupe: ["react", "react-dom", "lucide-react"]
    },
    server: {
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
