import {test} from "node:test";
import assert from "node:assert/strict";
import {hsvToHex,hexToHsv,avatarRect} from "./image_controls.js";
test("HEX preserves primary, neutral and preset colors through HSV",()=>{for(const color of ["#ff0000","#00ff00","#0000ff","#ffffff","#000000","#7cabdd","#813782"]) assert.equal(hsvToHex(...hexToHsv(color)),color);});
test("avatar crop remains within source at all zoom and drag boundaries",()=>{for(const [w,h] of [[800,400],[400,800],[256,256]])for(const zoom of [1,2,4])for(const x of [-2,0,2])for(const y of [-2,0,2]){const [left,top,width,height]=avatarRect(w,h,{zoom,x,y});assert(left>=0&&top>=0&&left+width<=w&&top+height<=h);assert.equal(width,height);}assert.deepEqual(avatarRect(800,400),[200,0,400,400]);});
