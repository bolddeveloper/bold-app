// Real-provider acceptance only after independently authorizing test Google.
// No production proxy and no change to ordinary development/build configuration.
import config from "./vite.config.js";
export default {...config,define:{...config.define,
    "import.meta.env.VITE_USE_REAL_BACKEND":JSON.stringify("true"),
    "import.meta.env.VITE_API_BASE_URL":JSON.stringify("")},
    server:{...config.server,host:"127.0.0.1",port:5193,strictPort:true,
        proxy:{"/api":"http://127.0.0.1:8160","/ws":{target:"ws://127.0.0.1:8160",ws:true,headers:{Origin:"http://localhost:5193"}}}}};
