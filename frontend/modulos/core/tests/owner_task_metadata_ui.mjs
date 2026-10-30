import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {createServer} from "vite";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
const server=await createServer({configFile:false,resolve:{dedupe:["react","react-dom"]},
    esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-owner-task-metadata-ui"),
    optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
try{
    const {OwnerNotice}=await server.ssrLoadModule(`/@fs/${path.resolve("shared/owner_notice.jsx").replaceAll("\\","/")}`);
    assert.match(renderToStaticMarkup(React.createElement(OwnerNotice,{notification:{actor_is_owner:true}})),/>Propietario</);
    for(const notification of [{actor_is_owner:false},{actor_is_owner:"true"},{actor_name:"Luis",metadata:{actor_is_owner:true}},{}])
        assert.equal(renderToStaticMarkup(React.createElement(OwnerNotice,{notification})),"");
    const {TaskCreatedAt}=await server.ssrLoadModule(`/@fs/${path.resolve("../tareas/src/task_created_at.jsx").replaceAll("\\","/")}`);
    const shown=renderToStaticMarkup(React.createElement(TaskCreatedAt,{value:"2026-10-30T15:45:23Z"}));
    assert.match(shown,/Creada el/);assert.match(shown,/<time dateTime="2026-10-30T15:45:23.000Z"/);
    assert.match(renderToStaticMarkup(React.createElement(TaskCreatedAt,{})),/Fecha de creación no disponible/);
    console.log("Owner origin: strict server boolean only; permanent original creation timestamp and unavailable fallback passed.");
}finally{await server.close();}
