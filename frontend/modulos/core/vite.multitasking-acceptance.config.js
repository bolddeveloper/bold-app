// Production build and real SW, but only against the isolated localhost profile.
import config from "./vite.config.js";
import path from "node:path";
const root = process.env.BOLD_MULTITASKING_ACCEPTANCE_DIR;
const parent = path.resolve(process.env.LOCALAPPDATA || "", "BOLDApp", "validation");
if (!root || path.dirname(path.resolve(root)) !== parent || !/^pwa-multitasking-[a-f0-9]{32}$/.test(path.basename(root))) throw Error("Prepare the owned browser acceptance profile first.");
export default {...config,
    define: {...config.define, "import.meta.env.VITE_USE_REAL_BACKEND": JSON.stringify("true"), "import.meta.env.VITE_API_BASE_URL": JSON.stringify("")},
    build: {...config.build, outDir: path.join(root, "frontend"), emptyOutDir: false},
    preview: {...config.preview, host: "127.0.0.1", port: 5195, strictPort: true,
        proxy: {"/api": "http://127.0.0.1:8165", "/ws": {target: "ws://127.0.0.1:8165", ws: true, headers: {Origin: "http://127.0.0.1:5195"}}}},
};
