import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('work/book-qa',{recursive:true});
const require=createRequire(import.meta.url);const {chromium}=require(process.env.BOOK_PLAYWRIGHT_MODULE || 'playwright');
const base=process.argv[2] || 'http://localhost:3027';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(base+'/student/books/demo');
 await page.locator('.storybook-stage.format-squarebook-hc').waitFor({timeout:60000});
 const first=page.url();
 assert.equal(await page.locator('.storybook-format-switcher,.storybook-inspector-formats').count(),0);
 for(const [width,height] of [[320,568],[390,844],[844,390],[1440,1000]]){
  await page.setViewportSize({width,height});
  const box=await page.locator('.storybook-stage').boundingBox();assert.ok(Math.abs(box.width/box.height-243/248)<.001,JSON.stringify(box));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`work/book-qa/fixed-${width}.png`,fullPage:true});
 }
 await page.goto(base+'/student/books');
 assert.equal(await page.locator('.storybook-new-book button').count(),1);
 await page.getByRole('button',{name:'새 그림책 만들기'}).click();
 await page.locator('.storybook-stage.format-squarebook-hc').waitFor();assert.notEqual(page.url(),first);
 await page.getByRole('button',{name:'미리보기',exact:true}).click();
 await page.locator('.storybook-stage.preview').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished))); const box=await page.locator('.storybook-stage.preview').boundingBox();assert.ok(Math.abs(box.width/box.height-243/248)<.001);
 console.log('PASS: demo/API legacy request fixed, one-button creation, editor and preview ratio, four viewports');
}finally{await browser.close()}
