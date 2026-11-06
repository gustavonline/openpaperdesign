import {onSurfaceDispose} from './surface.js?v=da065f7b280e';
import {SECTION_IDS,MIN_HEIGHTS,defaultSidebar,sidebarPreference,allocateSidebar,resizeSidebar} from './sidebar-layout.js?v=97975441aee8';
const KEY='openpaperdesign:sidebar-sections:v1';
export function setupSidebar(){
  const container=document.querySelector('#sidebar-sections');
  const sections=Object.fromEntries(SECTION_IDS.map(id=>[id,container.querySelector(`[data-sidebar-section="${id}"]`)]));
  const separators=[...container.querySelectorAll('[data-sidebar-splitter]')];
  let state=defaultSidebar(),layout,drag=null;
  try{state=sidebarPreference(JSON.parse(localStorage.getItem(KEY)));}catch{/* Unavailable or old local preferences use the default. */}
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify({version:1,...state}));}catch{/* The panel remains usable without storage. */}};
  function render(){
    if(!container.clientHeight)return;
    layout=allocateSidebar(container.clientHeight,state);
    for(const id of SECTION_IDS){
      const section=sections[id],button=section.querySelector('[data-sidebar-toggle]'),panel=document.getElementById(button.getAttribute('aria-controls'));
      section.style.height=`${layout.sizes[id]}px`;section.dataset.collapsed=String(!state.expanded[id]);
      button.setAttribute('aria-expanded',String(state.expanded[id]));panel.hidden=!state.expanded[id];
    }
    for(const separator of separators){
      const pair=layout.pairs.find(([id])=>id===separator.dataset.sidebarSplitter);
      separator.hidden=!pair;if(!pair)continue;
      const [first,second]=pair,total=layout.sizes[first]+layout.sizes[second];
      separator.dataset.next=second;
      const name=id=>id[0].toUpperCase()+id.slice(1);
      separator.setAttribute('aria-label',`Resize ${name(first)} and ${name(second)}`);
      separator.setAttribute('aria-controls',`${first}-section ${second}-section`);
      separator.setAttribute('aria-valuemin',String(MIN_HEIGHTS[first]));
      separator.setAttribute('aria-valuemax',String(Math.round(total-MIN_HEIGHTS[second])));
      separator.setAttribute('aria-valuenow',String(Math.round(layout.sizes[first])));
      separator.setAttribute('aria-valuetext',`${name(first)} ${Math.round(layout.sizes[first])} pixels, ${name(second)} ${Math.round(layout.sizes[second])} pixels`);
    }
  }
  function setExpanded(id,expanded){
    const section=sections[id],button=section.querySelector('[data-sidebar-toggle]');
    if(!expanded&&document.getElementById(button.getAttribute('aria-controls')).contains(document.activeElement))button.focus({preventScroll:true});
    state={...state,expanded:{...state.expanded,[id]:expanded}};render();persist();
  }
  for(const id of SECTION_IDS)sections[id].querySelector('[data-sidebar-toggle]').onclick=()=>setExpanded(id,!state.expanded[id]);
  for(const separator of separators){
    separator.addEventListener('pointerdown',e=>{
      if(e.button!==0||!layout)return;e.preventDefault();e.stopPropagation();separator.focus({preventScroll:true});
      drag={pointer:e.pointerId,y:e.clientY,state, sizes:{...layout.sizes},first:separator.dataset.sidebarSplitter,second:separator.dataset.next};
      separator.setPointerCapture(e.pointerId);container.classList.add('resizing');
    });
    separator.addEventListener('pointermove',e=>{
      if(!drag||drag.pointer!==e.pointerId)return;
      state=resizeSidebar(drag.state,drag.sizes,drag.first,drag.second,e.clientY-drag.y);render();
    });
    const finish=()=>{if(!drag)return;drag=null;container.classList.remove('resizing');persist();};
    separator.addEventListener('pointerup',finish);separator.addEventListener('pointercancel',finish);separator.addEventListener('lostpointercapture',finish);
  }
  // Run before the embedded inspection toolbar's global capture shortcuts. Native
  // button activation and Tab retain their defaults; layout keys cannot edit artwork.
  const onKey=e=>{
    const separator=e.target.closest?.('.sidebar-splitter');
    const control=e.target.closest?.('[data-sidebar-toggle],.sidebar-splitter,#sidebar-reset');
    if(e.key==='Escape'&&e.target.closest?.('#library-panel')){
      e.preventDefault();e.stopImmediatePropagation();setExpanded('library',false);
      sections.library.querySelector('[data-sidebar-toggle]').focus({preventScroll:true});return;
    }
    if(!control)return;
    e.stopImmediatePropagation();
    if(!separator||!['ArrowUp','ArrowDown','Home','End'].includes(e.key)||!layout)return;
    e.preventDefault();
    const first=separator.dataset.sidebarSplitter,second=separator.dataset.next;
    const delta=e.key==='Home'?-Infinity:e.key==='End'?Infinity:(e.key==='ArrowUp'?-1:1)*(e.shiftKey?48:16);
    state=resizeSidebar(state,layout.sizes,first,second,delta);render();persist();
  };
  window.addEventListener('keydown',onKey,true);
  document.querySelector('#sidebar-reset').onclick=()=>{state=defaultSidebar();render();persist();};
  const observer=new ResizeObserver(render);observer.observe(container);render();
  onSurfaceDispose(()=>{observer.disconnect();window.removeEventListener('keydown',onKey,true);});
  return {setExpanded,isExpanded:id=>state.expanded[id]};
}
