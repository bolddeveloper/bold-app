import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createServer} from "vite";
import config from "./vite.config.js";

test("development keeps the last complete transform during partial editor writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bold-dev-write-"));
    const source = path.join(root,"sample.js");
    await writeFile(source,"export const value = 1;");
    const server = await createServer({configFile:false,root,cacheDir:path.join(root,"cache"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:{port:0},watch:config.server.watch},appType:"custom"});
    try {
        await new Promise(resolve => server.watcher.once("ready",resolve));
        assert.match((await server.transformRequest("/sample.js")).code,/value = 1/);
        const changed = new Promise((resolve,reject) => {
            const timeout=setTimeout(()=>reject(new Error("No completed write was observed")),3000);
            server.watcher.on("change",file=>{if(path.resolve(file)===source){clearTimeout(timeout);resolve();}});
        });
        await writeFile(source,"");
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.match((await server.transformRequest("/sample.js")).code,/value = 1/);
        await writeFile(source,"export const value = 2;");
        await changed;
        let complete;
        for(let attempt=0;attempt<40;attempt++) {
            complete=(await server.transformRequest("/sample.js")).code;
            if(complete.includes("value = 2")) break;
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.match(complete,/value = 2/);
    } finally {
        await server.close();
        if(path.dirname(root)===path.resolve(os.tmpdir()) && path.basename(root).startsWith("bold-dev-write-")) await rm(root,{recursive:true,force:true});
    }
});
