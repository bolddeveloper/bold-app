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
test("media stages via authenticated multipart and publishes JSON before private downloads", async () => {
    const calls = [], api = createMessagingApi({request:async (path,options)=>{
        calls.push([path,options]);
        if(path.includes('/uploads/?'))return {results:[]};
        if(path.endsWith('/uploads/'))return {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',client_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',state:'ready'};
        return {};
    }});
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await api.sendMedia(id,"",id,new File(["audio"],"voice.webm",{type:"audio/webm"}));
    assert.ok(calls[1][1].body instanceof FormData);
    assert.equal(calls[1][1].body.get("client_id"), id);
    assert.equal(calls[1][1].body.get("file").type, "audio/webm");
    assert.deepEqual(calls[2][1].body,{client_id:id,body:'',upload_id:id});
    await api.media(id,id);
    assert.equal(calls[3][1].responseType,"blob");
    assert.match(calls[3][0], /messages\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/media\/$/);
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
test("text bubbles restore their earlier width and reduce height without changing composer or image bubbles", () => {
    const css = readFileSync(new URL("./messaging.css",import.meta.url),"utf8");
    const rules = selector => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim()===selector).map(match=>match[2]);
    const text = rules(".messaging_bubble:not(:has(.messaging_media))");
    assert.match(text[0],/max-width: min\(78%,660px\)/);
    assert.match(text[0],/padding: 6px 16px/);
    assert.match(text[0],/border-radius: 18px 18px 18px 8px/);
    assert.match(rules(".messaging_mine .messaging_bubble:not(:has(.messaging_media))")[0],/border-radius: 18px 18px 8px 18px/);
    assert.match(text[0],/grid-template-columns: minmax\(0,1fr\) auto/);
    assert.doesNotMatch(text[0],/(?:^|;)\s*(?:max-|min-)?height:/,"text must grow, never be clipped");
    assert.match(text[1],/max-width: calc\(100% - 34px\)/,"mobile keeps its earlier responsive width");
    assert.match(text[1],/padding-inline: 14px/);
    assert.match(rules(".messaging_bubble:has(.messaging_media_image)")[0],/max-width: min\(72%, 300px\)/);
    assert.match(rules(".messaging_bubble:has(.messaging_media_image)")[1],/280px/);
    assert.match(rules(".messaging_composer")[0],/max-width: 760px/);
    assert.match(rules(".messaging_composer textarea")[0],/min-height: 40px/);
    assert.match(rules(".messaging_bubble header button").at(-1),/min-height: 44px/);
});
test("audio bubbles use two compact rows without shrinking playback or speed touch targets", () => {
    const css = readFileSync(new URL("./messaging.css",import.meta.url),"utf8");
    const rules = selector => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim()===selector).map(match=>match[2]);
    const bubble=rules(".messaging_bubble:has(.messaging_media_audio)");
    assert.match(bubble[0],/width: 360px/); assert.match(bubble[1],/width: 340px/);
    assert.ok(bubble.every(rule=>/max-width: (?:min\(100%,360px\)|100%)/.test(rule)));
    assert.ok(bubble.every(rule=>/padding: 6px 10px/.test(rule)));
    assert.match(rules(".messaging_bubble:has(.messaging_media_audio) > footer")[0],/grid-row: 1/);
    assert.match(rules(".messaging_bubble:has(.messaging_media_audio) > .messaging_media_audio")[0],/grid-row: 2; margin: 0/);
    assert.match(rules(".messaging_audio")[0],/44px minmax\(0,1fr\) 44px 40px/);
    assert.match(rules(".messaging_waveform")[0],/height: 28px/);
    assert.match(rules(".messaging_waveform input")[0],/height: 44px/);
    assert.match(rules(".messaging_module .messaging_audio button")[0],/min-width: 44px; min-height: 44px/);
    assert.doesNotMatch(bubble.join(""),/(?:^|;)\s*(?:max-|min-)?height:|overflow:\s*hidden/,"captions, long names and errors can still grow");
});

test("the native audio slider stays invisible even under the dark disabled-control rule", () => {
    const css = readFileSync(new URL("./messaging.css",import.meta.url),"utf8");
    const theme = readFileSync(new URL("../tareas/src/theme_rework.css",import.meta.url),"utf8");
    assert.match(theme,/\.theme_dark :is\(input, textarea, select, button\):disabled\s*\{\s*opacity: \.65/);
    // These scoped selectors have higher specificity than the shared theme's
    // disabled rule, independently of stylesheet loading order. No !important.
    assert.match(css,/\.messaging_audio \.messaging_waveform input\[type="range"\], \.messaging_audio \.messaging_waveform input\[type="range"\]:disabled \{opacity: 0; appearance: none; background: transparent; border: 0; padding: 0;/);
    assert.match(css,/\.messaging_waveform:has\(input:focus-visible\) \{outline: 2px/);
    assert.match(css,/\.messaging_waveform input \{[^}]*height: 44px/);
});

test("chat palettes separate canvas and bubbles with readable text, metadata and links in both themes", () => {
    const css = readFileSync(new URL("./messaging.css",import.meta.url),"utf8");
    const luminance = hex => {
        const rgb = hex.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16)/255).map(value=>value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
        return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
    };
    const contrast = (a,b) => {const values=[luminance(a),luminance(b)].sort((x,y)=>y-x); return (values[0]+.05)/(values[1]+.05);};
    for (const selector of [".messaging_module", ".theme_dark .messaging_module"]) {
        const declarations = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match=>match[1].trim()===selector)[2];
        const palette = Object.fromEntries([...declarations.matchAll(/--chat_(\w+):\s*(#[a-f\d]{6})/gi)].map(match=>[match[1],match[2]]));
        assert.notEqual(palette.received,palette.sent);
        for (const [background, prefix] of [[palette.received,""],[palette.sent,"sent_"]]) {
            for (const name of ["ink","meta","link"]) assert.ok(contrast(background,palette[prefix+name])>=4.5,`${selector}: ${prefix+name} on ${background}`);
            assert.ok(contrast(background,palette[prefix+"read"])>=3,"read rings remain distinguishable");
            assert.ok(contrast(background,palette[prefix+"wave"])>=3,"voice progress track remains distinguishable");
            assert.ok(contrast(background,palette.canvas)>1.15,"bubble surface separates from the chat canvas");
        }
        assert.ok(contrast(palette.sent,palette.sent_accent)>=3,"outgoing audio accent remains visible on crimson");
    }
    assert.match(css,/background-color: var\(--chat_canvas\)/);
    assert.match(css,/background: var\(--chat_received\); color: var\(--chat_ink\)/);
    assert.match(css,/\.messaging_mine \.messaging_bubble \{[^}]+background: var\(--chat_sent\)/);
    for (const name of ["ink","meta","link","read","wave"]) assert.ok(css.includes(`--chat_${name}: var(--chat_sent_${name})`),`own bubbles must use their ${name} contrast token`);
    assert.match(css,/\.messaging_mine \.messaging_audio_play \{color: var\(--chat_ink\)/);
});
