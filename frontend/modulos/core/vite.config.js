import { defineConfig as define_config } from "vite";
import react from "@vitejs/plugin-react";


// Defines the Vite host shared by every Bold frontend module.
export default define_config({
    cacheDir: ".vite-local",
    resolve: {
        dedupe: ["react", "react-dom", "lucide-react", "sweetalert2"]
    },
    optimizeDeps: {
        // Discover the lazy spreadsheet and its plugins before serving cached dependency URLs.
        entries: ["index.html", "sheets_grid.jsx", "sheets_locales.js"],
        include: ["@casualoffice/sheets/sheets", "@casualoffice/sheets/chrome", "@casualoffice/sheets/styles", "@univerjs/sheets-data-validation/facade", "@univerjs/sheets-table-ui"]
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
            ".pages.dev",
            ".bold.gt"
        ]
    },
    plugins: [
        react()
    ]
});
