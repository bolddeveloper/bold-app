import { defineConfig as define_config } from "vite";
import react from "@vitejs/plugin-react";


// Defines the Vite setup for the Bold tasks PWA.
export default define_config({
    preview: {
        allowedHosts: [
            ".onrender.com"
        ]
    },
    plugins: [
        react()
    ]
});
