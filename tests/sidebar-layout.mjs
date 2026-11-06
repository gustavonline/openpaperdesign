import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTION_IDS,MIN_HEIGHTS,defaultSidebar,sidebarPreference,allocateSidebar,resizeSidebar} from '../runtime/sidebar-layout.js';
test('sidebar allocation preserves minimums and independently transfers space between open sections',()=>{
 const state=defaultSidebar();state.expanded.library=true;
 const layout=allocateSidebar(800,state);
 assert.equal(Math.round(layout.height),800);
 const changed=resizeSidebar(state,layout.sizes,'pages','layers',120),after=allocateSidebar(800,changed);
 assert.ok(Math.abs(after.sizes.pages-layout.sizes.pages-120)<.001);
 assert.ok(Math.abs(after.sizes.layers-layout.sizes.layers+120)<.001);
 assert.ok(Math.abs(after.sizes.library-layout.sizes.library)<.001);
 for(const delta of [-Infinity,Infinity]){
  const edge=allocateSidebar(800,resizeSidebar(state,layout.sizes,'pages','layers',delta));
  for(const id of SECTION_IDS)assert.ok(edge.sizes[id]>=MIN_HEIGHTS[id]-.001);
  assert.equal(Math.round(edge.height),800);
 }
});
test('compact panels overflow as a stack rather than destroying usable minimums',()=>{
 const state=defaultSidebar();state.expanded.library=true;
 const layout=allocateSidebar(220,state);
 for(const id of SECTION_IDS)assert.equal(layout.sizes[id],MIN_HEIGHTS[id]);
 assert.ok(layout.height>220);
});
test('collapse reallocates only local panel geometry; restore retains chosen weights',()=>{
 const state=defaultSidebar(),original=allocateSidebar(650,state);
 const collapsed={...state,expanded:{...state.expanded,layers:false,library:true}};
 assert.deepEqual(allocateSidebar(650,collapsed).pairs,[['pages','library']]);
 assert.equal(allocateSidebar(650,collapsed).sizes.layers,32);
 assert.deepEqual(allocateSidebar(650,state),original);
 const allClosed={...state,expanded:Object.fromEntries(SECTION_IDS.map(id=>[id,false]))};
 assert.deepEqual(allocateSidebar(650,allClosed).pairs,[]);
});
test('local preference loading rejects invalid values and preserves supported allocations',()=>{
 assert.deepEqual(sidebarPreference(null),defaultSidebar());
 assert.deepEqual(sidebarPreference({version:2}),defaultSidebar());
 const valid={version:1,expanded:{pages:false,layers:true,library:true},weights:{pages:.6,layers:.3,library:.1}};
 assert.deepEqual(sidebarPreference(valid),{expanded:valid.expanded,weights:valid.weights});
 const invalid=sidebarPreference({version:1,weights:{pages:0,layers:Infinity,library:'2'},expanded:{pages:'false'}});
 assert.deepEqual(invalid,defaultSidebar());
});
