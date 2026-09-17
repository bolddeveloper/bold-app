import { defineConfig as define_config } from "vite";
import react from "@vitejs/plugin-react";


// Defines the Vite host shared by every Bold frontend module.
export default define_config({
    resolve: {
        dedupe: ["react", "react-dom", "lucide-react", "sweetalert2"]
    },
    server: {
        port: 5174,
        strictPort: true,
        proxy: {
            "/api": "http://127.0.0.1:8000",
            "/ws": { target: "ws://127.0.0.1:8000", ws: true, headers: { Origin: "http://localhost:5174" } }
        },
        fs: {
            allow: [".."]
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
