// Local UI geometry only. Sections stack from the top; spare room stays below
// them rather than pushing Library to the bottom of the window.
export const SECTION_IDS = ['pages', 'layers', 'library'];
export const HEADER_HEIGHT = 32;
export const SPLITTER_HEIGHT = 8;
export const MIN_HEIGHTS = {pages:112, layers:112, library:216};
export const defaultSidebar = () => ({expanded:{pages:true,layers:true,library:false},heights:{pages:220,layers:240,library:280}});
export function sidebarPreference(value) {
  const result=defaultSidebar();
  if(!value||value.version!==2)return result;
  for(const id of SECTION_IDS){
    if(typeof value.expanded?.[id]==='boolean')result.expanded[id]=value.expanded[id];
    const height=value.heights?.[id];
    if(typeof height==='number'&&Number.isFinite(height)&&height>=MIN_HEIGHTS[id]&&height<=4000)result.heights[id]=height;
  }
  return result;
}
export function allocateSidebar(height,state) {
  const open=SECTION_IDS.filter(id=>state.expanded[id]);
  const fixed=(SECTION_IDS.length-open.length)*HEADER_HEIGHT+2*SPLITTER_HEIGHT;
  const minimum=open.reduce((s,id)=>s+MIN_HEIGHTS[id],0),preferred=open.reduce((s,id)=>s+state.heights[id],0);
  const available=Math.max(minimum,Math.max(0,height-fixed));
  const ratio=preferred>available?(available-minimum)/(preferred-minimum):1;
  const sizes=Object.fromEntries(SECTION_IDS.map(id=>[id,state.expanded[id]?MIN_HEIGHTS[id]+(state.heights[id]-MIN_HEIGHTS[id])*ratio:HEADER_HEIGHT]));
  return {sizes,pairs:open.slice(0,-1).map((id,i)=>[id,open[i+1]]),height:SECTION_IDS.reduce((s,id)=>s+sizes[id],0)+2*SPLITTER_HEIGHT};
}
export function resizeSidebar(state,sizes,first,second,delta) {
  const total=sizes[first]+sizes[second];
  const next=Math.max(MIN_HEIGHTS[first],Math.min(total-MIN_HEIGHTS[second],sizes[first]+delta));
  return {...state,heights:{...state.heights,...Object.fromEntries(SECTION_IDS.filter(id=>state.expanded[id]).map(id=>[id,sizes[id]])),[first]:next,[second]:total-next}};
}
