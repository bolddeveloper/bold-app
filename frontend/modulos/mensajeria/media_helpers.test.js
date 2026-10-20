import assert from "node:assert/strict";
import test from "node:test";
import {audioTime, cropRect, imageFileError, MAX_CHAT_FILE, mediaPreview, recordingMime, waveformPeaks} from "./media_helpers.js";
import {createMessagingApi} from "./messaging_api.js";
import {readFileSync} from "node:fs";

test("camera crop cannot exceed bounds and image uploads reject SVG or oversize", () => {
    assert.deepEqual(cropRect(1000,500,{x:90,y:90,w:90,h:90}), [900,450,100,50]);
    assert.match(imageFileError({type:"image/svg+xml",size:1}), /PNG/);
    assert.match(imageFileError({type:"image/png",size:MAX_CHAT_FILE+1}), /10 MB/);
    assert.equal(imageFileError({type:"image/webp",size:10}), "");
    assert.equal(mediaPreview({media:{kind:"audio"}}), "Nota de voz");
});
test("recording negotiates a supported audio container, with a safe unsupported fallback", () => {
    assert.equal(recordingMime({isTypeSupported:type=>type==="audio/mp4"}), "audio/mp4");
    assert.equal(recordingMime({isTypeSupported:()=>false}), "");
});
test("voice time and waveform handle silence, missing duration and short buffers without inventing peaks", () => {
    assert.equal(audioTime(Infinity), "0:00"); assert.equal(audioTime(NaN), "0:00");
    assert.equal(audioTime(-1), "0:00"); assert.equal(audioTime(83.9), "1:23");
    assert.deepEqual(waveformPeaks(new Float32Array(100)), Array(32).fill(.12));
    assert.deepEqual(waveformPeaks(new Float32Array([0,.5,0,1]), 4), [.12,.5,.12,1]);
    assert.equal(waveformPeaks(new Float32Array()).length,32);
});
test("media uses authenticated multipart and nested, validated private download routes", async () => {
    const calls = [], api = createMessagingApi({request:async (...args)=>calls.push(args)});
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await api.sendMedia(id,"",id,new File(["audio"],"voice.webm",{type:"audio/webm"}));
    assert.ok(calls[0][1].body instanceof FormData);
    assert.equal(calls[0][1].body.get("client_id"), id);
    assert.equal(calls[0][1].body.get("file").type, "audio/webm");
    await api.media(id,id);
    assert.equal(calls[1][1].responseType,"blob");
    assert.match(calls[1][0], /messages\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/media\/$/);
    assert.throws(()=>api.media(id,"../../admin"));
});
test("dark shadows do not derive from white text; motion and mobile preserve reduced-motion and touch sizing", () => {
    const css = readFileSync(new URL("./messaging.css",import.meta.url),"utf8");
    assert.doesNotMatch(css,/--chat_shadow:\s*color-mix/);
    assert.match(css,/\.theme_dark \.messaging_module \{--chat_shadow: rgb\(0 0 0/);
    assert.match(css,/transition: grid-template-columns 220ms/);
    assert.match(css,/\.messaging_arriving \{animation: messaging_arrive 180ms/);
    assert.match(css,/@media \(prefers-reduced-motion: reduce\).*\.messaging_arriving \{animation: none;/s);
    assert.match(css,/var\(--chat_vh,100dvh\)/);
});
