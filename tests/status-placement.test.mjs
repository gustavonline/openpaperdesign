// Where the conflict / error / access-ended status sits (runtime/editing-model.js statusSpot, used by placeStatus in app.js).
// Rects are plain {left,top,right,bottom}; the recovery buttons live inside the status, so the whole box must stay in view.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {statusSpot,statusFrame} from '../runtime/editing-model.js';

const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height});
const view={width:1280,height:800};
const inView=(top,box,v)=>top>=8&&top+(box.bottom-box.top)<=v.height-8+0.5;

test('a bar the status does not touch never moves it (bottom-docked toolbar, 1280x800)',()=>{
  const status=rect(520,8,720,44),bottomToolbar=rect(430,756,420,40),paperBar=rect(8,8,150,32);
  // Only the Paper bar is far left of the status here, so nothing overlaps and the status stays on the top row.
  assert.equal(statusSpot(status,[bottomToolbar,paperBar],view),8);
});

test('the reported case: the status overlaps only the Paper bar while the toolbar is docked at the bottom',()=>{
  const status=rect(100,8,640,44),bottomToolbar=rect(430,756,420,40),paperBar=rect(8,8,150,32);
  const top=statusSpot(status,[bottomToolbar,paperBar],view);
  assert.equal(top,paperBar.bottom+6,'clears the Paper bar only');
  assert.ok(inView(top,status,view),'Download my copy stays inside an 800px window');
  assert.ok(top<100,'it is not pushed under the bottom toolbar (previous result was y=802)');
});

test('a toolbar docked on the top row moves the status just below it; both bars clear in turn',()=>{
  const status=rect(300,8,600,44),toolbar=rect(380,8,420,40);
  assert.equal(statusSpot(status,[toolbar],view),toolbar.bottom+6);
  const lower=rect(8,40,150,40);   // moving below the toolbar now meets a second bar
  assert.equal(statusSpot(rect(100,8,640,44),[toolbar,lower,rect(8,8,150,32)],view),lower.bottom+6);
});

test('side-docked toolbars only matter when they overlap, and the result stays on screen',()=>{
  const status=rect(500,8,740,44);
  assert.equal(statusSpot(status,[rect(8,200,48,300)],view),8,'left column below the top row');
  assert.equal(statusSpot(status,[rect(1224,200,48,300)],view),8,'right column below the top row');
  const top=statusSpot(status,[rect(1190,8,48,300)],view);
  assert.ok(inView(top,status,view)&&top>=8,'a column starting on the top row cannot push the actions out of the window');
});

test('narrow window: a three-line status with wrapped actions clears the Paper bar and fits at 390x700',()=>{
  const narrow={width:390,height:700},status=rect(8,8,374,92),paperBar=rect(8,8,120,32),bottomToolbar=rect(40,648,310,40);
  const top=statusSpot(status,[bottomToolbar,paperBar],narrow);
  assert.equal(top,paperBar.bottom+6);
  assert.ok(inView(top,status,narrow));
});

test('a status taller than the room left is clamped into the window, never below it',()=>{
  const tiny={width:390,height:120},status=rect(8,8,374,90),top=statusSpot(status,[rect(8,8,120,32)],tiny);
  assert.ok(top>=8&&top+90<=tiny.height-8+0.5,String(top));
  assert.equal(statusSpot(rect(8,8,374,10),[],tiny),8);
});

// The status end x is the left edge of the open right inspector (or right corner bar); the canvas area starts at stageLeft.
const frameBox=(frame,view,width,height)=>rect(view.width-frame.right-Math.min(width,frame.maxWidth),8,Math.min(width,frame.maxWidth),height);
const onScreen=(box,v)=>box.left>=0&&box.right<=v.width&&box.top>=0&&box.bottom<=v.height;

test('390px with the 260px inspector open: no readable room beside it, so the message spans the window instead of starting at x<0',()=>{
  const narrow={width:390,height:800},frame=statusFrame(130,0,narrow);
  assert.deepEqual(frame,{right:8,maxWidth:374},'previously right edge 122 with a forced 160px minimum put the left edge at -38');
  const box=frameBox(frame,narrow,374,92),rightBar=rect(330,0,52,40),paperBar=rect(8,8,120,32);
  const top=statusSpot(box,[paperBar,rightBar],narrow);
  assert.equal(top,rightBar.bottom+6,'it clears the corner bars it now covers');
  const placed=rect(box.left,top,box.right-box.left,92);
  assert.ok(onScreen(placed,narrow),JSON.stringify(placed));
});

test('the frame follows the existing layout when there is room, and never leaves the window',()=>{
  const wide={width:1280,height:800};
  assert.deepEqual(statusFrame(1000,230,wide),{right:288,maxWidth:754},'1280 with the inspector open: unchanged, beside it');
  assert.deepEqual(statusFrame(1260,0,wide),{right:28,maxWidth:1244},'inspector closed: beside the corner bar');
  const mid={width:700,height:800};
  assert.deepEqual(statusFrame(440,0,mid),{right:268,maxWidth:424},'700 with the inspector open still fits beside it');
  for(const [anchor,stageLeft,width] of [[130,0,390],[130,0,320],[100,0,360],[60,0,390],[300,230,500],[20,0,390],[-40,0,390]]){
    const view={width,height:700},frame=statusFrame(anchor,stageLeft,view),left=view.width-frame.right-frame.maxWidth;
    assert.ok(left>=0&&frame.right>=0&&frame.maxWidth>0&&left+frame.maxWidth<=view.width,`${anchor}/${stageLeft}/${width}: ${JSON.stringify(frame)}`);
  }
});

test('the editor uses it: placeStatus asks statusSpot and no longer jumps below every bar when any one collides',async()=>{
  const app=await fs.readFile(new URL('../runtime/app.js',import.meta.url),'utf8');
  assert.match(app,/statusSpot\(statusEl\.getBoundingClientRect\(\)/);
  assert.match(app,/statusFrame\(anchor,/);
  assert.doesNotMatch(app,/Math\.max\(160,/);
  assert.doesNotMatch(app,/Math\.max\(toolbar\?\.bottom \|\| 0, paperBar\?\.bottom \|\| 0/);
});
