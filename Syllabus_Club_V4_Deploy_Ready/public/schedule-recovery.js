/* Smart six-hour UPSC catch-up planner. Plain deterministic logic, no API calls.
   The app persists assignments in the existing user study-state snapshot. */
const UPSC_RECOVERY=(()=>{
 const MS=86400000;
 const shift=(d,n)=>new Date(Date.parse(d+"T00:00:00Z")+n*MS).toISOString().slice(0,10);
 const distance=(a,b)=>Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/MS);
 const format=d=>new Date(d+"T12:00:00Z").toLocaleDateString("en-IN",{timeZone:"UTC",day:"numeric",month:"short"});
 const carry=(t)=>t && (t.id.endsWith("::new") || t.id.endsWith("::revision"));
 function slotFor(date,start,base){
   const di=distance(start,date)%7;
   if(di===6){
     const item=base.find(t=>t.id.endsWith("::review")&&t.minutes===75);
     return item?{slotId:item.id,minutes:75,kind:"Weekly catch-up / revision"}:null;
   }
   if(![1,3,5].includes(di))return null;
   const item=base.find(t=>t.id.endsWith("::practice")&&t.minutes===60);
   return item?{slotId:item.id,minutes:60,kind:"Regular PYQ practice"}:null;
 }
 function ensureState(state){
   let changed=false;
   if(!Array.isArray(state.recoveryAssignments)){state.recoveryAssignments=[];changed=true}
   if(!state.missedDays||typeof state.missedDays!=="object"){state.missedDays={};changed=true}
   if(!state.completedTasks||typeof state.completedTasks!=="object"){state.completedTasks={};changed=true}
   return changed;
 }
 function sources({start,end,now,baseTasks,completedTasks,missedDays}){
   const tasks=[],dates=new Set();
   for(let d=start;d<=end&&d<=now;d=shift(d,1)){
     const due=d<now||Boolean(missedDays[d]);
     if(!due)continue;
     const base=baseTasks(d);
     for(const t of base){
       if(!carry(t)||completedTasks[t.id])continue;
       tasks.push({...t,sourceDate:d});
       dates.add(d);
     }
   }
   tasks.sort((a,b)=>{
     // Older missed work first, with syllabus coverage before deep revision.
     const diff=a.sourceDate.localeCompare(b.sourceDate);
     return diff||Number(b.id.endsWith("::new"))-Number(a.id.endsWith("::new"));
   });
   return {tasks,dates:[...dates].sort()};
 }
 function reconcile({state,start,end,now,baseTasks}){
   const safeNow=now<start?start:now;
   let changed=ensureState(state);
   const slots=state.recoveryAssignments,done=state.completedTasks;
   const missed=sources({start,end,now,baseTasks,completedTasks:done,missedDays:state.missedDays});
   const allTasks=new Map(missed.tasks.map(t=>[t.id,t]));
   const restStart=now<start?start:now;
   const recoveryEnd=shift(end,-6); // final six days protected for exam-mode revision
   const validSlotDates=[];
   for(let d=restStart;d<recoveryEnd;d=shift(d,1)){
     if(d===now&&state.missedDays[d])continue;
     const slot=slotFor(d,start,baseTasks(d));
     if(slot)validSlotDates.push({date:d,...slot});
   }
   // Archive finished recovery blocks in place, but move unfinished missed blocks.
   for(const a of slots){
     if(a.cancelled||done[a.id])continue;
     if(done[a.originId]){a.cancelled=true;changed=true;continue}
     if(a.date<now||state.missedDays[a.date]){
       a.date=null;changed=true;
     }
   }
   const occupied=new Set(slots.filter(a=>!a.cancelled&&a.date&&(done[a.id]||a.date>=now))
     .map(a=>a.slotId));
   function firstOpen(){
     return validSlotDates.find(slot=>!occupied.has(slot.slotId));
   }
   // Rebook an interrupted recovery block before adding more missed topics.
   for(const a of slots){
     if(a.cancelled||done[a.id]||a.date||done[a.originId])continue;
     const next=firstOpen();
     if(!next)continue;
     a.date=next.date;a.slotId=next.slotId;a.minutes=next.minutes;
     a.kind=next.kind;
     occupied.add(next.slotId);changed=true;
   }
   for(const task of missed.tasks){
     const prior=slots.filter(x=>x.originId===task.id&&!x.cancelled);
     const booked=prior.reduce((sum,x)=>sum+x.coveredMinutes,0);
     let remaining=Math.max(0,task.minutes-booked);
     while(remaining>0){
       const next=firstOpen();
       if(!next)break;
       const covered=Math.min(remaining,next.minutes);
       const index=slots.filter(a=>a.originId===task.id).length+1;
       const item={
         id:"recovery::"+task.id+"::"+index,
         originId:task.id,originDate:task.sourceDate,
         originTitle:task.title,originDetail:task.detail,
         sourceMinutes:task.minutes,coveredMinutes:covered,
         date:next.date,slotId:next.slotId,kind:next.kind,
         minutes:next.minutes,category:"Recovery"
       };
       slots.push(item);
       occupied.add(next.slotId);
       remaining-=covered;changed=true;
     }
   }
   const status=summary({state,start,end,now,baseTasks});
   return {...status,changed};
 }
 function summary({state,start,end,now,baseTasks}){
   ensureState(state);
   const missed=sources({start,end,now,baseTasks,completedTasks:state.completedTasks,missedDays:state.missedDays});
   const active=state.recoveryAssignments.filter(a=>!a.cancelled);
   let assigned=0,unassigned=0;
   for(const task of missed.tasks){
     const covered=active.filter(a=>a.originId===task.id).reduce((n,a)=>n+a.coveredMinutes,0);
     unassigned+=Math.max(0,task.minutes-covered);
   }
   const pending=active.filter(a=>!state.completedTasks[a.id]);
   assigned=pending.reduce((n,a)=>n+a.coveredMinutes,0);
   const rescheduled=active.filter(a=>state.completedTasks[a.id]).length;
   const missedMocks=[];
   for(let d=start;d<now&&d<=end;d=shift(d,1)){
     for(const t of baseTasks(d)){
       if(["Mock","CSAT"].includes(t.category) && /::(?:mock|test|csat-full)$/.test(t.id)&&!state.completedTasks[t.id])missedMocks.push(t);
     }
   }
   return {missedDates:missed.dates,missedTopics:missed.tasks.length,
     assignedMinutes:assigned,unassignedMinutes:unassigned,
     recoveredBlocks:rescheduled,pendingBlocks:pending.length,
     missedMocks:missedMocks.length};
 }
 function tasksFor({date,state,baseTasks}){
   const base=baseTasks(date);
   const assigned=state.recoveryAssignments||[];
   const assignments=assigned.filter(a=>a.date===date&&!a.cancelled);
   if(!assignments.length)return base;
   return base.map(task=>{
     const a=assignments.find(x=>x.slotId===task.id);
     if(!a)return task;
     const balance=Math.max(0,a.minutes-a.coveredMinutes);
     const meta="Originally "+format(a.originDate)+" · "+
       a.coveredMinutes+" min of missed work"+
       (balance?" + "+balance+" min regular PYQs / recall":"")+
       " · replaces "+a.kind.toLowerCase();
     return {id:a.id,title:"Catch up · "+a.originTitle,
       detail:a.originDetail+" · "+meta,minutes:a.minutes,
       originId:a.originId,originDate:a.originDate,
       category:"Recovery"};
   });
 }
 function markComplete(state,taskId,checked){
   state.completedTasks[taskId]=Boolean(checked);
   const assignments=state.recoveryAssignments||[];
   const entry=assignments.find(a=>a.id===taskId);
   if(!entry)return;
   const related=assignments.filter(a=>a.originId===entry.originId&&!a.cancelled);
   const done=related.filter(a=>state.completedTasks[a.id])
     .reduce((n,a)=>n+a.coveredMinutes,0);
   if(done>=entry.sourceMinutes && related.every(a=>state.completedTasks[a.id])){
     state.completedTasks[entry.originId]=true;
   }else{
     delete state.completedTasks[entry.originId];
   }
 }
 return {reconcile,summary,tasksFor,markComplete,ensureState,shift,distance,slotFor};
})();
