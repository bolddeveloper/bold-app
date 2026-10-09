import { defineConfig as define_config } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function pwa_release() {
    return {name: "bold-pwa-release", generateBundle(_, bundle) {
        const template = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");
        const files = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name)).sort();
        const hash = createHash("sha256").update(template);
        for (const file of ["./index.html", "./public/icon.svg", "./public/manifest.webmanifest"])
            hash.update(readFileSync(new URL(file, import.meta.url)));
        for (const name of files) hash.update(name).update(bundle[name].code ?? bundle[name].source);
        this.emitFile({type: "asset", fileName: "sw.js", source: template
            .replace("__BOLD_PWA_RELEASE__", hash.digest("hex").slice(0, 16))
            .replace("/* BUILD_ASSETS */", files.map(name => JSON.stringify("/" + name)).join(","))});
    }};
}


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
            ".pages.dev",
            ".bold.gt"
        ]
    },
    plugins: [
        react(),
        pwa_release()
    ]
});
