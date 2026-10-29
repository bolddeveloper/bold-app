import assert from "node:assert/strict";
import test from "node:test";
import {appendImages, canReviseFailedImage, captionQueuedImage, MAX_IMAGE_QUEUE_BYTES, MAX_QUEUED_IMAGES, replaceQueuedImage,renewRejectedMedia} from "./image_queue_model.js";

const image = (name="foto.png", size=20) => ({name,type:"image/png",size});

test('definitive publication rejection renews the file nonce before editing; uncertain attempts remain immutable',()=>{
    const file=image(),item={id:'original',file,caption:'Conservar texto',attempted:true,attempt:{client_id:'original',body:'Texto bloqueado'}};
    let count=0;
    for(const status of [400,413,415,422]){
        const renewed=renewRejectedMedia(item,{status},()=>`new-${++count}`);
        assert.notEqual(renewed.id,item.id);assert.equal(renewed.file,file);assert.equal(renewed.caption,item.caption);
        assert.equal(renewed.attempted,false);assert.ok(!renewed.attempt);assert.ok(item.attempt);
    }
    for(const status of [0,409,429,500,undefined])assert.equal(renewRejectedMedia(item,{status},()=>{throw Error('cannot renew uncertain attempt');}),item);
});
test("image selection is atomic, ordered and bounded by count, file type, file size and total bytes", () => {
    let ids = 0; const rows = appendImages([], [image("uno.png"),image("dos.png")],()=>String(++ids));
    assert.deepEqual(rows.map(row=>row.file.name),["uno.png","dos.png"]);
    assert.deepEqual(rows.map(row=>row.id),["1","2"]);
    assert.throws(()=>appendImages(rows,[image(),{type:"image/svg+xml",size:3}],()=>{throw Error("must validate first");}),/PNG/);
    assert.throws(()=>appendImages([],Array(MAX_QUEUED_IMAGES+1).fill(image())),/10 imágenes/);
    assert.throws(()=>appendImages([],Array(6).fill(image("grande.png",MAX_IMAGE_QUEUE_BYTES/5))),/50 MB/);
    assert.throws(()=>appendImages([],[image("demasiado.png",11*1024*1024)]),/10 MB/);
    assert.equal(rows.length,2,"rejected additions do not change the original queue");
});
test("each image owns its caption and optional edited file; attempted payloads stay immutable", () => {
    const rows = appendImages([], [image(),image()], (()=>{let i=0; return()=>String(++i);})());
    const captioned = captionQueuedImage(rows,"1","Nota de la primera");
    assert.equal(captioned[0].caption,"Nota de la primera"); assert.equal(captioned[1].caption,"");
    const edited = replaceQueuedImage(captioned,"2",image("editada.webp"));
    assert.equal(edited[1].id,rows[1].id); assert.equal(edited[0],captioned[0]);
    const locked = edited.map(row=>({...row,attempted:true}));
    assert.throws(()=>replaceQueuedImage(locked,"1",image()),/Confirma primero/);
    assert.equal(captionQueuedImage(locked,"1","No cambiar")[0].caption,"Nota de la primera");
    assert.equal(captionQueuedImage(rows,"1","a".repeat(6000))[0].caption.length,5000);
});
test("only definite validation rejections unlock a failed image; unknown delivery keeps its id and payload", () => {
    for (const status of [400,413,415,422]) assert.ok(canReviseFailedImage({status}));
    for (const status of [undefined,403,409,429,500,503]) assert.equal(canReviseFailedImage({status}),false);
});
