// Local UI geometry only. Paper data and artwork selection never enter this module.
export const SECTION_IDS = ['pages', 'layers', 'library'];
export const HEADER_HEIGHT = 32;
export const SPLITTER_HEIGHT = 8;
export const MIN_HEIGHTS = {pages:112, layers:112, library:216};
export const defaultSidebar = () => ({expanded:{pages:true,layers:true,library:false},weights:{pages:.18,layers:.62,library:.30}});
export function sidebarPreference(value) {
  const result=defaultSidebar();
  if(!value||value.version!==1)return result;
  for(const id of SECTION_IDS){
    if(typeof value.expanded?.[id]==='boolean')result.expanded[id]=value.expanded[id];
    const weight=value.weights?.[id];
    if(typeof weight==='number'&&Number.isFinite(weight)&&weight>0&&weight<=100)result.weights[id]=weight;
  }
  return result;
}
export function allocateSidebar(height,state) {
  const open=SECTION_IDS.filter(id=>state.expanded[id]),splitters=Math.max(0,open.length-1);
  const fixed=(SECTION_IDS.length-open.length)*HEADER_HEIGHT+splitters*SPLITTER_HEIGHT;
  const space=Math.max(open.reduce((s,id)=>s+MIN_HEIGHTS[id],0),Math.max(0,height-fixed));
  const sizes=Object.fromEntries(SECTION_IDS.map(id=>[id,HEADER_HEIGHT]));
  let remaining=[...open],available=space;
  while(remaining.length){
    const total=remaining.reduce((sum,id)=>sum+state.weights[id],0);
    const constrained=remaining.filter(id=>available*state.weights[id]/total<MIN_HEIGHTS[id]);
    if(!constrained.length){for(const id of remaining)sizes[id]=available*state.weights[id]/total;break;}
    for(const id of constrained){sizes[id]=MIN_HEIGHTS[id];available-=sizes[id];}
    remaining=remaining.filter(id=>!constrained.includes(id));
  }
  return {sizes,pairs:open.slice(0,-1).map((id,i)=>[id,open[i+1]]),height:space+fixed};
}
export function resizeSidebar(state,sizes,first,second,delta) {
  const total=sizes[first]+sizes[second];
  const next=Math.max(MIN_HEIGHTS[first],Math.min(total-MIN_HEIGHTS[second],sizes[first]+delta));
  const updated={...sizes,[first]:next,[second]:total-next};
  const open=SECTION_IDS.filter(id=>state.expanded[id]);
  const sum=open.reduce((s,id)=>s+updated[id],0),weight=open.reduce((s,id)=>s+state.weights[id],0);
  return {...state,weights:{...state.weights,...Object.fromEntries(open.map(id=>[id,updated[id]/sum*weight]))}};
}
