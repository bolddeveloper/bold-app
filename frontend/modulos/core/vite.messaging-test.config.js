// Local two-account sandbox. Does not change the normal dev/prod proxy.
import config from "./vite.config.js";

export default {...config, server: {...config.server, host: "127.0.0.1", port: 5186, strictPort: true,
    proxy: {"/api": "http://127.0.0.1:8156", "/ws": {target: "ws://127.0.0.1:8156", ws: true, headers: {Origin: "http://localhost:5186"}}}}};
