import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const dir=mkdtempSync(join(tmpdir(),'biliprism-appearance-')),EXT=resolve('dist');
const ctx=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--no-sandbox','--headless=new',`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`],viewport:{width:1440,height:1000},colorScheme:'light'});
mkdirSync('tests/artifacts',{recursive:true});
const results=[];
try{
  await installMocks(ctx);const sw=ctx.serviceWorkers()[0]??await ctx.waitForEvent('serviceworker');
  const patch=async p=>sw.evaluate(async p=>{const key='biliprism:settings',old=(await chrome.storage.local.get(key))[key]||{};await chrome.storage.local.set({[key]:{...old,...p,appearance:{...old.appearance,...p.appearance}}});},p);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await patch({theme:'dark'});await page.goto('https://www.bilibili.com/video/BVappearance/');
  await page.waitForFunction(()=>document.documentElement.dataset.marginTheme==='dark');
  await page.evaluate(()=>{
    const style=document.createElement('style');style.textContent=':root{--bg1:#fff;--text1:#18191c}.video-desc-container,.video-pod{background:#fff;color:#18191c}.video-title{color:#18191c}.video-info-detail{font:300 11px/1 monospace}';document.head.append(style);
    const host=document.querySelector('.left-container');
    host.insertAdjacentHTML('beforeend','<div class="video-info-detail">手机　看到 0:19 / 1:00</div><div class="video-desc-container"><p class="desc-info-text">清晰正文与视频简介</p></div><div class="video-pod">合集选集</div>');
    const bc=document.createElement('bili-comments'),root=bc.attachShadow({mode:'open'});root.innerHTML='<style>:host{--bg1:#fff;--text1:#18191c}#content{background:var(--bg1);color:var(--text1)}</style><div id="content">原生评论明暗适配</div>';document.getElementById('commentapp').append(bc);
    const rich=document.createElement('bili-rich-text'),rr=rich.attachShadow({mode:'open'});rr.innerHTML='<style>#contents{font:400 12px/1.4 serif}#contents span{font:400 11px serif}</style><div id="contents"><p><span>真实富文本正文</span></p></div>';root.append(rich);
  });
  const colors=()=>page.evaluate(()=>{const cs=s=>getComputedStyle(document.querySelector(s)),sr=document.querySelector('bili-comments').shadowRoot;
    const comment=getComputedStyle(sr.querySelector('#content')),meta=cs('.video-info-detail');
    return {canvas:cs('#app').backgroundColor,surface:cs('.video-desc-container').backgroundColor,pod:cs('.video-pod').backgroundColor,title:cs('.video-title').color,commentBg:comment.backgroundColor,commentColor:comment.color,meta:[meta.fontFamily,meta.fontSize,meta.fontWeight],video:cs('#bilibili-player').backgroundColor};});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('bili-comments').shadowRoot.querySelector('#content')).color==='rgb(236, 238, 242)');
  let c=await colors();assert.equal(c.surface,'rgb(30, 32, 37)');assert.equal(c.pod,c.surface);assert.equal(c.commentBg,c.surface);assert.equal(c.title,'rgb(236, 238, 242)');assert.equal(c.video,'rgb(0, 0, 0)');assert.ok(parseInt(c.meta[1])>=14);assert.equal(c.meta[2],'500');assert.doesNotMatch(c.meta[0],/monospace/);
  await page.screenshot({path:'tests/artifacts/watch-native-dark.png',fullPage:true});results.push({name:'强制暗色覆盖原生白底与评论本地变量，保留播放器黑色画布',c});
  await patch({theme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.marginTheme==='light');c=await colors();assert.equal(c.surface,'rgb(255, 255, 255)');assert.equal(c.title,'rgb(32, 33, 36)');assert.equal(c.commentColor,c.title);
  await patch({theme:'auto'});await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.marginTheme==='dark');assert.equal((await colors()).surface,'rgb(30, 32, 37)');
  await patch({appearance:{fontSize:18,fontWeight:600,lineHeight:2}});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.desc-info-text')).fontSize==='18px');
  c=await colors();assert.equal(c.meta[1],'17px');assert.equal(c.meta[2],'600');
  const rich=await page.locator('bili-rich-text #contents span').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.fontFamily];});
  assert.equal(rich[0],'18px');assert.equal(rich[1],'600');assert.doesNotMatch(rich[2],/(^|, )serif(,|$)/);
  assert.deepEqual(errors,[]);console.log('PASS 原生视频与评论深浅色、跟随系统、字号字重实时切换、视频画布保留');
  writeFileSync('tests/artifacts/appearance-results.json',JSON.stringify(results,null,2));
}finally{await ctx.close();rmSync(dir,{recursive:true,force:true});}
