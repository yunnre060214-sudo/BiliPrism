import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const dir=mkdtempSync(join(tmpdir(),'biliprism-moments-')),EXT=resolve('dist');
const ctx=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--no-sandbox','--headless=new',`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`],viewport:{width:1440,height:1000}});
mkdirSync('tests/artifacts',{recursive:true});
try{
  await installMocks(ctx);const sw=ctx.serviceWorkers()[0]??await ctx.waitForEvent('serviceworker');
  const patch=async p=>sw.evaluate(async p=>{const key='biliprism:settings',old=(await chrome.storage.local.get(key))[key]||{};await chrome.storage.local.set({[key]:{...old,...p,moments:{...old.moments,...p.moments}}});},p);
  await patch({moments:{autoLoad:false}});
  let calls=0;
  const item=(id,type,mid,text,orig)=>({id_str:id,type,orig,modules:{module_author:{mid,name:'UP'+mid,pub_ts:1000,face:''},module_stat:{},module_dynamic:{desc:{text},major:type==='DYNAMIC_TYPE_AV'?{archive:{bvid:'BV'+id,title:'视频 '+id,cover:'',duration_text:'1:00'}}:type==='DYNAMIC_TYPE_DRAW'?{draw:{items:[{src:'https://i0.hdslb.com/test.png'}]}}:{}}}});
  const posts=[item('1','DYNAMIC_TYPE_AV',1,'视频正文'),item('2','DYNAMIC_TYPE_DRAW',2,'图片正文'),item('3','DYNAMIC_TYPE_FORWARD',3,'转发',item('30','DYNAMIC_TYPE_WORD',4,'隐藏词广告'))];
  await ctx.route('**/x/polymer/web-dynamic/v1/feed/all?**',route=>{
    calls++;const offset=new URL(route.request().url()).searchParams.get('offset');
    return route.fulfill({json:{code:0,data:{items:offset?[item('4','DYNAMIC_TYPE_WORD',2,'第二页正文')]:posts,offset:offset?'':'next',has_more:!offset}},headers:{'access-control-allow-origin':'https://t.bilibili.com','access-control-allow-credentials':'true'}});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://t.bilibili.com/');await page.locator('.moment-card').first().waitFor();
  assert.equal(await page.locator('.moment-card').count(),3);assert.equal(calls,1);
  const columns=()=>page.locator('.moments-grid').evaluate(el=>getComputedStyle(el).columnCount);
  assert.equal(await columns(),'2');
  await page.getByRole('button',{name:'加载更多',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelectorAll('.moment-card').length===4);assert.equal(calls,2);
  await patch({moments:{hideReposts:true,hideVideo:true}});await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelectorAll('.moment-card').length===2);
  await patch({moments:{hideReposts:false,hideVideo:false,keywords:['隐藏词']}});await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelectorAll('.moment-card').length===3);
  await patch({moments:{keywords:[],wantedUsers:['2']}});
  await page.getByRole('button',{name:'特别关注',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelectorAll('.moment-card').length===2);
  assert.equal(await page.locator('.moment-card[data-id="2"]').count(),1);assert.equal(await page.locator('.moment-card[data-id="4"]').count(),1);
  await page.getByRole('button',{name:'特别关注',exact:true}).click();
  await page.locator('.moment-card[data-id="1"] summary').click();
  await page.locator('.moment-card[data-id="1"]').getByRole('button',{name:'屏蔽该 UP 主',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('margin-root').shadowRoot.querySelector('.moment-card[data-id="1"]'));
  await patch({moments:{blockedUsers:[],columns:1,showProfile:false,showLive:false,showHot:false,openInNewTab:false}});
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('margin-root').shadowRoot.querySelector('.moments-grid')).columnCount==='1');
  assert.equal(await page.locator('.fd-left').isVisible(),false);assert.equal(await page.locator('.fd-right').isVisible(),false);
  assert.equal(await page.locator('.moment-card a').first().getAttribute('target'),'_self');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'设置',exact:true});
  await settings.getByLabel('搜索设置').fill('字号');
  assert.equal(await settings.getByLabel('正文字号',{exact:true}).isVisible(),true);
  assert.equal(await settings.getByLabel('动态卡片列数',{exact:true}).isVisible(),false);
  await settings.getByLabel('正文字号',{exact:true}).selectOption('18');
  await settings.getByRole('button',{name:'关闭',exact:true}).click();
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('margin-root').shadowRoot.querySelector('.dy-text')).fontSize==='18px');
  console.log('PASS 动态双列、手动分页、类型/原文过滤、特别关注、屏蔽、侧栏及设置搜索与实时字号');
  await patch({moments:{columns:2,showProfile:true,showLive:true,showHot:true},theme:'light'});
  for(const theme of ['light','dark']){
    await patch({theme});await page.waitForTimeout(200);
    await page.screenshot({path:`tests/artifacts/moments-${theme}.png`,fullPage:true});
  }
  for(const width of [1920,1440,1024,760,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
    const metrics=await page.locator('.moments-layout').evaluate(el=>({width:el.getBoundingClientRect().width,overflow:el.scrollWidth-el.clientWidth,viewport:innerWidth}));
    assert.ok(metrics.overflow<3,JSON.stringify({width,...metrics}));
    assert.equal(await columns(),width<=1000?'1':'2');
  }
  // Settings are independent of page lifetime and migrate when next loaded.
  await page.reload();await page.locator('.moment-card').first().waitFor();
  assert.equal(await page.locator('.dy-text').first().evaluate(el=>getComputedStyle(el).fontSize),'18px');
  assert.deepEqual(errors,[]);
  writeFileSync('tests/artifacts/moments-results.json',JSON.stringify({ok:true,calls,widths:[1920,1440,1024,760,390]},null,2));
  console.log('PASS 动态响应式无溢出与设置持久化');
}finally{await ctx.close();rmSync(dir,{recursive:true,force:true});}
