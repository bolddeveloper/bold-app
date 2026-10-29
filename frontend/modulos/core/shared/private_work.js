// Features register protection work without making Core import their modules.
const protectors=new Set();
export function registerPrivateWork(protect){protectors.add(protect);return ()=>protectors.delete(protect);}
export async function protectPrivateWork({timeoutMs=5000}={}){
    let timer;
    try{return await Promise.race([
        Promise.all([...protectors].map(async protect=>{try{return await protect()===true;}catch{return false;}})).then(results=>results.every(Boolean)),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);}),
    ]);}finally{clearTimeout(timer);}
}
