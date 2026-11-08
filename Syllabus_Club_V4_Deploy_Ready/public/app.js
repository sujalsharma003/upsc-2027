(() => {
'use strict';
const SEED=UPSC_SEED, STORE='upsc-command-center-v1';
const $=s=>document.querySelector(s);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ms=86400000; const toMs=s=>Date.parse(s+'T00:00:00Z');
const addDays=(s,n)=>new Date(toMs(s)+n*ms).toISOString().slice(0,10);
const between=(v,min,max)=>Math.max(min,Math.min(max,v));
const todayISO=()=>{const now=new Date();return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')};
const niceDate=(date,opts={day:'numeric',month:'short'})=>new Date(date+'T12:00:00Z').toLocaleDateString('en-IN',{timeZone:'UTC',...opts});
const num=n=>Math.round(n*10)/10;
const dayDiff=(a,b)=>Math.round((toMs(b)-toMs(a))/ms);
const clampPlan=d=>d<SEED.startDate?SEED.startDate:d>SEED.endDate?SEED.endDate:d;
const initial=()=>({recoveryAssignments:[],missedDays:{},topics:Object.fromEntries(SEED.topics.map(t=>[t.id,{status:t.status,priority:t.priority,revisionStage:0,revisionDue:null,ready:false}])),completedTasks:{},readResources:{},notes:[],documents:[],reminders:[],tests:[],practiceHistory:[],mistakeLog:[],topicWeakness:{},subjectWeakness:{},activePractice:null,aiBatchCheckpoint:null,studySessions:[],timer:null,timerPrefs:{subject:'environment',mode:'stopwatch',taskId:''},createdAt:new Date().toISOString(),version:2});
let state;try{const saved=localStorage.getItem(STORE);state=saved?JSON.parse(saved):initial()}catch(e){state=initial()}
if(!state||!state.topics)state=initial();
UPSC_RECOVERY.ensureState(state);
for(const t of SEED.topics)if(!state.topics[t.id])state.topics[t.id]={status:t.status,priority:t.priority,revisionStage:0,revisionDue:null,ready:false};
if(!Array.isArray(state.practiceHistory))state.practiceHistory=[];
if(!Array.isArray(state.mistakeLog))state.mistakeLog=[];
if(!state.topicWeakness||typeof state.topicWeakness!=='object')state.topicWeakness={};
if(!state.subjectWeakness||typeof state.subjectWeakness!=='object')state.subjectWeakness={};
if(!state.activePractice||!Array.isArray(state.activePractice.questions))state.activePractice=null;
if(!state.aiBatchCheckpoint||!Array.isArray(state.aiBatchCheckpoint.ids))state.aiBatchCheckpoint=null;

for(const k of ['completedTasks','readResources'])if(!state[k])state[k]={};for(const k of ['notes','documents','reminders','tests','studySessions'])if(!Array.isArray(state[k]))state[k]=[];if(!state.timerPrefs)state.timerPrefs={subject:'environment',mode:'stopwatch',taskId:''};
let caUI={online:null,ai:false,auto:false,items:[],lastSync:null,source:'all',tag:'all',status:'all',search:'',from:'',to:'',expanded:null,loading:false,busyId:null,error:'',collapsed:0,bulk:state.aiBatchCheckpoint?{...state.aiBatchCheckpoint,running:false,stop:false}:null};
let zenMode=false;let page='overview',day=clampPlan(todayISO()),weekIndex=between(Math.floor(dayDiff(SEED.startDate,day)/7),0,SEED.weeks.length-1),subjectFilter='all',statusFilter='all',query='',revisionFilter='all',revisionPageSize=40,noteQuery='',modal=null;
const save=(cloud=true)=>{try{localStorage.setItem(STORE,JSON.stringify(state));if(cloud)window.SYLLABUS_CLOUD?.scheduleSave()}catch(e){toast('Local storage unavailable or full. Export a backup.')}};
const topicStatus=t=>state.topics[t.id]?.status||t.status;
const point=v=>({done:1,revision:.75,partial:.4,none:0}[v]||0);
const subjectStats=()=>SEED.subjects.map(s=>{const ts=SEED.topics.filter(t=>t.subject===s.id);let coverage=ts.reduce((a,t)=>a+point(topicStatus(t)),0);return {...s,count:ts.length,weighted:coverage,percent:num(coverage/ts.length*100),done:ts.filter(t=>topicStatus(t)==='done').length,partial:ts.filter(t=>topicStatus(t)==='partial').length,none:ts.filter(t=>topicStatus(t)==='none').length,ready:ts.filter(t=>state.topics[t.id].ready).length}});
const stats=()=>{const ss=subjectStats();return {ss,weighted:num(ss.reduce((a,s)=>a+s.weighted,0)),coverage:num(ss.reduce((a,s)=>a+s.weighted,0)/SEED.topics.length*100),done:ss.reduce((a,s)=>a+s.done,0),partial:ss.reduce((a,s)=>a+s.partial,0),none:ss.reduce((a,s)=>a+s.none,0),ready:ss.reduce((a,s)=>a+s.ready,0)}};
const currentWeek=i=>SEED.weeks[between(i,0,SEED.weeks.length-1)];
const weekDates=i=>({start:addDays(SEED.startDate,i*7),end:addDays(SEED.startDate,Math.min(i*7+6,dayDiff(SEED.startDate,SEED.endDate)))});
const readableWeek=i=>{const d=weekDates(i);return `${niceDate(d.start)} – ${niceDate(d.end)}`};
const mockDay=(wi,di)=>wi>=16&&wi<25&&(di===2||di===5);
function baseDayTasks(d){
 const i=between(Math.floor(dayDiff(SEED.startDate,d)/7),0,SEED.weeks.length-1),di=dayDiff(SEED.startDate,d)%7,w=currentWeek(i);
 const newTopic=w.newTopics[di%w.newTopics.length],old=w.revision[di%w.revision.length],weekNumber=i+1;
 const ca=['National schemes and policies','Economy, RBI and Budget','Environment and species in news','International relations and mapping','Polity, laws and judgments','Science, space and technology','Weekly current affairs consolidation'];
 const csat=['Reading comprehension','Quantitative aptitude','Logical reasoning','Data interpretation','Reading comprehension timed set','Numeracy and reasoning PYQs','CSAT mixed recap'];
 const id=(k)=>`${d}::${k}`;
 if(i===SEED.weeks.length-1)return [
  {id:id('light'),title:'Light final revision',detail:`${newTopic}; review only concise notes`,minutes:105,category:'Review'},
  {id:id('weak'),title:'Mistake log and maps',detail:'Revisit repeated errors; do not start a large new chapter',minutes:75,category:'Practice'},
  {id:id('current'),title:'Current Affairs essentials',detail:'Final indices, schemes, major international events',minutes:45,category:'Current'},
  {id:id('csat'),title:'CSAT confidence practice',detail:'Light familiar questions; prioritize accuracy',minutes:45,category:'CSAT'},
  {id:id('wellness'),title:'Breaks, logistics and sleep',detail:'Check documents and travel; protect your routine',minutes:90,category:'Exam prep'}];
 if(((i>=8&&i<16&&i%2===0)|| (i>=16&&i<25))&&di===4)return [
  {id:id('csat-full'),title:'Timed full CSAT mock',detail:'Paper II simulation · 80 questions · qualifying-paper accuracy',minutes:120,category:'CSAT'},
  {id:id('csat-analysis'),title:'Analyze CSAT mock and timing',detail:'Comprehension, reasoning, numeracy and calculation errors',minutes:90,category:'Practice'},
  {id:id('weak'),title:'Revise weak GS topics',detail:old,minutes:60,category:'Review'},
  {id:id('current'),title:'Current Affairs daily brief',detail:ca[(di+i)%7],minutes:45,category:'Current'},
  {id:id('recall'),title:'Spaced revision and maps',detail:newTopic,minutes:45,category:'Recall'}];
 if(mockDay(i,di))return [
  {id:id('mock'),title:'Full-length GS Paper I mock',detail:`Week ${weekNumber} mixed-paper simulation, timed`,minutes:120,category:'Mock'},
  {id:id('analysis'),title:'Mock analysis and error log',detail:'Tag errors by subject and cause; revisit related notes',minutes:90,category:'Practice'},
  {id:id('revision'),title:'Fix highest-impact mistakes',detail:old,minutes:60,category:'Review'},
  {id:id('current'),title:'Current Affairs daily brief',detail:ca[(di+i)%7],minutes:45,category:'Current'},
  {id:id('csat'),title:'CSAT retention practice',detail:csat[di],minutes:45,category:'CSAT'}];
 if(di===6)return [
  {id:id('test'),title:i>=16?'Mixed sectional GS test':'Weekly sectional test / targeted PYQs',detail:w.goal,minutes:120,category:'Mock'},
  {id:id('analysis'),title:'Analyze all incorrect and guessed questions',detail:'Update mistake log and weak-topic priorities',minutes:75,category:'Practice'},
  {id:id('review'),title:'Weekly revision and catch-up',detail:`Recall ${old} and review incomplete study targets`,minutes:75,category:'Review'},
  {id:id('current'),title:'Weekly Current Affairs consolidation',detail:'Create a one-page summary by Polity/Economy/Environment/IR/Science',minutes:45,category:'Current'},
  {id:id('csat'),title:'CSAT weekly review',detail:'Timed mixed questions with accuracy check',minutes:45,category:'CSAT'}];
 return [
  {id:id('new'),title:i>=16?'Targeted syllabus revision':'New syllabus coverage',detail:newTopic,minutes:120,category:'New'},
  {id:id('revision'),title:'Deep revision of completed topic',detail:old,minutes:75,category:'Review'},
  {id:id('current'),title:'Current Affairs',detail:ca[(di+i)%7]+' · update topic-linked notes',minutes:45,category:'Current'},
  {id:id('practice'),title:'UPSC PYQs and MCQs',detail:`${w.focus}: 15–25 timed questions + error analysis`,minutes:60,category:'Practice'},
  {id:id('csat'),title:'CSAT maintenance',detail:csat[di],minutes:45,category:'CSAT'},
  {id:id('recall'),title:'Spaced recall',detail:'Review notes due Day 1, 7, 21 and 45',minutes:15,category:'Recall'}];
}

function refreshRecovery({persist=true}={}){
 const result=UPSC_RECOVERY.reconcile({state,start:SEED.startDate,end:SEED.endDate,now:todayISO(),baseTasks:baseDayTasks});
 if(result.changed&&persist)save();
 return result;
}
function getDayTasks(d){return UPSC_RECOVERY.tasksFor({date:d,state,baseTasks:baseDayTasks})}
function markMissedStudyDay(date,missed){
 if(date<SEED.startDate||date>SEED.endDate||date>todayISO())return;
 if(missed)state.missedDays[date]=true;else delete state.missedDays[date];
 refreshRecovery({persist:false});save();render();
 toast(missed?'Missed day recorded; priority targets moved into catch-up':'Day restored; unfinished work is still tracked');
}
function recoverySummary(){
 return UPSC_RECOVERY.summary({state,start:SEED.startDate,end:SEED.endDate,now:todayISO(),baseTasks:baseDayTasks});
}
function recoveryDashboard(){
 const summary=recoverySummary();
 const active=state.recoveryAssignments.filter(x=>!x.cancelled&&!state.completedTasks[x.id]);
 const selected=getDayTasks(day).filter(t=>t.category==='Recovery');
 if(todayISO()<SEED.startDate)return '<div class="catchup-panel"><strong>✳ YOUR NEW START</strong><p>Plan begins 12 November. No earlier day is treated as missed.</p></div>';
 return '<section class="catchup-panel"><div class="catchup-head"><div><strong>↻ Smart missed-day recovery</strong><p>Catch-up replaces flexible practice, without exceeding six hours.</p></div><span class="small-tag">'+active.length+' blocks pending</span></div><div class="catchup-stats"><span>'+summary.missedTopics+' missed priority targets</span><span>'+Math.round(summary.assignedMinutes/6)/10+'h assigned</span><span>'+Math.round(summary.unassignedMinutes/6)/10+'h unassigned</span></div>'+
 (summary.unassignedMinutes?'<p class="catchup-warning">Not enough available slots before final revision week. Prioritize your highest-impact unfinished topics.</p>':'')+
 (summary.missedMocks?'<p class="catchup-warning">'+summary.missedMocks+' missed mock(s) need a separate full-length session. Mocks are not compressed.</p>':'')+
 (selected.length?'<p class="catchup-highlight">Selected day has '+selected.length+' catch-up block(s).</p>':'')+
 '<button class="outline-btn" data-nav="today">Open recovery plan ↗</button></section>';
}

const taskDone=id=>!!state.completedTasks[id];
refreshRecovery({persist:false});
function backlogTasks(){const now=todayISO(),end=now<=SEED.endDate?addDays(now,-1):SEED.endDate;if(end<SEED.startDate)return [];const out=[];for(let d=SEED.startDate;d<=end;d=addDays(d,1)){for(const t of baseDayTasks(d))if(!taskDone(t.id))out.push({...t,date:d})}return out.reverse()}
function dueTopics(){return SEED.topics.filter(t=>{const p=state.topics[t.id];return !p.ready&&(
 (p.revisionDue&&p.revisionDue<=todayISO())||
 (p.status!=='none'&&(!p.revisionStage||!p.revisionDue)))
}).sort((a,b)=>(state.topics[a.id].revisionDue||'0000').localeCompare(state.topics[b.id].revisionDue||'0000'))}
const urgentReminders=()=>state.reminders.filter(r=>!r.done&&r.dueAt.slice(0,10)<=todayISO()).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200)}
function heading(title,lede,tag='YOUR STUDY WORKSPACE'){return `<div class="eyebrow">${h(tag)}</div><h1 class="page-title">${h(title)}</h1><p class="page-lede">${h(lede)}</p>`}
function statCard(label,value,foot,icon){return `<div class="card"><span class="stat-icon">${icon}</span><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`}
function progress(p,color){return `<div class="progress"><i style="width:${between(p,0,100)}%;background:${color||'var(--brand)'}"></i></div>`}
function subjectBars(ss){return ss.map(s=>`<div class="subject-row"><span class="subject-name">${h(s.short)}</span>${progress(s.percent,s.color)}<span class="pct">${s.percent}%</span></div>`).join('')}
function taskRow(t){return `<div class="task-row"><input aria-label="Mark task completed" class="check" type="checkbox" data-task="${h(t.id)}" ${taskDone(t.id)?'checked':''}><div class="task-main ${taskDone(t.id)?'task-done':''}"><strong>${h(t.title)}</strong><p>${h(t.detail)}</p></div><div class="task-controls"><span class="minutes">${t.minutes}m</span><button type="button" class="tiny-focus" data-task-focus="${h(t.id)}" title="Open focus timer linked to this task">▶ Focus</button></div></div>`}

const secFmt=n=>{n=Math.max(0,Math.floor(n));return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n%3600/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`};
const shortDuration=n=>{n=Math.max(0,Math.round(n));const hrs=Math.floor(n/3600),mins=Math.floor((n%3600)/60);return n===0?'0m':n<60?`${n}s`:hrs?`${hrs}h ${String(mins).padStart(2,'0')}m`:`${mins}m`};
const localDate=ts=>{const d=new Date(ts);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const modeLimit={stopwatch:0,pomodoro:25*60,deepwork:50*60};
function segmentsOf(timer,until=Date.now()){if(!timer)return [];const seg=(timer.segments||[]).map(x=>({...x}));if(timer.status==='running'&&timer.lastStart)seg.push({start:timer.lastStart,end:new Date(until).toISOString()});return seg;}
const segSecs=segs=>segs.reduce((sum,segment)=>sum+Math.max(0,(new Date(segment.end).getTime()-new Date(segment.start).getTime())/1000),0);
function getTimerSeconds(now=Date.now()){return segSecs(segmentsOf(state.timer,now))}
function splitSecondsByDay(segments,dayKey){let sec=0;const dayStart=new Date(dayKey+'T00:00:00').getTime(),dayEnd=new Date(addDays(dayKey,1)+'T00:00:00').getTime();for(const item of segments){const a=Date.parse(item.start),b=Date.parse(item.end);sec+=Math.max(0,Math.min(b,dayEnd)-Math.max(a,dayStart))/1000}return sec}
function dailyStudied(d,includeRunning=true){let sum=0;for(const sess of state.studySessions){if(sess.segments?.length)sum+=splitSecondsByDay(sess.segments,d);else if(sess.date===d)sum+=Number(sess.durationSec||0)}if(includeRunning&&state.timer)sum+=splitSecondsByDay(segmentsOf(state.timer),d);return Math.round(sum)}
function weekStudied(d=todayISO()){let secs=0;for(let i=0;i<7;i++)secs+=dailyStudied(addDays(d,-i));return secs}
function totalStudied(){return Math.round(state.studySessions.reduce((sum,item)=>sum+(item.durationSec||0),0)+getTimerSeconds())}
function subjectWeeklyTime(subject,end=todayISO()){let sum=0;for(let i=0;i<7;i++){const d=addDays(end,-i);for(const x of state.studySessions){if(x.subject!==subject)continue;if(x.segments?.length)sum+=splitSecondsByDay(x.segments,d);else if(x.date===d)sum+=Number(x.durationSec||0)}if(state.timer?.subject===subject)sum+=splitSecondsByDay(segmentsOf(state.timer),d);}return Math.round(sum)}
function subjectName(id){if(id==='csat')return 'CSAT';return SEED.subjects.find(s=>s.id===id)?.short||'General study'}
function nowStamp(){return new Date().toISOString()}
function pauseTimer(){const t=state.timer;if(!t||t.status!=='running')return;if(t.lastStart)t.segments.push({start:t.lastStart,end:nowStamp()});t.lastStart=null;t.status='paused';t.lastHeartbeat=nowStamp();save();}
function resumeTimer(){const t=state.timer;if(!t||t.status!=='paused')return;t.lastStart=nowStamp();t.lastHeartbeat=t.lastStart;t.status='running';save()}
function startTimer(){if(state.timer?.status==='running')return;const p=state.timerPrefs||{};state.timer={id:rid(),subject:p.subject||'environment',taskId:p.taskId||'',mode:p.mode||'stopwatch',status:'running',createdAt:nowStamp(),lastStart:nowStamp(),lastHeartbeat:nowStamp(),segments:[]};save();render();toast('Focus session started · you’ve got this');}
function stopTimer(auto=false){const t=state.timer;if(!t)return;if(t.status==='running')pauseTimer();let segments=t.segments||[],seconds=Math.round(segSecs(segments));const cap=modeLimit[t.mode]||0;if(cap&&seconds>cap){let remain=cap,trimmed=[];for(const seg of segments){const span=(Date.parse(seg.end)-Date.parse(seg.start))/1000;if(remain<=0)break;const take=Math.min(span,remain);trimmed.push({start:seg.start,end:new Date(Date.parse(seg.start)+take*1000).toISOString()});remain-=take;}segments=trimmed;seconds=Math.round(segSecs(trimmed));}
 if(seconds>=1)state.studySessions.unshift({id:t.id,subject:t.subject,taskId:t.taskId,mode:t.mode,segments,date:localDate(t.createdAt),createdAt:t.createdAt,endedAt:nowStamp(),durationSec:seconds,manual:false});state.timer=null;save();render();toast(seconds?`${shortDuration(seconds)} saved to ${subjectName(t.subject)}`:'Empty session discarded');if(auto&&'Notification'in window&&Notification.permission==='granted')try{new Notification('Focus block finished',{body:'Session recorded. Take a quick break.'})}catch{}
}
function timerWidget(compact=false){const t=state.timer,p=state.timerPrefs,m=t?.mode||p.mode||'stopwatch',elapsed=getTimerSeconds(),lim=modeLimit[m]||0,remaining=lim?Math.max(0,lim-elapsed):elapsed,subject=t?.subject||p.subject||'environment',goal=6*3600,todaySeconds=dailyStudied(todayISO()),pct=Math.min(100,Math.round(todaySeconds/goal*100)),active=t?.status==='running';
 return `<section class="focus-card ${compact?'focus-compact':''}" aria-label="Study focus timer"><div class="focus-head"><span class="focus-overline"><span class="live-dot ${active?'is-live':''}"></span> ${active?'RECORDING NOW':t?.status==='paused'?'SESSION PAUSED':'FOCUS STUDIO'}</span><span class="focus-icon">◷</span></div><h2 class="focus-title">Lock in<span class="focus-title-dot">.</span></h2><p class="focus-desc">Your study hours, actually tracked.</p><div class="timer-display" aria-live="off" data-clock>${secFmt(remaining)}</div><div class="timer-caption">${lim?`${m==='pomodoro'?'25-minute sprint':'50-minute deep focus'} · ${t?'active session':'ready when you are'}`:'Stopwatch · no time limit'}</div><div class="timer-meter"><i style="width:${lim?Math.min(100,elapsed/lim*100):pct}%" data-timer-meter></i></div><div class="timer-controls">${!t?'<button class="timer-main" data-timer-start>▶ Start focus</button>':active?'<button class="timer-main" data-timer-pause>Ⅱ Pause</button>':'<button class="timer-main" data-timer-resume>▶ Resume</button>'}${t?'<button class="timer-stop" data-timer-stop>■ Save session</button>':''}</div><div class="timer-selects"><label>SUBJECT<select class="select" id="timer-subject" ${t?'disabled':''}>${SEED.subjects.map(s=>`<option value="${s.id}" ${subject===s.id?'selected':''}>${h(s.short)}</option>`).join('')}<option value="csat" ${subject==='csat'?'selected':''}>CSAT</option><option value="general" ${subject==='general'?'selected':''}>General / other</option></select></label><label>MODE<select class="select" id="timer-mode" ${t?'disabled':''}><option value="stopwatch" ${m==='stopwatch'?'selected':''}>Stopwatch</option><option value="pomodoro" ${m==='pomodoro'?'selected':''}>25 min · Sprint</option><option value="deepwork" ${m==='deepwork'?'selected':''}>50 min · Deep focus</option></select></label></div><div class="timer-footer"><span>Today <b data-live-today>${shortDuration(todaySeconds)}</b> / 6h</span><span>${pct}% of daily goal</span></div>${(t?.taskId||p.taskId)?`<div class="timer-linked">↗ Linked to a daily study target</div>`:''}${compact?'<button class="timer-open" data-nav="timer">View time tracker ↗</button>':''}</section>`
}
function renderTimer(){const today=todayISO(),todaySeconds=dailyStudied(today),weekSecs=weekStudied(today),totalSecs=totalStudied(),days=Array.from({length:7},(_,i)=>addDays(today,i-6)),max=Math.max(6*3600,...days.map(d=>dailyStudied(d))),sessions=state.studySessions.slice(0,15);return heading('Own your time.','A focus-first stopwatch, study log and daily analytics. Timer runs on elapsed clock time and saves sessions locally.','FOCUS STUDIO / TIME TRACKING')+
 `<div class="timer-page-actions"><button class="outline-btn" data-zen-toggle>⛶ Enter distraction-free mode</button><span class="tiny text-muted">Your timer stays active while you navigate this dashboard</span></div><div class="timer-page-grid">${timerWidget(false)}<div class="timer-side"><div class="time-kpis"><div class="card time-kpi"><div class="stat-label">TODAY’S LOGGED STUDY TIME</div><div class="stat-value" data-live-total>${shortDuration(todaySeconds)}</div><div class="stat-foot">Goal: 6h tracked, not just tasks ticked</div>${progress(todaySeconds/21600*100,'var(--lime)')}</div><div class="card time-kpi"><div class="stat-label">LAST 7 DAYS</div><div class="stat-value">${shortDuration(weekSecs)}</div><div class="stat-foot">Target: 42h across seven days</div>${progress(weekSecs/(42*3600)*100,'var(--purple)')}</div><div class="card time-kpi"><div class="stat-label">ALL-TIME FOCUS</div><div class="stat-value">${shortDuration(totalSecs)}</div><div class="stat-foot">${state.studySessions.length} saved sessions · ${state.studySessions.filter(x=>!x.manual).length} timed</div></div></div><section class="card chart-card"><div class="split-heading"><strong class="card-title">Your last seven days</strong><span class="small-tag">6H DAILY GOAL</span></div><div class="activity-chart">${days.map(d=>{const v=dailyStudied(d);return `<div class="activity-column" title="${d}: ${shortDuration(v)}"><div class="activity-track"><div class="activity-fill ${d===today?'chart-today':''}" style="height:${Math.max(v?4:0,Math.min(100,v/max*100))}%"></div></div><strong>${h(niceDate(d,{weekday:'short'}))}</strong><span>${v?shortDuration(v):'–'}</span></div>`}).join('')}</div></section></div></div><section class="card weekly-subjects"><div class="split-heading"><div><strong class="card-title">This week's subject mix</strong><p class="small text-muted">Time logged across the last seven days · by subject</p></div><span class="small-tag">TRACKED HOURS</span></div>${(()=>{const subj=[...SEED.subjects,{id:'csat',short:'CSAT',color:'#efbd85'},{id:'general',short:'General',color:'#b5b5c2'}].map(x=>({...x,secs:subjectWeeklyTime(x.id)})).filter(x=>x.secs>0).sort((a,b)=>b.secs-a.secs);const max=Math.max(...subj.map(x=>x.secs),1);return subj.length?`<div class="subject-time-grid">${subj.map(x=>`<div class="subject-time-row"><div><strong>${h(x.short)}</strong><span>${shortDuration(x.secs)}</span></div><div class="subject-time-track"><i style="width:${x.secs/max*100}%;background:${x.color}"></i></div></div>`).join('')}</div>`:'<p class="small text-muted">Your subject-wise timeline will populate as soon as you save a focus session.</p>'})()}</section><div class="section-heading"><div><h2>Session history</h2><p>Review and correct your actual study record</p></div><div class="page-action"><button class="outline-btn" data-modal="manualTime">+ Add time manually</button><button class="outline-btn" data-timer-export>↓ Export CSV</button></div></div><div class="card time-history">${sessions.length?sessions.map(x=>`<div class="session-row"><div class="session-glyph">◷</div><div class="session-info"><strong>${h(subjectName(x.subject))}</strong><p>${h(niceDate(x.date,{day:'numeric',month:'short',year:'numeric'}))} · ${x.manual?'Manual log':x.mode==='stopwatch'?'Stopwatch':x.mode==='pomodoro'?'25-min sprint':'Deep focus'}${x.taskId?' · Linked task':''}${x.note?' · '+h(x.note):''}</p></div><strong class="session-duration">${shortDuration(x.durationSec)}</strong><button class="delete-session" aria-label="Delete session" data-delete-session="${h(x.id)}">×</button></div>`).join(''):'<div class="empty">No sessions yet. Start your first focus block and it will appear here automatically.</div>'}</div><p class="footnote">Time is recorded only while the stopwatch is running, including when the tab is in the background. The app pauses when the page closes. Long sessions spanning midnight are apportioned by calendar day. Time saved in this browser is not synced across devices.</p>`;
}
function renderZen(){return `<div class="zen-stage"><div class="zen-top"><span>✳ SYLLABUS CLUB / FOCUS MODE</span><button class="outline-btn" data-zen-toggle>↙ Exit focus mode</button></div><div class="zen-center"><div class="zen-tag">ONE THING AT A TIME</div><h1>Stay in the zone<span>.</span></h1><p>Protect this hour. The progress will follow.</p>${timerWidget(false)}</div><div class="zen-bottom">No noise. Just you and the syllabus.</div></div>`}
function timerCSV(){return ['Date,Subject,Mode,Duration (minutes),Task,Started,Ended',...state.studySessions.map(x=>[x.date,subjectName(x.subject),x.mode,Math.round(x.durationSec/60*10)/10,x.taskId||'',x.createdAt||'',x.endedAt||''].map(q=>'"'+String(q).replace(/"/g,'""')+'"').join(','))].join('\n')}
function bootTimer(){const t=state.timer;if(t?.status==='running'){const safetyEnd=Math.min(Date.now(),Date.parse(t.lastHeartbeat||t.lastStart)+15000);if(t.lastStart&&safetyEnd>Date.parse(t.lastStart))t.segments.push({start:t.lastStart,end:new Date(safetyEnd).toISOString()});t.lastStart=null;t.status='paused';save();}}

function caDate(a){return a.date_precision==='month'?niceDate(a.published_date,{month:'long',year:'numeric'}):niceDate(a.published_date,{day:'numeric',month:'short',year:'numeric'})}
function caSafeLink(a){const v=safeURL(a.url||'');return v&&/^(https:\/\/)(?:www\.)?(pib\.gov\.in|prsindia\.org)\//i.test(v)?v:null}
function caGuideMarkup(a){
 const g=a.study_guidance;
 if(!g)return '';
 const links=(g.syllabus_links||[]).map(x=>'<span class="ca-linktag">'+h(x)+'</span>').join(' ');
 const drills=(g.recall_questions||[]).map((x,i)=>'<li><span class="ca-drill-index">'+(i+1)+'</span>'+h(x)+'</li>').join('');
 return '<section class="ca-guide"><div class="ca-guide-head"><strong>✳ PRELIMS STUDY GUIDE</strong><span>'+h((g.priority||'review').toUpperCase())+' PRIORITY · '+Number(g.reading_minutes||3)+' MIN</span></div><p class="ca-guide-intro">Automatically mapped to the syllabus. These are rule-based study prompts, not AI-generated facts.</p><strong class="ca-guide-sub">SYLLABUS CONNECTIONS</strong><div class="ca-guide-tags">'+(links||'<span>Verify syllabus relevance from the original source.</span>')+'</div><strong class="ca-guide-sub">ACTIVE RECALL</strong><ol class="ca-guide-questions">'+drills+'</ol><p class="ca-guide-warning">↗ '+h(g.source_warning||'Verify against the official source.')+'</p></section>';
}
function caNoteMarkup(a){const x=a.analysis;if(!x)return `<div class="ca-evidence"><strong>Source preview · not AI-generated</strong><p>${h(a.excerpt||'Source metadata only. Open the original article to read it.')}</p><p class="tiny text-muted">Rule-based tags are only suggestions. Source-grounded AI notes appear here after analysis.</p></div>`;
 const facts=(x.key_facts||[]).map(v=>`<li>${h(v)}</li>`).join('');const mcqs=(x.mcqs||[]).map((m,i)=>`<div class="ca-mcq"><strong>Q${i+1}. ${h(m.question)}</strong>${(m.options||[]).map((o,j)=>`<div class="ca-opt">${String.fromCharCode(65+j)}. ${h(o)}</div>`).join('')}<details><summary>Check answer & explanation</summary><p><strong>${String.fromCharCode(65+Number(m.answer_index||0))}.</strong> ${h(m.explanation||'')}</p></details></div>`).join('');
 return `<div class="ca-evidence"><div class="ca-proof">✳ GEMINI-GENERATED STUDY NOTES <span>Verify against original source ↗</span></div><p>${h(x.summary)}</p>${facts?`<strong>Prelims facts</strong><ul>${facts}</ul>`:''}<strong>Static syllabus links</strong><p>${(x.static_links||[]).map(t=>`<span class="ca-linktag">${h(t)}</span>`).join(' ')||'Not available'}</p><strong>Why it matters</strong><p>${h(x.why_relevant)}</p>${mcqs?`<strong>Practice questions</strong>${mcqs}`:''}${(x.uncertainties||[]).length?`<div class="ca-caution">Check: ${h(x.uncertainties.join(' · '))}</div>`:''}<div class="ca-caution">AI can make mistakes. Dates, laws and numbers must be checked against the linked original.</div></div>`;
}
function renderCurrentAffairs(){const all=caUI.items||[];const shown=all.filter(a=>(caUI.status==='all'||(caUI.status==='due'?a.revision_due&&a.revision_due<=todayISO():a.read_status===caUI.status)));const due=all.filter(a=>a.revision_due&&a.revision_due<=todayISO()).length;
 const grouped={};for(const a of shown){const key=a.date_precision==='month'?a.published_date.slice(0,7):a.published_date;(grouped[key]||=[]).push(a)}
 const sourceSelect=[['all','All sources'],['PIB','PIB'],['PRS','PRS'],['PDF','My PDFs']].map(([v,t])=>`<option value="${v}" ${caUI.source===v?'selected':''}>${t}</option>`).join('');
 const tagSelect=[['all','All subjects'],...['Polity','Economy','Environment','Geography','Science & Tech','International Relations','History & Culture','Social Issues'].map(t=>[t,t])].map(([v,t])=>`<option value="${h(v)}" ${caUI.tag===v?'selected':''}>${h(t)}</option>`).join('');
 const statusSelect=[['all','Every reading status'],['unread','To read'],['saved','Saved'],['read','Read'],['due','Revision due']].map(([v,t])=>`<option value="${v}" ${caUI.status===v?'selected':''}>${t}</option>`).join('');
 const statusText=caUI.online===null?'Connecting to your cloud…':caUI.online?(caUI.ai?'Cloud connected · Gemini ready':'Cloud connected · Gemini key missing'):'Cloud offline · Reconnect or sign in';
 return `<div class="ca-hero"><div><div class="ca-kicker">✳ THE INTELLIGENCE DESK / UPSC 2027</div><h1>News in.<br><em>Knowledge out.</em></h1><p>Your date-wise official-source inbox. Less doomscrolling, more actual Prelims revision.</p><div class="ca-hero-actions"><button class="ca-sync" data-ca-sync ${!caUI.online||caUI.loading||caUI.bulk?.running?'disabled':''}>${caUI.loading?'Syncing…':'↻ Sync PIB + PRS'}</button>${caUI.online===false?'<button class="ca-quiet" data-ca-retry-cloud type="button">↻ Retry Cloud</button>':''}<button class="ca-bulk-launch" data-ca-bulk-start type="button" ${!caUI.online||!caUI.ai||caUI.loading||caUI.busyId!==null||caUI.bulk?.running?'disabled':''}>✳ ${caUI.bulk?.running?'Generating notes…':'Generate Notes for All News'}</button><span class="ca-status ${caUI.online?'connected':''}"><i></i>${h(statusText)}</span></div></div><div class="ca-hero-mark">✳<span>THE DAILY<br>DECODE</span></div></div>
 ${caBulkMarkup()}
 ${caUI.collapsed?'<div class="ca-dedup-summary">✳ '+caUI.collapsed+' duplicate PIB/PRS news entries grouped into single stories. No saved notes were deleted.</div>':''}<div class="ca-metrics"><div><span>IN YOUR INBOX</span><strong>${all.length}</strong><small>Official / uploaded sources</small></div><div><span>TO READ</span><strong>${all.filter(x=>x.read_status==='unread').length}</strong><small>Unreviewed entries</small></div><div><span>REVISION DUE</span><strong>${due}</strong><small>Spaced review queue</small></div><div><span>AI STUDY NOTES</span><strong>${all.filter(x=>x.analysis).length}</strong><small>Source-linked notes</small></div></div>
 ${caUI.error?`<div class="ca-message">${h(caUI.error)}</div>`:''}
 <div class="ca-grid"><section><div class="section-heading"><div><h2>Daily source feed</h2><p>Archive by published date, never by upload date</p></div><span class="small-tag">${shown.length} MATCHING</span></div><div class="ca-filters"><select aria-label="Filter sources" id="ca-source" class="select">${sourceSelect}</select><select aria-label="Filter syllabus category" id="ca-tag" class="select">${tagSelect}</select><select aria-label="Reading status" id="ca-status" class="select">${statusSelect}</select><input id="ca-search" class="input" placeholder="Search news, ministries, topics…" value="${h(caUI.search)}" aria-label="Search Current Affairs"><label>From <input id="ca-from" class="input" type="date" value="${h(caUI.from)}"></label><label>To <input id="ca-to" class="input" type="date" value="${h(caUI.to)}"></label><button class="outline-btn" data-ca-filter>Apply filters ↗</button><button class="outline-btn" data-ca-export ${!caUI.online?'disabled':''}>↓ Export archive</button></div>
 ${Object.keys(grouped).length?Object.keys(grouped).sort().reverse().map(key=>`<div class="ca-day-head"><span>▦ ${h(key.length===7?niceDate(key+'-01',{month:'long',year:'numeric'}):niceDate(key,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</span><span>${grouped[key].length} entries</span></div>${grouped[key].map(a=>{const link=caSafeLink(a),isOpen=caUI.expanded===a.id;return `<article data-ca-item="${h(a.id)}" class="ca-article ${isOpen?'ca-open':''}"><div class="ca-row-top"><span class="ca-origin ca-${a.source.toLowerCase()}">${a.source==='PDF'?'↑ YOUR PDF':h(a.source)}</span><span>${h(caDate(a))}</span><span class="ca-score">${a.study_guidance?.priority==='high'?'HIGH PRIORITY':a.study_guidance?.priority==='medium'?'RELEVANT':'CHECK RELEVANCE'}</span></div><h3>${h(a.title)}</h3><div class="ca-article-tags">${(a.tags||[]).map(t=>`<span>${h(t)}</span>`).join('')||'<span>Uncategorized</span>'}</div><div class="ca-excerpt">${h(a.excerpt?.slice(0,200)||'Open original to read the announcement.')}${a.excerpt?.length>200?'…':''}</div>${a.overlap_sources?.length?`<div class="ca-dedup-notice"><strong>↳ ${a.overlap_sources.length} familiar news topic${a.overlap_sources.length===1?'':'s'} already covered</strong><span>Original PDF kept; repeated coverage flagged for review.</span><div>${a.overlap_sources.slice(0,4).map(m=>`<span class="ca-match">${h(m.source)} · ${h(m.title?.slice(0,100)||'Related article')}</span>`).join('')}</div></div>`:''}${a.alternate_sources?.length?`<div class="ca-dedup-notice"><strong>↳ ${a.alternate_sources.length} matching official source${a.alternate_sources.length===1?'':'s'} grouped</strong><div>${a.alternate_sources.map(m=>{const u=caSafeLink(m);return u?`<a class="ca-match" target="_blank" rel="noopener noreferrer" href="${h(u)}">${h(m.source)} · ${h(m.title?.slice(0,95)||'Alternate source')}</a>`:`<span class="ca-match">${h(m.source)} · ${h(m.title?.slice(0,95)||'Alternate source')}</span>`}).join('')}</div></div>`:''}<div class="ca-actions"><button class="ca-button ca-alt" type="button" data-ca-quick="${a.id}" ${(!caUI.ai&&!a.analysis)||caUI.busyId!==null?"disabled":""}>${caUI.busyId===a.id?"⏳ Generating…":a.analysis?"✳ View Gemini Notes":"✳ Generate Gemini Notes"}</button><button class="ca-button" data-ca-detail="${a.id}">${isOpen?'Hide notes ↑':'Study this ↗'}</button>${link?`<a class="ca-external" href="${h(link)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>`:a.source==='PDF'?`<button class="ca-external" type="button" data-ca-file="${a.id}">Open PDF ↗</button>`:''}<button class="ca-quiet" data-ca-status-action="${a.id}" data-ca-new-status="${a.read_status==='read'?'unread':'read'}">${a.read_status==='read'?'↶ Unread':'✓ Read'}</button><button class="ca-quiet" data-ca-status-action="${a.id}" data-ca-new-status="${a.read_status==='saved'?'unread':'saved'}">${a.read_status==='saved'?'★ Saved':'☆ Save'}</button></div>${a.revision_due?`<div class="ca-review-date">↻ Next revision ${h(niceDate(a.revision_due))} · Stage ${a.revision_stage}</div>`:''}${isOpen?`${caGuideMarkup(a)}${caNoteMarkup(a)}<div class="ca-actions ca-study-actions"><button class="ca-button ca-alt" data-ca-analyze="${a.id}" ${!caUI.ai||caUI.busyId===a.id?'disabled':''}>${caUI.busyId===a.id?'Generating…':a.analysis?'✳ Regenerate Gemini notes':'✳ Generate Gemini notes'}</button><button class="ca-quiet" data-ca-revise="${a.id}">↻ Mark revised</button><button class="ca-quiet" data-ca-note="${a.id}">＋ Save to Notebook</button></div>`:''}</article>`}).join('')}`).join(''):`<div class="ca-empty"><span>✳</span><h3>${caUI.online?'Your source feed is clear.':'Your intelligence desk is ready.'}</h3><p>${caUI.online?'Sync official sources or upload a PDF to build your date-wise archive.':'Open ☁ Cloud settings to sign in. The study dashboard also remains available offline in this browser.'}</p><div class="ca-empty-links"><a href="https://www.pib.gov.in/ViewRss.aspx?lang=1&reg=1" target="_blank" rel="noopener noreferrer">PIB official RSS ↗</a><a href="https://prsindia.org/policy/monthly-policy-review" target="_blank" rel="noopener noreferrer">PRS archive ↗</a></div></div>`}
 </section><aside class="ca-side"><div class="ca-side-card ca-side-lime"><div class="ca-side-kicker">YOUR 45-MINUTE SLOT ↗</div><h3>The daily<br>decode.</h3><p>15 min official updates<br>15 min AI notes + static links<br>15 min MCQs & active recall</p><button data-nav="today">View study plan ↗</button></div><div class="ca-side-card"><div class="ca-side-kicker">02 / PERSONAL PDF INBOX</div><h3>Drop it.<br>Decode it.</h3><p>Upload your coaching monthly magazine or self-made PDF. Choose the document's published date; we won't assume the upload date.</p><form id="ca-pdf-form"><label>Publication / issue date<input class="input" name="published_date" type="date" required value="${todayISO()}"></label><label>Choose a text-based PDF<input class="input" type="file" name="file" accept="application/pdf,.pdf" required></label><button class="primary-btn" ${!caUI.online?'disabled':''} type="submit">↑ Import into archive</button></form><p class="tiny text-muted">Max 15 MB / 120 pages. Scanned PDFs need OCR and are not supported yet. File saved on your computer's local server.</p></div><div class="ca-side-card"><div class="ca-side-kicker">03 / SOURCE TRANSPARENCY</div><h3>No made-up headlines.</h3><p>PIB and PRS stay linked to originals. Topic priority is rule-based until AI analysis is generated. AI summaries need verification.</p><div class="ca-synced">Last attempt: ${caUI.lastSync?.ran_at?h(caUI.lastSync.ran_at.replace('T',' ').slice(0,16)+' UTC'):'Not yet'}</div>${caUI.lastSync?.errors?.length?`<p class="ca-caution">${h(caUI.lastSync.errors.join(' · '))}</p>`:''}</div></aside></div>`;
}
async function caRequest(path,opts={}){if(!window.SYLLABUS_CLOUD?.loggedIn)throw Error('Sign in using the ☁ Cloud account button first');return await window.SYLLABUS_CLOUD.api(path,opts)}
function caStableRender(articleId=null){
 if(page!=='current'){render();return}
 const oldScroll=window.scrollY;
 const cards=[...document.querySelectorAll('.ca-article[data-ca-item]')];
 const anchor=(articleId&&cards.find(a=>a.dataset.caItem===articleId))||
     cards.find(a=>a.getBoundingClientRect().bottom>80)||null;
 const key=anchor?.dataset.caItem,top=anchor?.getBoundingClientRect().top;
 render();
 const updated=key?[...document.querySelectorAll('.ca-article[data-ca-item]')]
   .find(a=>a.dataset.caItem===key):null;
 if(updated&&Number.isFinite(top)){
   window.scrollBy(0,updated.getBoundingClientRect().top-top);
 }else{
   window.scrollTo(0,oldScroll);
 }
}

function caBulkStatus(b){
 return b.running?(b.stop?'Stopping after the current article…':'Generating official-source notes…'):
       b.done<b.total?'Paused · resume when ready':'Batch completed';
}
function caBulkMarkup(){
 const b=caUI.bulk;if(!b)return '';
 const pct=b.total?Math.round(b.done/b.total*100):0;
 return '<section class="ca-bulk-panel" aria-label="Gemini batch generation progress" role="status" aria-live="polite">'+
   '<div class="ca-bulk-head"><strong>✳ GEMINI BATCH PROGRESS</strong><span data-ca-bulk-pct>'+pct+'%</span></div>'+
   '<div class="ca-bulk-meter" role="progressbar" aria-label="Gemini notes processed" aria-valuemin="0" aria-valuemax="'+b.total+'" aria-valuenow="'+b.done+'" data-ca-bulk-meter><i data-ca-bulk-fill style="width:'+pct+'%"></i></div>'+
   '<div class="ca-bulk-info"><span data-ca-bulk-status>'+h(caBulkStatus(b))+'</span><span data-ca-bulk-count>'+b.done+'/'+b.total+' processed · '+b.success+' saved · '+b.failed+' failed</span></div>'+
   '<p class="ca-bulk-current" data-ca-bulk-current>'+h(b.current||'')+'</p>'+
   (b.running?'<button class="ca-bulk-stop" data-ca-bulk-stop type="button">■ Stop after current</button>':
     b.done<b.total?'<button class="ca-bulk-resume" data-ca-bulk-resume type="button">▶ Resume remaining articles</button>':
     '<button class="ca-bulk-resume" data-ca-bulk-dismiss type="button">✓ Clear completed batch</button>')+
   '<p class="ca-bulk-help">Checkpoint is saved after each article in your study data. Resume after a refresh or connection loss; completed articles are skipped. Gemini provider quota applies.</p></section>';
}
function caBulkPaint(){
 const b=caUI.bulk;if(!b)return;
 const root=document.querySelector('.ca-bulk-panel');if(!root)return;
 const pct=b.total?Math.round(b.done/b.total*100):0;
 const fill=root.querySelector('[data-ca-bulk-fill]');if(fill)fill.style.width=pct+'%';
 const meter=root.querySelector('[data-ca-bulk-meter]');if(meter)meter.setAttribute('aria-valuenow',String(b.done));
 const percentage=root.querySelector('[data-ca-bulk-pct]');if(percentage)percentage.textContent=pct+'%';
 const status=root.querySelector('[data-ca-bulk-status]');if(status)status.textContent=caBulkStatus(b);
 const counts=root.querySelector('[data-ca-bulk-count]');if(counts)counts.textContent=b.done+'/'+b.total+' processed · '+b.success+' saved · '+b.failed+' failed';
 const current=root.querySelector('[data-ca-bulk-current]');if(current)current.textContent=b.current||'';
 const stop=root.querySelector('[data-ca-bulk-stop]');if(stop){stop.disabled=b.stop;stop.textContent=b.stop?'Stopping…':'■ Stop after current'}
}
function caSaveCheckpoint(b){
 // Save identifiers and progress only: never store source documents or API keys.
 const cp={ids:b.ids,completedIds:b.completedIds,total:b.total,done:b.done,
   success:b.success,failed:b.failed,current:b.current,
   startedAt:b.startedAt,updatedAt:new Date().toISOString(),running:false};
 state.aiBatchCheckpoint=cp;save();
}
async function caBulkGenerate(resume=false){
 if(caUI.bulk?.running||caUI.busyId!==null||caUI.loading)return;
 if(!caUI.ai||!caUI.online){caUI.error='Sign in and configure Gemini before generating notes.';caStableRender();return}
 let articles=[],usage=0;
 try{
   const q=await caRequest('/api/ai/usage');
   if(!q.enabled)throw Error('Gemini is not configured.');
   usage=Number(q.used)||0;
   for(let offset=0;offset<=9900;offset+=300){
     const result=await caRequest('/api/articles?limit=300&offset='+offset);
     const portion=result.items||[];articles.push(...portion);
     if(portion.length<300)break;
   }
 }catch(e){caUI.error='Unable to prepare batch: '+e.message;caStableRender();return}
 const eligible=new Map(articles.filter(a=>['PIB','PRS','PDF'].includes(a.source)).map(a=>[a.id,a]));
 const previous=resume?state.aiBatchCheckpoint:null;
 if(resume&&(!previous||!Array.isArray(previous.ids))){caUI.error='No saved batch found.';caStableRender();return}
 const ids=resume?previous.ids.filter(id=>eligible.has(id)):
              articles.filter(a=>!a.analysis&&eligible.has(a.id)).map(a=>a.id);
 const completed=new Set(resume?(previous.completedIds||[]):[]);
 let successes=resume?(previous.success||0):0;
 for(const id of ids){
   if(!completed.has(id)&&eligible.get(id)?.analysis){completed.add(id);successes++}
 }
 const queue=ids.filter(id=>!completed.has(id));
 if(!queue.length){
   if(resume){
     const cp={...previous,completedIds:[...completed],done:ids.length,success:successes,
       current:'All batch articles already have notes.',running:false};
     caUI.bulk=cp;caSaveCheckpoint(cp);caStableRender();return;
   }
   caUI.error='All imported articles already have saved Gemini notes.';
   caStableRender();return;
 }
 if(!confirm((resume?'Resume':'Start')+' Gemini generation for '+queue.length+' remaining articles?\n'+
    'Generated today: '+usage+'. Gemini API quotas and possible billing charges apply.\n'+
    'Completed articles are skipped. Keep this tab open while generating; you can stop and resume later.'))return;
 const b={ids,completedIds:[...completed],running:true,stop:false,
   total:ids.length,done:completed.size,success:successes,
   failed:resume?(previous.failed||0):0,
   current:'Starting batch…',startedAt:resume?previous.startedAt:new Date().toISOString()};
 caUI.bulk=b;caUI.error='';caSaveCheckpoint(b);caStableRender();
 let consecutiveErrors=0;
 for(const id of queue){
   if(b.stop)break;
   const row=eligible.get(id);
   b.current=row?.title||'Official article';caBulkPaint();
   let finishThis=true;
   try{
     const result=await caRequest('/api/articles/'+encodeURIComponent(id)+'/analyze',{method:'POST'});
     const current=caUI.items.find(x=>x.id===id);
     if(current&&result?.id)Object.assign(current,result);
     const article=document.querySelector('.ca-article[data-ca-item="'+id+'"]');
     if(article){const btn=article.querySelector('[data-ca-quick]');if(btn){btn.textContent='✳ View Gemini Notes';btn.disabled=false}}
     b.success++;consecutiveErrors=0;
   }catch(e){
     const msg=String(e?.message||'Unknown error');
     if(/429|quota|rate limit|resource.exhausted/i.test(msg)){
       finishThis=false;b.stop=true;
       b.current='Gemini quota reached. The remaining queue is saved for later.';
     }else{
       b.failed++;consecutiveErrors++;
       b.current='Skipped: '+(row?.title||'article')+' — '+msg.slice(0,120);
       if(consecutiveErrors>=3){b.stop=true;b.current='Paused after 3 errors. Check source or Gemini access.'}
     }
   }finally{
     if(finishThis&&!completed.has(id)){
       completed.add(id);b.completedIds=[...completed];b.done=completed.size;
     }
     caSaveCheckpoint(b);caBulkPaint();
   }
 }
 b.running=false;
 if(b.done===b.total)b.current='All '+b.total+' articles processed. '+b.success+' saved.';
 else if(!b.current.includes('quota')&&!b.current.includes('Paused'))b.current='Paused after '+b.done+' of '+b.total+' articles.';
 caSaveCheckpoint(b);
 try{await caLoad({renderAfter:false})}catch(e){}
 if(page==='current')caStableRender();
 toast('Gemini batch: '+b.success+' notes saved · '+b.failed+' failed · '+(b.total-b.done)+' remaining.');
}

let caLoadEpoch=0;
async function caLoad({renderAfter=true}={}){
 const epoch=++caLoadEpoch;
 try{
   const cloud=window.SYLLABUS_CLOUD;
   if(!cloud)throw Error('Cloud module unavailable. Reload the page.');
   // Cloud startup and session refresh may not have completed when Current Affairs opens.
   if(cloud.ready){
     await Promise.race([cloud.ready,new Promise((_,reject)=>setTimeout(
       ()=>reject(Error('Cloud connection did not finish starting. Retry.')),18000))]);
   }
   if(!cloud.loggedIn)throw Error(cloud.status||'Sign in with ☁ Cloud to load your news.');
   const [health,list]=await Promise.all([
     caRequest('/api/health'),
     caRequest('/api/articles?'+new URLSearchParams({
       source:caUI.source,tag:caUI.tag,date_from:caUI.from,
       date_to:caUI.to,q:caUI.search,limit:'200'
     }))
   ]);
   if(epoch!==caLoadEpoch)return;
   caUI.online=health.online===true;
   caUI.ai=health.ai_enabled===true;
   caUI.auto=health.auto_sync===true;
   caUI.lastSync=health.last_sync;
   caUI.items=list.items||[];
   caUI.collapsed=list.duplicates_collapsed||0;
   caUI.error='';
 }catch(e){
   if(epoch!==caLoadEpoch)return;
   caUI.online=false;
   caUI.ai=false;
   caUI.error='Cloud unavailable: '+(e.message||'Network error')+' · Retry connection or sign in.';
 }
 if(renderAfter&&page==='current')caStableRender();
}
async function caSync(){caUI.loading=true;render();try{const x=await caRequest('/api/refresh',{method:'POST'});caUI.lastSync=x;caUI.error=x.errors?.length?'Some sources were unreachable: '+x.errors.join(' · '):`Sync completed: ${x.added} new entries`;await caLoad();}catch(e){caUI.error=e.message}finally{caUI.loading=false;render()}}
async function caMutation(fn,id){
 if(caUI.busyId!==null||caUI.bulk?.running)return;
 caUI.busyId=id;
 const item=document.querySelector('.ca-article[data-ca-item="'+id+'"]');
 if(item){item.setAttribute('aria-busy','true');const btn=item.querySelector('[data-ca-quick]');if(btn){btn.disabled=true;btn.textContent='⏳ Generating…'}}
 try{
   const result=await fn();
   const found=caUI.items.find(a=>a.id===id);if(found&&result?.id)Object.assign(found,result);
   await caLoad({renderAfter:false});
 }catch(e){caUI.error=e.message;toast(e.message)}
 finally{caUI.busyId=null;if(page==='current')caStableRender(id)}
}
function renderOverview(){
 const s=stats(),tasks=getDayTasks(day),done=tasks.filter(t=>taskDone(t.id)).length,days=Math.max(0,dayDiff(todayISO(),SEED.examDate));
 const urgent=urgentReminders(),due=dueTopics(),backlog=backlogTasks();const w=currentWeek(weekIndex);
 return `<section class="hero-bento"><div class="hero-panel"><div class="hero-sticker">✳ YOUR PRELIMS ERA</div><div class="hero-micro">THE 2027 ROAD TO PRELIMS <span>↗</span></div><h1>Less scrolling.<br><em>More scoring.</em></h1><p>${dayDiff(SEED.startDate,SEED.endDate)+1} days. One mission. Build the consistency that makes May feel different.</p><div class="hero-actions"><button class="hero-cta" data-nav="today">Let’s get into it <span>↗</span></button><span class="hero-caption">${days} DAYS TO YOUR TARGET DATE</span></div><div class="hero-noise" aria-hidden="true">✳</div></div>${timerWidget(true)}</section><div class="section-heading dashboard-label"><div><h2>Your numbers, no guesswork</h2><p>Progress and readiness are tracked separately</p></div><span class="small-tag">LIVE OVERVIEW</span></div>`+
 recoveryDashboard()+`<div class="cards">${statCard('Syllabus coverage',`${s.coverage}%`,'Weighted score updates as topics change','◉')}${statCard('Exam-ready topics',s.ready,`${s.done} marked covered · readiness is separate`,'◇')}${statCard('Revision queue',due.length,'Includes previously completed topics','↻')}${statCard('Study time logged',shortDuration(dailyStudied(todayISO())),`${Math.round(dailyStudied(todayISO())/21600*100)}% of 6h goal recorded`,'◷')}</div>
 <div class="ca-home-strip"><div><span>✳ NEW / CURRENT AFFAIRS STUDIO</span><strong>PIB + PRS + PDFs → your revision notes.</strong></div><button class="primary-btn" data-nav="current">Open the intelligence desk ↗</button></div><div class="section-heading"><div><h2>Today’s study plan</h2><p>${niceDate(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · 6-hour allocation</p></div><button class="outline-btn" data-nav="today">Open daily planner ↗</button></div>
 <div class="grid-main"><div class="card"><div class="split-heading"><div><strong class="card-title">Today’s targets</strong><div class="tiny text-muted">Topic-specific tasks, not a generic subject list</div></div><span class="small-tag">${tasks.reduce((a,t)=>a+t.minutes,0)} min</span></div>${tasks.map(taskRow).join('')}</div>
 <div class="card"><div class="split-heading"><strong class="card-title">Subject coverage</strong><button class="text-btn" data-nav="syllabus">View all 187 ↗</button></div>${subjectBars(s.ss)}<div class="divider"></div><p class="tiny text-muted">Coverage ≠ exam readiness. History and Economy remain in your revision queue.</p></div></div>
 ${backlog.length?`<div class="section-heading"><h2>Unfinished-task backlog</h2><span class="small-tag">${backlog.length} overdue tasks</span></div><div class="card">${backlog.slice(0,5).map(t=>`<div class="mini-item"><div><strong>${h(t.title)}</strong><div class="subtext">${niceDate(t.date)} · ${h(t.detail)}</div></div><button class="text-btn" data-day-open="${t.date}">Open day ↗</button></div>`).join('')}</div>`:''}<div class="section-heading"><h2>Upcoming & important</h2></div><div class="grid-half"><div class="card"><div class="split-heading"><strong class="card-title">Week ${weekIndex+1}: ${h(w.focus)}</strong><button class="text-btn" data-nav="weekly">Weekly brief ↗</button></div><p class="small text-muted">${h(readableWeek(weekIndex))}</p><p class="small">${h(w.goal)}</p><div class="divider"></div>${w.resources.map(r=>`<div class="mini-item"><span>📄 ${h(r)}</span></div>`).join('')}</div>
 <div class="card"><div class="split-heading"><strong class="card-title">Attention queue</strong><button class="text-btn" data-nav="revision">Revision center ↗</button></div>${urgent.length?urgent.slice(0,3).map(r=>`<div class="mini-item"><span>⏰ ${h(r.title)}</span><span class="small-tag">${h(niceDate(r.dueAt.slice(0,10)))}</span></div>`).join(''):''}${due.slice(0,4).map(t=>`<div class="mini-item"><span>${h(t.title)}</span><button class="text-btn" data-revise="${t.id}">Revised ✓</button></div>`).join('')}${!urgent.length&&!due.length?'<div class="empty">No items due</div>':''}</div></div>`;
}
function renderToday(){const d=day,wi=Math.floor(dayDiff(SEED.startDate,d)/7),offset=dayDiff(SEED.startDate,d)%7,w=SEED.weeks[wi],dates=Array.from({length:7},(_,i)=>addDays(SEED.startDate,wi*7+i)).filter(t=>t<=SEED.endDate),tasks=getDayTasks(d),done=tasks.filter(t=>taskDone(t.id)),min=done.reduce((a,t)=>a+t.minutes,0);
 return heading('Daily mission control',`${niceDate(d,{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · Week ${wi+1}: ${w.focus}`,'DAILY PLANNER')+
 `<div class="card"><div class="split-heading"><strong class="card-title">Select a day</strong><div class="callout-date"><button class="outline-btn" data-shift="-1">←</button><input class="input" type="date" id="day-picker" min="${SEED.startDate}" max="${SEED.endDate}" value="${d}"><button class="outline-btn" data-shift="1">→</button></div></div><div class="date-strip">${dates.map(t=>`<button class="day-chip ${d===t?'selected':''} ${t===todayISO()?'today':''}" data-day="${t}"><span>${niceDate(t,{weekday:'short'})}</span><strong>${niceDate(t,{day:'numeric'})}</strong></button>`).join('')}</div><div class="metric-row"><span>${done.length} of ${tasks.length} targets finished</span><strong>${min} / 360 min</strong></div>${progress(min/360*100)}</div>
 ${recoveryDashboard()}<div class="section-heading"><h2>Six-hour target breakdown</h2><span class="small-tag">${h(w.focus)}</span></div><div class="grid-main"><div class="card">${tasks.map(taskRow).join('')}</div><div class="card"><strong class="card-title">Daily accountability</strong><p class="small text-muted">Check off only completed work. Missed priority targets are moved into future catch-up slots.</p>${d<=todayISO()?'<button class="outline-btn" data-mark-missed="'+d+'" data-mark-missed-value="'+(state.missedDays[d]?'0':'1')+'">'+(state.missedDays[d]?'↶ Remove missed-day flag':'◷ Mark this day missed')+'</button>':'<span class="small-tag">Upcoming day</span>'}<div class="notice">${offset===6?'Weekly assessment day: focus on timed practice, error analysis and catch-up.':'Completed subjects require active recall and PYQs. Reading alone does not mark a topic exam-ready.'}</div><div class="divider"></div><strong class="card-title">This week’s documents</strong>${w.resources.map((r,ri)=>resourceRow(wi,ri,r)).join('')}<button class="outline-btn" data-brief="${wi}" style="margin-top:13px">Download weekly reading brief ↓</button></div></div>`;
}
function resourceRow(wi,ri,r){const id=`${wi}:${ri}`;return `<label class="resource-row"><input class="check" type="checkbox" data-resource="${id}" ${state.readResources[id]?'checked':''}><div><strong class="small">${h(r)}</strong><div class="subtext">Suggested reading reference; add your actual document in the Library</div></div></label>`}
function renderWeekly(){const w=currentWeek(weekIndex),dates=weekDates(weekIndex),days=Array.from({length:7},(_,i)=>addDays(dates.start,i)).filter(x=>x<=SEED.endDate);
 return heading('Weekly roadmap',`${SEED.weeks.length} study weeks from 12 Nov 2026 to 7 May 2027, with 6-hour daily targets and adaptive missed-day catch-up.`,'STUDY ROADMAP')+
 `<div class="section-heading"><div><h2>Week ${weekIndex+1}: ${h(w.focus)}</h2><p>${niceDate(dates.start)} – ${niceDate(dates.end)} · ${h(w.phase)} phase</p></div><button class="primary-btn" data-brief="${weekIndex}">↓ Export this week</button></div>
 <div class="grid-main"><div class="card"><strong class="card-title">This week’s day-by-day targets</strong>${days.map((d,i)=>{const t=getDayTasks(d);const newone=t.find(x=>x.category==='New'||x.category==='Mock')||t[0];const completed=t.filter(x=>taskDone(x.id)).length;return `<div class="mini-item"><div><div class="small"><strong>${h(niceDate(d,{weekday:'short',day:'numeric',month:'short'}))}</strong> — ${h(newone.detail)}</div><div class="subtext">${h(t.map(x=>x.category).join(' · '))}</div></div><button class="outline-btn" data-day-open="${d}">${completed}/${t.length} ↗</button></div>`}).join('')}</div><div class="card"><strong class="card-title">Reading and document checklist</strong><p class="small text-muted">Specific chapters are selected by content area; page numbers depend on your book editions.</p>${w.resources.map((r,ri)=>resourceRow(weekIndex,ri,r)).join('')}<div class="divider"></div><strong class="card-title">Weekly success target</strong><p class="small">${h(w.goal)}</p><div class="notice">Upload PDFs or attach online reference links under <strong>Documents</strong>. This brief does not include copyrighted textbook files.</div></div></div>
 <div class="section-heading"><h2>All ${SEED.weeks.length} weeks</h2></div><div class="week-list">${SEED.weeks.map((x,i)=>`<button class="week-card ${weekIndex===i?'selected':''}" data-week="${i}"><div class="week-label">WEEK ${i+1} · ${h(x.phase.toUpperCase())}</div><div class="week-title">${h(x.focus)}</div><div class="week-dates">${h(readableWeek(i))}</div></button>`).join('')}</div>`;
}
function renderSyllabus(){const ss=stats();const list=SEED.topics.filter(t=>(subjectFilter==='all'||t.subject===subjectFilter)&&(statusFilter==='all'||topicStatus(t)===statusFilter)&&(`${t.title} ${t.group}`.toLowerCase().includes(query.toLowerCase())));
 return heading('187-topic syllabus database',`Live weighted coverage ${ss.coverage}% · ${ss.done} completed · ${ss.partial} partial · ${ss.none} not started.`,`SYLLABUS TRACKER`)+
 `<div class="cards">${statCard('Fully covered',ss.done,'All need serious revision','✓')}${statCard('Partially covered',ss.partial,'Complete remaining concepts','◐')}${statCard('Not started',ss.none,'Prioritize using the roadmap','○')}${statCard('Exam-ready',ss.ready,'Set after satisfactory testing','★')}</div>
 <div class="section-heading"><h2>Individual topics</h2><span class="small-tag">${list.length} shown</span></div><div class="card"><div class="filters"><input class="input" id="topic-search" placeholder="Search syllabus topics…" value="${h(query)}"><select class="select" id="subject-filter"><option value="all">All subjects</option>${SEED.subjects.map(s=>`<option value="${s.id}" ${subjectFilter===s.id?'selected':''}>${h(s.short)}</option>`).join('')}</select><select class="select" id="status-filter"><option value="all">All statuses</option>${[['done','Completed'],['revision','Needs revision'],['partial','Partial'],['none','Not started']].map(([v,label])=>`<option value="${v}" ${statusFilter===v?'selected':''}>${label}</option>`).join('')}</select></div>
 <div class="table-wrap"><table class="tbl"><thead><tr><th>Topic</th><th>Priority</th><th>Status</th><th>Readiness</th></tr></thead><tbody>${list.map(t=>{const p=state.topics[t.id];return `<tr><td><span class="topic-text">${h(t.title)}</span><div class="subtext">${h(t.group)} · ${h(SEED.subjects.find(s=>s.id===t.subject).short)}</div></td><td><select aria-label="Priority for ${h(t.title)}" class="select" data-priority="${t.id}">${['A','B','C'].map(v=>`<option value="${v}" ${p.priority===v?'selected':''}>${v} ${v==='A'?'high':v==='B'?'medium':'selective'}</option>`).join('')}</select></td><td><select aria-label="Status for ${h(t.title)}" class="select" data-topic-status="${t.id}">${[['none','Not started'],['partial','Partial'],['done','Completed'],['revision','Needs revision']].map(([v,label])=>`<option value="${v}" ${p.status===v?'selected':''}>${label}</option>`).join('')}</select></td><td><button class="outline-btn" data-ready="${t.id}">${p.ready?'★ Exam-ready':'☆ Not verified'}</button></td></tr>`}).join('')}</tbody></table></div>${!list.length?'<div class="empty">No topics match the filters.</div>':''}</div>`;
}

const REVISION_INTERVALS=[1,3,7,15,30,60];
function revisionWeakScore(tid){return Math.max(0,Number(state.topicWeakness[tid])||0)}
function topicRevisionDate(t){return state.topics[t.id]?.revisionDue||null}
function gradeRecall(tid,quality){
 const topic=SEED.topics.find(t=>t.id===tid);if(!topic)return;
 const p=state.topics[tid];if(!p)return;
 const weak=quality==='hard';
 if(weak){
   state.topicWeakness[tid]=Math.min(30,revisionWeakScore(tid)+2);
   p.revisionStage=0;p.revisionDue=addDays(todayISO(),1);p.ready=false;
 }else{
   state.topicWeakness[tid]=Math.max(0,revisionWeakScore(tid)-1);
   const current=Number(p.revisionStage)||0;
   p.revisionDue=addDays(todayISO(),REVISION_INTERVALS[Math.min(current,REVISION_INTERVALS.length-1)]);
   p.revisionStage=Math.min(REVISION_INTERVALS.length,current+1);
   if(p.status==='none')p.status='partial';
 }
 save();render();
 toast(weak?'Added to weak topics · revisit tomorrow':'Recall saved · next review '+niceDate(p.revisionDue));
}

/* PRACTICE STUDIO: answer only questions attached to saved Gemini notes.
   Every untested syllabus topic remains available for honest active recall. */
let practiceBusy=false, practiceError='',practiceRecallId=null;
const SUBJECT_FOR_TAG={
 'Polity':'polity','Economy':'economy','Environment':'environment',
 'Geography':'geography','Science & Tech':'science',
 'History & Culture':'history','International Relations':'current',
 'Social Issues':'economy'
};
function practiceSubject(article){return SUBJECT_FOR_TAG[(article.tags||[])[0]]||'current'}
function practiceTokens(text){
 const stop=new Set(['the','and','for','with','from','india','indian','about','which','what','does','into','this','that','have','been','under','are','was','how','would','some']);
 return new Set((String(text||'').toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>!stop.has(w)));
}
function practiceMatchingTopic(article,question,subject){
 const words=practiceTokens(article.title+' '+question);
 let candidate=null,best=0;
 for(const t of SEED.topics){
   if(t.subject!==subject)continue;
   const terms=practiceTokens(t.title),shared=[...terms].filter(w=>words.has(w)).length;
   if(shared>=2&&shared>best){best=shared;candidate=t.id}
 }
 return candidate;
}
function practiceQuestionsFor(articles){
 const questions=[];
 for(const a of articles){
   const analysis=a.analysis;if(!analysis||!Array.isArray(analysis.mcqs))continue;
   const subject=practiceSubject(a);
   analysis.mcqs.slice(0,12).forEach((q,i)=>{
     if(!q||typeof q.question!=='string'||!Array.isArray(q.options)||q.options.length!==4||
         !q.options.every(x=>typeof x==='string'&&x.trim())||
         !Number.isInteger(q.answer_index)||q.answer_index<0||q.answer_index>3||
         typeof q.explanation!=='string'||!q.explanation.trim())return;
     questions.push({id:a.id+':'+i,articleId:a.id,question:q.question.slice(0,750),
        options:q.options.map(x=>x.slice(0,400)),answer_index:q.answer_index,
        explanation:q.explanation.slice(0,1200),sourceTitle:a.title,
        sourceUrl:caSafeLink(a)||'',subject,topicId:practiceMatchingTopic(a,q.question,subject)});
   });
 }
 const today=todayISO();
 const fingerprint=v=>{let n=0;for(const c of today+v)n=((n<<5)-n+c.charCodeAt(0))|0;return n>>>0};
 questions.sort((a,b)=>{
   const aMiss=state.mistakeLog.some(x=>x.id===a.id&&!x.resolved);
   const bMiss=state.mistakeLog.some(x=>x.id===b.id&&!x.resolved);
   const aw=(aMiss?500:0)+(Number(state.subjectWeakness[a.subject])||0)*30;
   const bw=(bMiss?500:0)+(Number(state.subjectWeakness[b.subject])||0)*30;
   return bw-aw||fingerprint(a.id)-fingerprint(b.id);
 });
 // Limit each source article to 3 questions; the stored source remains inspectable.
 return questions;
}
async function startDailyPractice(){
 if(practiceBusy)return;
 if(state.activePractice&&state.activePractice.pos<state.activePractice.questions.length){
   if(!confirm('Discard your unfinished quiz and create a new one?'))return;
 }
 practiceBusy=true;practiceError='';render();
 try{
   if(!window.SYLLABUS_CLOUD?.loggedIn)throw Error('Sign in to Cloud to load saved Gemini MCQs.');
   const articles=[];
   for(let offset=0;offset<3000;offset+=300){
     const result=await caRequest('/api/articles?limit=300&offset='+offset);
     const batch=result.items||[];articles.push(...batch);
     if(batch.length<300)break;
   }
   const questions=practiceQuestionsFor(articles).slice(0,20);
   if(!questions.length)throw Error('No verified saved Gemini MCQs yet. Generate notes for PIB/PRS articles, then return here. Topic recall is available now.');
   state.activePractice={id:rid(),date:todayISO(),startedAt:new Date().toISOString(),
     questions,answers:[],pos:0};
   save();toast('Daily quiz ready · '+questions.length+' source-linked MCQs');
 }catch(e){practiceError=e.message;toast(e.message)}
 finally{practiceBusy=false;render()}
}
function practiceNoteWeak(q,chosen){
 const now=new Date().toISOString(),wrong=chosen!==q.answer_index;
 const existing=state.mistakeLog.find(x=>x.id===q.id);
 if(wrong){
   if(existing){existing.count=(existing.count||1)+1;existing.lastMissed=now;existing.resolved=false;
      existing.chosen=chosen;}
   else state.mistakeLog.unshift({id:q.id,question:q.question,options:q.options,
      answer_index:q.answer_index,explanation:q.explanation,sourceTitle:q.sourceTitle,
      sourceUrl:q.sourceUrl,subject:q.subject,topicId:q.topicId||null,
      lastMissed:now,chosen,count:1,resolved:false});
   state.subjectWeakness[q.subject]=Math.min(40,(Number(state.subjectWeakness[q.subject])||0)+1);
   const topicId=existing?.topicId||q.topicId;
   if(topicId&&state.topics[topicId]){
     state.topicWeakness[topicId]=Math.min(30,revisionWeakScore(topicId)+2);
     const p=state.topics[topicId];p.ready=false;p.revisionStage=0;p.revisionDue=addDays(todayISO(),1);
   }
 }else{
   if(existing)existing.resolved=true;
   state.subjectWeakness[q.subject]=Math.max(0,(Number(state.subjectWeakness[q.subject])||0)-1);
   const resolvedTopic=existing?.topicId||q.topicId;
   if(resolvedTopic)state.topicWeakness[resolvedTopic]=Math.max(0,revisionWeakScore(resolvedTopic)-1);
 }
 state.mistakeLog=state.mistakeLog.slice(0,250);
}
function practiceAnswer(idx){
 const a=state.activePractice;if(!a||a.answers[a.pos]!==undefined)return;
 const q=a.questions[a.pos];if(!q||!Number.isInteger(idx)||idx<0||idx>3)return;
 a.answers[a.pos]=idx;
 practiceNoteWeak(q,idx);
 save();render();
}
function practiceNext(){
 const a=state.activePractice;if(!a||a.answers[a.pos]===undefined)return;
 if(a.pos<a.questions.length-1){a.pos++;save();render();return}
 const correct=a.questions.reduce((n,q,i)=>n+(a.answers[i]===q.answer_index?1:0),0);
 const wrong=a.questions.length-correct;
 const duration=Math.max(0,Math.round((Date.now()-Date.parse(a.startedAt))/60000));
 state.practiceHistory.unshift({id:a.id,date:a.date,correct,wrong,total:a.questions.length,
   score:Number((2*correct-2*wrong/3).toFixed(2)),minutes:duration,
   finishedAt:new Date().toISOString()});
 state.practiceHistory=state.practiceHistory.slice(0,100);
 state.activePractice=null;save();render();
 toast('Quiz saved · '+correct+'/'+(correct+wrong)+' correct');
}
function practiceRecallSelect(id){if(!state.topics[id])return;practiceRecallId=id;render()}
function practiceLinkMistake(mid,tid){
 const item=state.mistakeLog.find(m=>m.id===mid);
 if(!item)return;
 const previous=item.topicId;
 if(previous===tid)return;
 item.topicId=tid||null;
 if(tid&&state.topics[tid]){
   state.topicWeakness[tid]=Math.min(30,revisionWeakScore(tid)+2);
   const p=state.topics[tid];p.ready=false;p.revisionDue=addDays(todayISO(),1);p.revisionStage=0;
 }
 save();render();toast('Mistake linked to your topic revision calendar');
}
function renderPractice(){
 const session=state.activePractice,history=state.practiceHistory||[],mistakes=state.mistakeLog||[];
 const unresolved=mistakes.filter(m=>!m.resolved),latest=history[0];
 const weakness=SEED.subjects.map(s=>({subject:s,score:Number(state.subjectWeakness[s.id])||0}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 const allWeakTopics=SEED.topics.filter(t=>revisionWeakScore(t.id)>0)
  .sort((a,b)=>revisionWeakScore(b.id)-revisionWeakScore(a.id));
 const weakTopics=allWeakTopics.slice(0,12);
 let html=heading('Prelims Practice Studio',
  'Daily source-grounded MCQs, honest active recall for every syllabus topic and a mistake notebook that guides revision.',
  'DAILY QUIZ / WEAK AREAS');
 html+='<div class="cards">'+
  statCard('Completed quizzes',history.length,'Saved to your study state','◫')+
  statCard('Unresolved mistakes',unresolved.length,'Revisit and retest','!')+
  statCard('Weak syllabus topics',allWeakTopics.length,'Linked to revisions','↻')+
  statCard('Recent accuracy',latest?Math.round(latest.correct/(latest.total||1)*100)+'%':'—','From your latest daily quiz','◎')+'</div>';
 if(practiceError)html+='<div class="ca-message">'+h(practiceError)+'</div>';
 html+='<section class="practice-card"><div class="section-heading"><div><h2>Smart daily quiz</h2><p>Up to 20 MCQs from existing Gemini notes. Generates no new AI calls.</p></div>'+
  '<button class="primary-btn" data-practice-start '+(practiceBusy?'disabled':'')+'>'+
  (practiceBusy?'Loading saved questions…':session?'↻ New daily quiz':'▶ Start daily quiz')+'</button></div>';
 if(session){
   const q=session.questions[session.pos],answered=session.answers[session.pos],done=answered!==undefined;
   html+='<div class="practice-quiz-meta"><span>QUESTION '+(session.pos+1)+' / '+session.questions.length+'</span><span>'+h(SEED.subjects.find(s=>s.id===q.subject)?.short||q.subject)+'</span></div>'+
     '<div class="practice-meter"><i style="width:'+Math.round((session.pos+(done?1:0))/session.questions.length*100)+'%"></i></div>'+
     '<h3 class="practice-question">'+h(q.question)+'</h3>'+
     '<div class="practice-options">'+q.options.map((o,i)=>'<button class="practice-option '+(done?(i===q.answer_index?'correct':i===answered?'incorrect':''):'')+
       '" data-practice-answer="'+i+'" '+(done?'disabled':'')+'><strong>'+String.fromCharCode(65+i)+'</strong><span>'+h(o)+'</span></button>').join('')+'</div>'+
     (done?'<div class="practice-explanation"><strong>'+(answered===q.answer_index?'✓ Correct answer':'✕ Needs revision · Answer '+String.fromCharCode(65+q.answer_index))+'</strong><p>'+h(q.explanation)+'</p></div>':'')+
     '<p class="practice-source">Source: '+(q.sourceUrl?'<a target="_blank" rel="noopener noreferrer" href="'+h(q.sourceUrl)+'">'+h(q.sourceTitle)+'</a>':h(q.sourceTitle))+
     ' · '+(q.topicId?'Suggested topic: '+h(SEED.topics.find(t=>t.id===q.topicId)?.title||''):'Topic association not certain; choose it in Mistake Notebook if needed.')+'</p>'+
     (done?'<button class="primary-btn" data-practice-next>'+(session.pos===session.questions.length-1?'Finish & save score':'Next question →')+'</button>':'');
 }else html+='<p class="small text-muted">Only saved source-linked questions are used. If none are available, generate Gemini notes in Current Affairs. You can still practise every syllabus topic using Active Recall below.</p>';
 html+='</section>';
 html+='<section class="practice-card"><div class="section-heading"><div><h2>Active recall · all '+SEED.topics.length+' topics</h2><p>Try remembering three facts without opening notes. Grade yourself after checking your study material.</p></div><button class="outline-btn" data-nav="revision">Open full calendar ↗</button></div>';
 const focus=practiceRecallId&&state.topics[practiceRecallId]?SEED.topics.find(t=>t.id===practiceRecallId):
  dueTopics().sort((a,b)=>revisionWeakScore(b.id)-revisionWeakScore(a.id))[0]||SEED.topics[0];
 html+='<div class="practice-recall-focus"><span class="small-tag">'+h(SEED.subjects.find(s=>s.id===focus.subject)?.short||focus.subject)+'</span><h3>'+h(focus.title)+'</h3>'+
  '<p>Recall its definition, essential concepts and exam-relevant examples. Verify them in your textbook or official notes before choosing your confidence level.</p>'+
  '<div class="ca-actions"><button class="outline-btn" data-recall-hard="'+h(focus.id)+'">Struggled · review tomorrow</button><button class="primary-btn" data-recall-good="'+h(focus.id)+'">Remembered · schedule next</button></div></div>';
 html+='<div class="practice-recall-topics">'+[...new Map([...weakTopics,...dueTopics(),...SEED.topics].map(t=>[t.id,t])).values()].slice(0,10).map(t=>
  '<button class="practice-recall-pick" data-practice-recall="'+h(t.id)+'">'+h(t.title)+(revisionWeakScore(t.id)?' · Weak':'')+'</button>').join('')+'</div></section>';
 html+='<section class="practice-card"><div class="section-heading"><div><h2>Your weak areas</h2><p>Derived from wrong answers and self-rated recall, not assumptions.</p></div></div>'+
  (weakness.length?'<div class="practice-weak-subjects">'+weakness.map(x=>'<span class="ca-linktag">'+h(x.subject.short)+' · '+x.score+' errors</span>').join('')+'</div>':'<p class="small text-muted">No weaknesses recorded yet. A quiz or recall session will start your evidence-based tracker.</p>')+
  (weakTopics.length?'<div class="practice-weak-grid">'+weakTopics.map(t=>'<button class="practice-recall-pick" data-practice-recall="'+h(t.id)+'">'+h(t.title)+' · '+revisionWeakScore(t.id)+'</button>').join('')+'</div>':'')+
  '</section>';
 html+='<section class="practice-card"><div class="section-heading"><div><h2>Mistake notebook</h2><p>Wrong MCQs remain here until you answer correctly on a future quiz. Assign a syllabus topic when a match is unclear.</p></div></div>';
 if(!mistakes.length)html+='<p class="small text-muted">No mistakes logged. Incorrect answers will appear automatically.</p>';
 for(const m of mistakes.slice(0,24)){
   const opts=SEED.topics.filter(t=>t.subject===m.subject);
   html+='<div class="practice-mistake"><div class="practice-quiz-meta"><span>'+h(m.sourceTitle||'Saved question')+'</span><span>'+(m.resolved?'✓ Resolved':'Review needed')+' · '+(m.count||1)+' miss(es)</span></div>'+
    '<strong>'+h(m.question)+'</strong><p>Correct: '+h(m.options[m.answer_index]||'')+'</p><p class="small text-muted">'+h(m.explanation||'')+'</p>'+
    '<label class="practice-link-label">Link to syllabus topic <select class="select" data-practice-mistake-id="'+h(m.id)+'"><option value="">Unassigned / subject-level</option>'+
    opts.map(t=>'<option value="'+h(t.id)+'" '+(m.topicId===t.id?'selected':'')+'>'+h(t.title)+'</option>').join('')+'</select></label></div>';
 }
 html+='</section>';
 if(history.length)html+='<section class="practice-card"><h2>Quiz history</h2>'+history.slice(0,10).map(x=>
  '<div class="mini-item"><strong>'+h(niceDate(x.date))+'</strong><span>'+x.correct+'/'+x.total+' correct · Score '+x.score+' · '+x.minutes+' min</span></div>').join('')+'</section>';
 return html;
}

function renderRevision(){
 const due=dueTopics(),today=todayISO(),subjectOptions=[['all','All subjects'],...SEED.subjects.map(s=>[s.id,s.short])];
 const all=SEED.topics.filter(t=>{
   const p=state.topics[t.id];
   return (revisionFilter==='all'||revisionFilter==='due'&&due.some(x=>x.id===t.id)||
      revisionFilter==='weak'&&revisionWeakScore(t.id)>0||
      revisionFilter==='unstarted'&&p.status==='none'||
      revisionFilter==='scheduled'&&p.revisionDue>today||
      revisionFilter==='ready'&&p.ready)&&
      (subjectFilter==='all'||t.subject===subjectFilter);
 });
 all.sort((a,b)=>revisionWeakScore(b.id)-revisionWeakScore(a.id)||
     (topicRevisionDate(a)||'0000').localeCompare(topicRevisionDate(b)||'0000'));
 const current=all.slice(0,revisionPageSize);
 const upcoming=SEED.topics.filter(t=>state.topics[t.id].revisionDue&&
      state.topics[t.id].revisionDue>=today&&
      state.topics[t.id].revisionDue<=addDays(today,30));
 const byDay={};for(const t of upcoming){const d=topicRevisionDate(t);(byDay[d]||=[]).push(t)}
 const groups=Object.keys(byDay).sort().slice(0,16).map(d=>'<div class="revision-day"><strong>'+h(niceDate(d,{day:'numeric',month:'short'}))+'</strong><span>'+byDay[d].length+' topic(s)</span><small>'+h(byDay[d].slice(0,3).map(t=>t.title).join(' · '))+'</small></div>').join('');
 return heading('Smart revision calendar','Complete syllabus coverage with recall stages on days 1, 3, 7, 15, 30 and 60. Weak topics are brought forward.','ALL 187 TOPICS / SPACED RECALL')+
  '<div class="cards">'+
  statCard('Total syllabus topics',SEED.topics.length,'Across all subjects','◫')+
  statCard('Due to recall',due.length,'Includes weak topics','↻')+
  statCard('Need to learn',SEED.topics.filter(t=>state.topics[t.id].status==='none').length,'No false completion','◎')+
  statCard('Weak topics',SEED.topics.filter(t=>revisionWeakScore(t.id)>0).length,'From recall and quiz errors','!')+
  '</div>'+
  '<div class="revision-calendar"><div class="section-heading"><h2>Next 30 days</h2><span class="small-tag">All subjects</span></div><div class="revision-calendar-grid">'+
  (groups||'<p class="small text-muted">No future reviews scheduled yet. Mark topics revised or complete recall practice to build your calendar.</p>')+
  '</div></div>'+
  '<div class="section-heading"><div><h2>Full syllabus review queue</h2><p>Unstarted topics stay visible as learning targets; they are not marked learned automatically.</p></div><span class="small-tag">'+all.length+' topics</span></div>'+
  '<div class="practice-filters"><select class="select" id="revision-filter" aria-label="Revision list filter">'+
  [['all','All topics'],['due','Due now'],['weak','Weak topics'],['unstarted','To learn'],['scheduled','Scheduled'],['ready','Exam-ready']].map(([v,label])=>'<option value="'+v+'" '+(revisionFilter===v?'selected':'')+'>'+label+'</option>').join('')+
  '</select><select class="select" id="revision-subject" aria-label="Revision subject">'+subjectOptions.map(([v,label])=>'<option value="'+h(v)+'" '+(subjectFilter===v?'selected':'')+'>'+h(label)+'</option>').join('')+'</select></div>'+
  '<div class="card">'+current.map(t=>{const p=state.topics[t.id],weak=revisionWeakScore(t.id),d=p.revisionDue;return '<div class="mini-item revision-topic"><div style="flex:1;min-width:0"><strong class="small">'+h(t.title)+'</strong><div class="subtext">'+h(t.group)+' · '+h(SEED.subjects.find(s=>s.id===t.subject)?.short||t.subject)+' · '+(p.status==='none'?'Not studied yet':d?'Next recall '+h(niceDate(d)):'First recall needed')+' · Stage '+(p.revisionStage||0)+(weak?' · Weakness '+weak:'')+'</div></div><div class="revision-actions"><button class="outline-btn" data-recall-hard="'+h(t.id)+'">Needs work</button><button class="primary-btn" data-recall-good="'+h(t.id)+'">Remembered ✓</button></div></div>'}).join('')+
  (!all.length?'<div class="empty">No topics match this filter.</div>':'')+
  (all.length>current.length?'<div class="practice-more"><button class="outline-btn" data-revision-more>Show more · '+(all.length-current.length)+' remaining</button></div>':'')+'</div>';
}

function renderNotes(){const notes=state.notes.filter(n=>`${n.title} ${n.body} ${n.subject}`.toLowerCase().includes(noteQuery.toLowerCase()));return heading('Knowledge notebook','Write short revision notes, tag them to subjects and topics, and keep mistakes easy to retrieve.','NOTES LIBRARY')+
 `<div class="section-heading"><h2>My notes <span class="text-muted tiny">(${state.notes.length})</span></h2><button class="primary-btn" data-modal="note">+ New note</button></div><div class="filters"><input class="input" id="note-search" placeholder="Search notes, keywords and subjects…" value="${h(noteQuery)}"></div>
 ${notes.length?`<div class="note-grid">${notes.map(n=>`<div class="note-card"><div class="small-tag" style="align-self:flex-start">${h(SEED.subjects.find(s=>s.id===n.subject)?.short||'General')}</div><div class="note-title">${h(n.title)}</div><div class="note-excerpt">${h(n.body.slice(0,155))}${n.body.length>155?'…':''}</div><div class="subtext">Updated ${h(n.updatedAt?.slice(0,10)||'')}</div><div class="page-action"><button class="outline-btn" data-edit-note="${h(n.id)}">Edit</button><button class="outline-btn danger-btn" data-delete-note="${h(n.id)}">Delete</button></div></div>`).join('')}</div>`:'<div class="empty">No notes yet. Start with a one-page summary of your first Environment topic.</div>'}`;
}
function renderDocuments(){return heading('Reading & document vault','Store local PDF files in this browser or save reference links. Link documents to weekly reading tasks.','RESOURCE LIBRARY')+
 `<div class="notice warning">This prototype stores uploaded files in this browser using IndexedDB. They do <strong>not</strong> sync to another device, and clearing browser site data can delete them. Exporting JSON backs up metadata and notes, <strong>not uploaded file bytes</strong>.</div>
 <div class="section-heading"><h2>My documents <span class="text-muted tiny">(${state.documents.length})</span></h2><div class="page-action"><button class="outline-btn" data-modal="link">+ Add link</button><button class="primary-btn" data-upload-open>↑ Upload PDF / document</button><input type="file" id="file-upload" accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg" hidden></div></div>
 <div class="card">${state.documents.length?state.documents.map(d=>`<div class="mini-item"><div><strong>${h(d.name)}</strong><div class="subtext">${h(d.type==='file'?'Stored locally in this browser':'Web resource')} · ${h(d.subject||'General')} · ${h(d.createdAt.slice(0,10))}</div></div><div class="page-action"><button class="outline-btn" data-open-doc="${h(d.id)}">Open ↗</button><button class="outline-btn danger-btn" data-delete-doc="${h(d.id)}">Delete</button></div></div>`).join(''):'<div class="empty">No files or links yet. Add your NCERT PDFs, self-created notes or reference links.</div>'}</div>
 <div class="section-heading"><h2>Recommended sources to organize</h2></div><div class="grid-half"><div class="card"><strong class="card-title">GS learning resources</strong><div class="mini-list">${['NCERT school textbooks (relevant classes)','M. Laxmikanth — Indian Polity','Modern India reference / Spectrum','Environment reference and current reports','India/world atlas and map notebook'].map(x=>`<div class="mini-item">${h(x)}</div>`).join('')}</div></div><div class="card"><strong class="card-title">Official PYQ and current-affairs sources</strong><div class="mini-list"><div class="mini-item"><a href="https://upsc.gov.in/examinations/previous-question-papers" target="_blank" rel="noopener noreferrer">UPSC previous question papers ↗</a></div><div class="mini-item"><a href="https://pib.gov.in/" target="_blank" rel="noopener noreferrer">Press Information Bureau ↗</a></div><div class="mini-item"><a href="https://prsindia.org/" target="_blank" rel="noopener noreferrer">PRS Legislative Research ↗</a></div><div class="mini-item"><a href="https://www.isro.gov.in/" target="_blank" rel="noopener noreferrer">ISRO official site ↗</a></div></div></div></div>`;
}
function renderTests(){const tests=[...state.tests].sort((a,b)=>b.date.localeCompare(a.date));const gs=state.tests.filter(t=>t.type==='GS'),cs=state.tests.filter(t=>t.type==='CSAT');const avg=gs.length?num(gs.reduce((a,t)=>a+t.score,0)/gs.length):null;const latest=tests.slice(0,8);const bars=gs.slice(-10);
 return heading('Test performance','Track marks after negative marking, accuracy and trends. Mock scores are entered by you, never fabricated.','TEST ANALYTICS')+
 `<div class="cards">${statCard('GS tests',gs.length,'Sectional and full-length','◫')}${statCard('CSAT tests',cs.length,'Qualifying-paper practice','⌁')}${statCard('Average GS score',avg===null?'—':avg.toFixed(1),gs.length?'Out of 200':'No scores entered','◎')}${statCard('Last recorded accuracy',latest.length?`${num(latest[0].correct/(latest[0].correct+latest[0].wrong||1)*100)}%`:'—','Correct ÷ attempted','↗')}</div>
 <div class="section-heading"><h2>Mock-test register</h2><button class="primary-btn" data-modal="test">+ Record a test</button></div>
 <div class="grid-main"><div class="card"><strong class="card-title">GS score trend (out of 200)</strong>${bars.length?`<div class="mock-bars">${bars.map((t,i)=>`<div class="bar" style="height:${Math.max(8,between(t.score/200*120,0,120))}px"><span>${num(t.score)}</span><label>${i+1}</label></div>`).join('')}</div><div style="height:20px"></div>`:'<div class="empty">Enter your first diagnostic mock to see an actual performance trend.</div>'}</div><div class="card"><strong class="card-title">Marking and analysis</strong><p class="small text-muted">GS: +2 correct, −0.667 incorrect. CSAT: +2.5 correct, −0.833 incorrect. No penalty for unanswered questions.</p><div class="notice">Passing CSAT requires 33% (66.67/200). Your actual readiness should be judged from repeated timed practice, not topic coverage alone.</div></div></div>
 <div class="section-heading"><h2>Historical PYQ subject mix</h2></div><div class="card"><p class="small text-muted">Approximate question count per paper from a prior 2015–2025 third-party classification. This is a study-priority heuristic, <strong>not a probability forecast</strong>, and classifications can overlap.</p>${[...SEED.subjects].sort((a,b)=>b.weight-a.weight).map(s=>`<div class="subject-row"><span class="subject-name">${h(s.short)}</span>${progress(s.weight/20*100,s.color)}<span class="pct">${s.weight}</span></div>`).join('')}<p class="tiny text-muted">Your A/B/C topic priorities can be edited in Syllabus. Current Affairs also overlaps static subjects.</p></div>
 <div class="section-heading"><h2>Recent tests</h2></div><div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Test / date</th><th>Paper</th><th>Correct</th><th>Wrong</th><th>Score</th><th></th></tr></thead><tbody>${latest.map(t=>`<tr><td><strong>${h(t.name)}</strong><div class="subtext">${h(t.date)}</div></td><td>${t.type}</td><td>${t.correct}</td><td>${t.wrong}</td><td><strong>${num(t.score)}</strong> / 200</td><td><button class="text-btn" data-delete-test="${h(t.id)}">Delete</button></td></tr>`).join('')}</tbody></table>${!latest.length?'<div class="empty">No tests recorded yet.</div>':''}</div></div>`;
}
function renderReminders(){const pending=[...state.reminders].sort((a,b)=>a.dueAt.localeCompare(b.dueAt));return heading('Reminders & deadlines','Add study reminders and track overdue items. Background push notifications require the future hosted version.','REMINDER CENTER')+
 `<div class="section-heading"><h2>Your reminders</h2><button class="primary-btn" data-modal="reminder">+ New reminder</button></div><div class="grid-main"><div class="card">${pending.length?pending.map(r=>`<div class="mini-item"><div><strong style="${r.done?'text-decoration:line-through;opacity:.6':''}">${h(r.title)}</strong><div class="subtext">${h(r.dueAt.replace('T',' · '))} · ${r.done?'Completed':r.dueAt.slice(0,10)<todayISO()?'Overdue':'Scheduled'}</div></div><div class="page-action"><button class="outline-btn" data-reminder-done="${h(r.id)}">${r.done?'Undo':'Done ✓'}</button><button class="outline-btn danger-btn" data-reminder-delete="${h(r.id)}">×</button></div></div>`).join(''):'<div class="empty">No reminders set. Add a weekly mock, revision checkpoint or personal target.</div>'}</div><div class="card"><strong class="card-title">How alerts work in this prototype</strong><p class="small text-muted">Reminders appear here and in your dashboard. Optional browser notifications are shown only while this page is open and permission is granted.</p><button class="outline-btn" data-notification>Enable open-tab alerts</button><div class="divider"></div><div class="notice warning">For reliable notifications after closing the app, we will need a hosted backend, scheduled jobs and web push/email delivery.</div></div></div>`;
}
function renderSettings(){const s=stats();return heading('Preferences & data safety','Your first version stores progress locally, while the production architecture will add sign-in and cloud sync.','SETTINGS')+
 `<div class="grid-half"><div class="card"><strong class="card-title">Your preparation profile</strong><div class="mini-list"><div class="mini-item"><span>Study plan target</span><strong>7 May 2027 (user-selected, not confirmed exam date)</strong></div><div class="mini-item"><span>Plan start</span><strong>12 Nov 2026</strong></div><div class="mini-item"><span>End of plan</span><strong>7 May 2027</strong></div><div class="mini-item"><span>Study allocation</span><strong>6 hours/day</strong></div><div class="mini-item"><span>CSAT</span><strong>Completed — revision needed</strong></div><div class="mini-item"><span>Topic coverage</span><strong>${s.coverage}%</strong></div></div></div><div class="card"><strong class="card-title">Backup and restore</strong><p class="small text-muted">Back up your topics, task checks, notes, document links, file metadata, reminders, mock scores and recorded study sessions.</p><div class="page-action"><button class="primary-btn" data-export>↓ Export JSON backup</button><button class="outline-btn" data-import-open>↑ Import backup</button><input type="file" accept="application/json,.json" hidden id="import-input"></div><div class="divider"></div><strong class="card-title">Reset demo data</strong><p class="small text-muted">Restores the 187 initial topic statuses and clears user-created content. Locally uploaded document blobs are cleared too.</p><button class="outline-btn danger-btn" data-reset>Reset to initial assessment</button></div></div>
 <div class="section-heading"><h2>Scope of this first version</h2></div><div class="card"><div class="mini-list"><div class="mini-item"><span>✓ 187 seeded syllabus topics</span><span class="small-tag">Working</span></div><div class="mini-item"><span>✓ Daily 6h targets across 177 days</span><span class="small-tag">Working</span></div><div class="mini-item"><span>✓ Weekly reading checklists and exports</span><span class="small-tag">Working</span></div><div class="mini-item"><span>✓ Notes, local documents, revisions, reminders, tests and time tracking</span><span class="small-tag">Working</span></div><div class="mini-item"><span>Cloud account / multi-device sync</span><span class="small-tag">Production phase</span></div><div class="mini-item"><span>Server-backed notifications and adaptive task rebalancing</span><span class="small-tag">Production phase</span></div></div></div>`;
}
const nav=[['overview','◈','Home'],['current','✳','Current Affairs'],['timer','◷','Focus timer'],['today','◉','Today'],['weekly','▦','26-week plan'],['syllabus','◫','Syllabus'],['revision','↻','Revision'],['practice','◉','Practice Studio'],['notes','✎','Notes'],['documents','▤','Documents'],['tests','▥','Tests & PYQs'],['reminders','♧','Reminders'],['settings','⚙','Settings']];
function render(){if(zenMode){$('#app').innerHTML=renderZen();return;}const days=Math.max(0,dayDiff(todayISO(),SEED.examDate));refreshRecovery({persist:true});const pages={overview:renderOverview,current:renderCurrentAffairs,timer:renderTimer,today:renderToday,weekly:renderWeekly,syllabus:renderSyllabus,revision:renderRevision,practice:renderPractice,notes:renderNotes,documents:renderDocuments,tests:renderTests,reminders:renderReminders,settings:renderSettings};
 $('#app').innerHTML=`<div class="app-shell ${zenMode?'zen-mode':''}"><aside class="sidebar"><div class="logo"><div class="logo-mark">✳</div><div><div class="logo-name">Syllabus Club<span class="logo-period">.</span></div><div class="logo-desc">UPSC · CLASS OF 2027</div></div></div><div class="nav-label">YOUR SPACE</div><nav class="nav" aria-label="Main navigation">${nav.map(([id,icon,label])=>`<button data-nav="${id}" class="${page===id?'active':''}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}</nav><div class="side-bottom"><div class="sidebar-capsule"><span class="capsule-spark">✦</span><strong>${days} days to go</strong><p>Build the habit. Chase the rank.</p><div class="capsule-progress"><i style="width:${stats().coverage}%"></i></div><span>${stats().coverage}% covered · 6h/day</span></div><div class="side-small">LOCAL WORKSPACE · VERSION 3.0</div></div></aside><div class="main"><header class="topbar"><div><strong>Make today your advantage <span class="topbar-star">✳</span></strong><div class="topbar-sub">${niceDate(todayISO(),{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · Your personal study studio</div></div><div class="top-actions"><button class="top-focus" data-nav="timer">◷ <span data-header-time>${shortDuration(dailyStudied(todayISO()))}</span> / 6h</button><button class="round-action" data-nav="reminders" title="Reminders">♧ ${urgentReminders().length||''}</button><button class="round-action" data-nav="settings" title="Backup and settings">⚙</button></div></header><main class="content">${pages[page]() }<p class="footnote">Local prototype: user data lives in this browser; no account, backend sync or closed-tab notifications yet. Study plan ends 7 May 2027 by user choice, not a confirmed UPSC exam date. PYQ weightage is approximate.</p></main></div></div>${modal?renderModal():''}`;
}
function subjectOptions(selected=''){return `<option value="">General / unassigned</option>${SEED.subjects.map(s=>`<option value="${s.id}" ${selected===s.id?'selected':''}>${h(s.name)}</option>`).join('')}<option value="csat" ${selected==='csat'?'selected':''}>CSAT</option>`}
function renderModal(){const m=modal;
 if(m.type==='note'){const n=state.notes.find(x=>x.id===m.id)||{};return `<div class="modal-wrap" data-dismiss><div class="modal" role="dialog" aria-modal="true"><h3>${m.id?'Edit note':'Create a revision note'}</h3><form id="note-form"><input type="hidden" name="id" value="${h(n.id||'')}"><div class="field"><label>Title</label><input class="input" required maxlength="150" name="title" value="${h(n.title||'')}" placeholder="e.g. Ecological pyramids — key points"></div><div class="field"><label>Subject</label><select class="select" name="subject">${subjectOptions(n.subject)}</select></div><div class="field"><label>Notes / explanations / mistakes</label><textarea class="textarea" name="body" rows="8" required placeholder="Write your own concise notes…">${h(n.body||'')}</textarea></div><div class="modal-actions"><button type="button" class="outline-btn" data-close>Cancel</button><button class="primary-btn" type="submit">Save note</button></div></form></div></div>`}
 if(m.type==='link')return `<div class="modal-wrap" data-dismiss><div class="modal" role="dialog" aria-modal="true"><h3>Add a document or resource link</h3><form id="link-form"><div class="field"><label>Display title</label><input class="input" required maxlength="180" name="name" placeholder="e.g. Polity chapter reference"></div><div class="field"><label>HTTPS / HTTP URL</label><input class="input" required type="url" name="url" placeholder="https://…"></div><div class="field"><label>Subject</label><select class="select" name="subject">${subjectOptions()}</select></div><div class="modal-actions"><button type="button" class="outline-btn" data-close>Cancel</button><button class="primary-btn" type="submit">Save link</button></div></form></div></div>`;
 if(m.type==='reminder')return `<div class="modal-wrap" data-dismiss><div class="modal" role="dialog" aria-modal="true"><h3>Create a study reminder</h3><form id="reminder-form"><div class="field"><label>What should you remember?</label><input class="input" name="title" required maxlength="180" placeholder="e.g. Revise ecological pyramids"></div><div class="field"><label>Due date and time</label><input class="input" type="datetime-local" name="dueAt" required value="${h(todayISO()+'T19:00')}"></div><div class="modal-actions"><button type="button" class="outline-btn" data-close>Cancel</button><button type="submit" class="primary-btn">Add reminder</button></div></form></div></div>`;
 if(m.type==='manualTime')return `<div class="modal-wrap" data-dismiss><div class="modal" role="dialog" aria-modal="true"><h3>Log a study session</h3><p class="small text-muted">Add time you studied without running the stopwatch.</p><form id="manual-time-form"><div class="field"><label>Subject</label><select class="select" name="subject">${subjectOptions()}</select></div><div class="grid-half"><div class="field"><label>Date</label><input class="input" name="date" type="date" required max="${todayISO()}" value="${todayISO()}"></div><div class="field"><label>Minutes studied</label><input class="input" name="minutes" type="number" min="1" max="720" required placeholder="e.g. 90"></div></div><div class="field"><label>Session note (optional)</label><input class="input" name="note" maxlength="140" placeholder="e.g. Physical geography revision"></div><div class="modal-actions"><button class="outline-btn" type="button" data-close>Cancel</button><button class="primary-btn" type="submit">Save study time</button></div></form></div></div>`;
 if(m.type==='test')return `<div class="modal-wrap" data-dismiss><div class="modal" role="dialog" aria-modal="true"><h3>Record your mock / sectional test</h3><form id="test-form"><div class="field"><label>Test name</label><input class="input" name="name" required placeholder="e.g. Environment sectional #1" maxlength="160"></div><div class="grid-half"><div class="field"><label>Paper</label><select class="select" name="type"><option value="GS">GS Paper I</option><option value="CSAT">CSAT Paper II</option></select></div><div class="field"><label>Date</label><input class="input" type="date" name="date" required value="${h(todayISO())}"></div></div><div class="grid-half"><div class="field"><label>Correct answers</label><input class="input" name="correct" type="number" min="0" max="100" value="40" required></div><div class="field"><label>Incorrect answers</label><input class="input" name="wrong" type="number" min="0" max="100" value="20" required></div></div><div class="field"><label>What went wrong? (optional)</label><textarea class="textarea" name="analysis" placeholder="Knowledge gap, misread, guess, time management…"></textarea></div><div class="modal-actions"><button type="button" class="outline-btn" data-close>Cancel</button><button type="submit" class="primary-btn">Save score</button></div></form></div></div>`;
 return '';
}
function download(text,name,mime='text/plain'){const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function weeklyBrief(i){const w=SEED.weeks[i],ds=weekDates(i);let text=`# UPSC Prelims 2027 — Week ${i+1}\n\nDates: ${ds.start} to ${ds.end}\nFocus: ${w.focus}\nWeekly measurable target: ${w.goal}\n\n## Reading and documents\n${w.resources.map((r,j)=>`- [${state.readResources[`${i}:${j}`]?'x':' '}] ${r}`).join('\n')}\n\n## Daily learning targets (6 hours/day)\n`;
 for(let n=0;n<7;n++){const d=addDays(ds.start,n);if(d>SEED.endDate)break;text+=`\n### ${niceDate(d,{weekday:'long',day:'numeric',month:'long'})} (${d})\n`+getDayTasks(d).map(t=>`- [${taskDone(t.id)?'x':' '}] ${t.title} (${t.minutes} min): ${t.detail}`).join('\n')+'\n'}
 text+='\n## End of week review\n- Topics still unfinished:\n- MCQs attempted / accuracy:\n- Mistakes to revisit:\n- Documents completed:\n- CSAT weak areas:\n- Next-week rescheduling decisions:\n';return text}
const rid=()=>crypto.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
function nextRevision(tid){gradeRecall(tid,'good')}
function openDB(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(Error('IndexedDB unsupported'));const req=indexedDB.open('upsc-cc-files',1);req.onupgradeneeded=()=>req.result.createObjectStore('files',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function putFile(id,file){if(window.SYLLABUS_CLOUD?.loggedIn)return window.SYLLABUS_CLOUD.uploadDocument(id,file);const db=await openDB();await new Promise((res,rej)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put({id,file});tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close()}
async function getFile(id){const db=await openDB();let result=await new Promise((res,rej)=>{const req=db.transaction('files').objectStore('files').get(id);req.onsuccess=()=>res(req.result?.file);req.onerror=()=>rej(req.error)});db.close();return result}
async function delFile(id){if(window.SYLLABUS_CLOUD?.loggedIn)return window.SYLLABUS_CLOUD.deleteDocument(id);const db=await openDB();await new Promise((res,rej)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close()}
function safeURL(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}}
async function handleUpload(file){if(!file)return;if(file.size>4*1024*1024)return toast('Hosted uploads are capped at 4 MB. Compress or link larger files.');const id=rid();try{await putFile(id,file);state.documents.unshift({id,name:file.name,type:'file',storage:window.SYLLABUS_CLOUD?.loggedIn?'cloud':'local',subject:'',createdAt:new Date().toISOString(),size:file.size});save();render();toast(window.SYLLABUS_CLOUD?.loggedIn?'Document saved to your private cloud':'Document saved only in this browser')}catch(e){toast('Could not store document: '+e.message)}}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
async function handleSubmit(e){const form=e.target;const formId=form.getAttribute('id');if(!formId)return;e.preventDefault();const o=formData(form);
 if(formId==='ca-pdf-form'){const f=form.querySelector('input[type=file]')?.files?.[0];if(!f)return toast('Choose a PDF');const upload=new FormData();upload.append('file',f);upload.append('published_date',o.published_date);caUI.loading=true;render();try{
 const outcome=await caRequest('/api/upload',{method:'POST',body:upload});
 if(outcome.duplicate){
   const reason=outcome.reason==='identical_file'?'This exact file is already in your archive.':
     outcome.reason==='identical_text'?'This document text is already in your archive.':
     'This news is already covered in another source.';
   toast('Duplicate skipped · '+reason);caUI.error='Duplicate import skipped: '+reason+' Saved notes and source preserved.';
 }else{
   const count=Number(outcome.matched_count)||0;
   toast(count?'PDF saved · '+count+' repeated news topic(s) flagged.':'PDF imported · no matching news detected.');
   await caLoad();
 }
 }catch(err){caUI.error=err.message;toast(err.message)}finally{caUI.loading=false;render()}return}
 if(formId==='note-form'){const now=new Date().toISOString();if(o.id){const n=state.notes.find(x=>x.id===o.id);if(n)Object.assign(n,{title:o.title.trim(),subject:o.subject,body:o.body,updatedAt:now})}else state.notes.unshift({id:rid(),title:o.title.trim(),subject:o.subject,body:o.body,createdAt:now,updatedAt:now});modal=null;save();render();toast('Note saved')}
 if(formId==='link-form'){const url=safeURL(o.url);if(!url)return toast('Only valid HTTP(S) links are allowed');state.documents.unshift({id:rid(),name:o.name.trim(),url,type:'link',subject:o.subject,createdAt:new Date().toISOString()});modal=null;save();render();toast('Resource linked')}
 if(formId==='reminder-form'){state.reminders.push({id:rid(),title:o.title.trim(),dueAt:o.dueAt,done:false});modal=null;save();render();toast('Reminder added')}
 if(formId==='manual-time-form'){const minutes=Number(o.minutes);if(!Number.isInteger(minutes)||minutes<1||minutes>720)return toast('Enter 1–720 minutes');if(!o.date||o.date>todayISO())return toast('Choose a valid past or current date');const date=new Date(o.date+'T12:00:00');if(isNaN(date.getTime()))return toast('Invalid date');state.studySessions.unshift({id:rid(),subject:o.subject||'general',taskId:'',mode:'manual',date:o.date,durationSec:minutes*60,manual:true,note:o.note||'',createdAt:nowStamp(),endedAt:nowStamp()});modal=null;save();render();toast(`${minutes} minutes added`);return;}
 if(formId==='test-form'){const correct=Number(o.correct),wrong=Number(o.wrong),type=o.type;if(!Number.isInteger(correct)||!Number.isInteger(wrong)||correct<0||wrong<0||correct+wrong>100)return toast('Correct + incorrect must be 100 or fewer');const positive=type==='CSAT'?2.5:2,negative=positive/3,score=num(correct*positive-wrong*negative);state.tests.push({id:rid(),name:o.name,date:o.date,type,correct,wrong,score,analysis:o.analysis,createdAt:new Date().toISOString()});modal=null;save();render();toast('Test results saved')}
}
async function handleClick(e){const el=e.target.closest('button');if(!el)return;
 if(el.dataset.caBulkStart!==undefined){await caBulkGenerate(false);return}
 if(el.dataset.caBulkResume!==undefined){await caBulkGenerate(true);return}
 if(el.dataset.caBulkDismiss!==undefined){state.aiBatchCheckpoint=null;caUI.bulk=null;save();caStableRender();return}
 if(el.dataset.caBulkStop!==undefined){if(caUI.bulk?.running){caUI.bulk.stop=true;caBulkPaint()}return}
 if(el.dataset.caRetryCloud!==undefined){caUI.online=null;caUI.error='';caStableRender();try{await window.SYLLABUS_CLOUD?.reconnect()}catch(e){caUI.error=e.message}await caLoad();return}
 if(el.dataset.caSync!==undefined){await caSync();return}
 if(el.dataset.caFile){try{const url=await window.SYLLABUS_CLOUD.articleFileUrl(el.dataset.caFile);window.open(url,'_blank','noopener,noreferrer')}catch(e){toast(e.message)}return}
 if(el.dataset.caExport!==undefined){try{const x=await caRequest('/api/export');download(JSON.stringify(x,null,2),`upsc-current-affairs-${todayISO()}.json`,'application/json');toast('Archive metadata and notes exported; PDF bytes not included')}catch(e){toast(e.message)}return}
 if(el.dataset.caFilter!==undefined){caUI.source=$('#ca-source').value;caUI.tag=$('#ca-tag').value;caUI.status=$('#ca-status').value;caUI.search=$('#ca-search').value.trim();caUI.from=$('#ca-from').value;caUI.to=$('#ca-to').value;caUI.expanded=null;await caLoad();return}
 if(el.dataset.caQuick){const id=el.dataset.caQuick;if(caUI.busyId!==null||caUI.bulk?.running)return;const item=caUI.items.find(x=>x.id===id);if(!item)return;caUI.expanded=id;if(item.analysis){caStableRender(id);return}if(!caUI.ai){caUI.error='Gemini is unavailable; check Cloud connection';render();return}await caMutation(()=>caRequest('/api/articles/'+encodeURIComponent(id)+'/analyze',{method:'POST'}),id);return}
 if(el.dataset.caDetail){caUI.expanded=caUI.expanded===el.dataset.caDetail?null:el.dataset.caDetail;render();return}
 if(el.dataset.caAnalyze){const id=el.dataset.caAnalyze;await caMutation(()=>caRequest(`/api/articles/${id}/analyze`,{method:'POST'}),id);return}
 if(el.dataset.caStatusAction){const id=el.dataset.caStatusAction,status=el.dataset.caNewStatus;await caMutation(()=>caRequest(`/api/articles/${id}/status`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})}),id);return}
 if(el.dataset.caRevise){const id=el.dataset.caRevise;await caMutation(()=>caRequest(`/api/articles/${id}/revise`,{method:'POST'}),id);return}
 if(el.dataset.caNote){const a=caUI.items.find(a=>a.id===el.dataset.caNote);if(!a)return;const x=a.analysis;const subjectIds={'Polity':'polity','Economy':'economy','Environment':'environment','Geography':'geography','Science & Tech':'science','International Relations':'current','History & Culture':'history','Social Issues':'economy'};const body=x?`${x.summary}\n\nKEY FACTS\n${(x.key_facts||[]).map(q=>'- '+q).join('\n')}\n\nSTATIC LINKS\n${(x.static_links||[]).join(', ')}`:(a.excerpt||'Source text unavailable');const note=`${body}\n\nSource: ${a.url||a.file_name||'Local PDF'}\nPublication: ${caDate(a)}\n${x?'AI-generated: verify against the original.':'Rule-based source preview, not AI-verified.'}`;state.notes.unshift({id:rid(),title:a.title.slice(0,145),subject:subjectIds[(a.tags||[])[0]]||'current',body:note,createdAt:nowStamp(),updatedAt:nowStamp()});save();toast('Saved to your Notes library');return}
 if(el.dataset.zenToggle!==undefined){zenMode=!zenMode;render();return}
 if(el.dataset.timerStart!==undefined){startTimer();return}
 if(el.dataset.timerPause!==undefined){pauseTimer();render();toast('Timer paused');return}
 if(el.dataset.timerResume!==undefined){resumeTimer();render();toast('Timer resumed');return}
 if(el.dataset.timerStop!==undefined){stopTimer();return}
 if(el.dataset.timerExport!==undefined){download(timerCSV(),`upsc-study-time-${todayISO()}.csv`,'text/csv');return}
 if(el.dataset.taskFocus){const all=getDayTasks(day),task=all.find(t=>t.id===el.dataset.taskFocus);if(state.timer)return toast('Save or finish your active session first');state.timerPrefs.taskId=el.dataset.taskFocus;const cat=task?.category||'';state.timerPrefs.subject=cat==='CSAT'?'csat':cat==='Current'?'current':currentWeek(weekIndex).focus.toLowerCase().includes('environment')?'environment':currentWeek(weekIndex).focus.toLowerCase().includes('polity')?'polity':currentWeek(weekIndex).focus.toLowerCase().includes('geography')?'geography':currentWeek(weekIndex).focus.toLowerCase().includes('science')?'science':currentWeek(weekIndex).focus.toLowerCase().includes('economy')?'economy':state.timerPrefs.subject;page='timer';render();toast('Choose the correct subject, then start focus');return}
 if(el.dataset.deleteSession){if(confirm('Delete this recorded study session?')){state.studySessions=state.studySessions.filter(x=>x.id!==el.dataset.deleteSession);save();render();toast('Session deleted')}return}
 if(el.dataset.nav){page=el.dataset.nav;render();if(page==='current')caLoad();window.scrollTo(0,0);return}
 if(el.dataset.markMissed){markMissedStudyDay(el.dataset.markMissed,el.dataset.markMissedValue==='1');return}
 if(el.dataset.day){day=el.dataset.day;weekIndex=Math.floor(dayDiff(SEED.startDate,day)/7);render();return}
 if(el.dataset.dayOpen){day=el.dataset.dayOpen;weekIndex=Math.floor(dayDiff(SEED.startDate,day)/7);page='today';render();window.scrollTo(0,0);return}
 if(el.dataset.shift){day=clampPlan(addDays(day,Number(el.dataset.shift)));weekIndex=Math.floor(dayDiff(SEED.startDate,day)/7);render();return}
 if(el.dataset.week!==undefined){weekIndex=Number(el.dataset.week);render();window.scrollTo(0,0);return}
 if(el.dataset.brief!==undefined){const i=Number(el.dataset.brief);download(weeklyBrief(i),`UPSC-2027-week-${String(i+1).padStart(2,'0')}-brief.md`,'text/markdown');return}
 if(el.dataset.practiceStart!==undefined){await startDailyPractice();return}
 if(el.dataset.practiceAnswer!==undefined){practiceAnswer(Number(el.dataset.practiceAnswer));return}
 if(el.dataset.practiceNext!==undefined){practiceNext();return}
 if(el.dataset.practiceRecall){practiceRecallSelect(el.dataset.practiceRecall);return}
 if(el.dataset.recallGood){gradeRecall(el.dataset.recallGood,'good');return}
 if(el.dataset.recallHard){gradeRecall(el.dataset.recallHard,'hard');return}
 if(el.dataset.revisionMore!==undefined){revisionPageSize+=60;render();return}
 if(el.dataset.revise){nextRevision(el.dataset.revise);return}
 if(el.dataset.ready){const p=state.topics[el.dataset.ready];if(p.status!=='done')return toast('Mark the topic Completed and verify it with questions first.');p.ready=!p.ready;save();render();toast(p.ready?'Topic marked exam-ready':'Exam-ready flag removed');return}
 if(el.dataset.modal){modal={type:el.dataset.modal};render();return}
 if(el.dataset.editNote){modal={type:'note',id:el.dataset.editNote};render();return}
 if(el.hasAttribute('data-close')){modal=null;render();return}
 if(el.dataset.deleteNote){if(confirm('Delete this note?')){state.notes=state.notes.filter(x=>x.id!==el.dataset.deleteNote);save();render()}return}
 if(el.dataset.deleteDoc){const d=state.documents.find(x=>x.id===el.dataset.deleteDoc);if(!d||!confirm('Delete this document?'))return;state.documents=state.documents.filter(x=>x.id!==d.id);if(d.type==='file')try{if(d.storage==='cloud'&&window.SYLLABUS_CLOUD?.loggedIn)await window.SYLLABUS_CLOUD.deleteDocument(d.id);else{const db=await openDB();const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(d.id);db.close()}}catch(e){toast('File deletion failed; check your cloud connection');return}save();render();return}
 if(el.dataset.openDoc){const d=state.documents.find(x=>x.id===el.dataset.openDoc);if(!d)return;if(d.type==='link'){const url=safeURL(d.url);if(url)window.open(url,'_blank','noopener,noreferrer')}else{try{if(d.storage==='cloud'){if(!window.SYLLABUS_CLOUD?.loggedIn)return toast('Sign in to retrieve this cloud document');const url=await window.SYLLABUS_CLOUD.documentUrl(d.id);window.open(url,'_blank','noopener,noreferrer');return}const file=await getFile(d.id);if(!file)return toast('File bytes missing from local browser');const url=URL.createObjectURL(file);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),120000)}catch{toast('Could not load local file')}}return}
 if(el.hasAttribute('data-upload-open')){$('#file-upload')?.click();return}
 if(el.dataset.reminderDone){const r=state.reminders.find(x=>x.id===el.dataset.reminderDone);r.done=!r.done;save();render();return}
 if(el.dataset.reminderDelete){if(confirm('Delete this reminder?')){state.reminders=state.reminders.filter(x=>x.id!==el.dataset.reminderDelete);save();render()}return}
 if(el.dataset.deleteTest){if(confirm('Delete this test score?')){state.tests=state.tests.filter(x=>x.id!==el.dataset.deleteTest);save();render()}return}
 if(el.dataset.export!==undefined){download(JSON.stringify({app:'UPSC Command Center',exportedAt:new Date().toISOString(),data:state},null,2),`upsc-dashboard-backup-${todayISO()}.json`,'application/json');return}
 if(el.hasAttribute('data-import-open')){$('#import-input')?.click();return}
 if(el.dataset.reset!==undefined){if(confirm('Reset ALL demo progress, notes, reminders, study sessions, test scores and document metadata to the original assessment?')){state=initial();try{const db=await openDB();db.close();indexedDB.deleteDatabase('upsc-cc-files')}catch{}save();render();toast('Initial study profile restored')}return}
 if(el.hasAttribute('data-notification')){if(!('Notification'in window))return toast('This browser does not support desktop notifications');try{const result=await Notification.requestPermission();toast(result==='granted'?'Open-tab alerts enabled':'Notification permission not granted')}catch{toast('Notifications require localhost or a secure origin')}return}
}
function handleChange(e){const t=e.target;
 if(t.id==='timer-subject'){state.timerPrefs.subject=t.value;state.timerPrefs.taskId='';save();render();return}
 if(t.id==='timer-mode'){state.timerPrefs.mode=t.value;save();render();return}
 if(t.dataset.task){UPSC_RECOVERY.markComplete(state,t.dataset.task,t.checked);refreshRecovery({persist:false});save();render();return}
 if(t.dataset.resource){state.readResources[t.dataset.resource]=t.checked;save();render();return}
 if(t.dataset.topicStatus){const p=state.topics[t.dataset.topicStatus];p.status=t.value;p.ready=false;if(t.value==='none'){p.revisionStage=0;p.revisionDue=null}save();render();return}
 if(t.dataset.priority){state.topics[t.dataset.priority].priority=t.value;save();render();return}
 if(t.id==='subject-filter'){subjectFilter=t.value;render();return}
 if(t.id==='status-filter'){statusFilter=t.value;render();return}
 if(t.dataset.practiceMistakeId!==undefined){practiceLinkMistake(t.dataset.practiceMistakeId,t.value);return}
 if(t.id==='revision-filter'){revisionFilter=t.value;revisionPageSize=40;render();return}
 if(t.id==='revision-subject'){subjectFilter=t.value;revisionPageSize=40;render();return}
 if(t.id==='day-picker'){day=clampPlan(t.value);weekIndex=Math.floor(dayDiff(SEED.startDate,day)/7);render();return}
 if(t.id==='file-upload'){handleUpload(t.files?.[0]);return}
 if(t.id==='import-input'&&t.files?.length){const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result)),incoming=parsed.data;if(!incoming||typeof incoming.topics!=='object'||!Array.isArray(incoming.notes)||!Array.isArray(incoming.tests))throw Error('Invalid backup format');if(!confirm('Restore backup? This replaces current progress and note metadata, but not file bytes.'))return;state=incoming;if(!Array.isArray(state.studySessions))state.studySessions=[];if(!state.timerPrefs)state.timerPrefs={subject:'environment',mode:'stopwatch',taskId:''};if(state.timer?.status==='running')state.timer.status='paused';for(const x of SEED.topics)if(!state.topics[x.id])state.topics[x.id]={status:x.status,priority:x.priority,revisionStage:0,revisionDue:null,ready:false};save();render();toast('Backup restored')}catch(err){toast('Invalid JSON backup')}};reader.readAsText(t.files[0]);return}
}
let inputDebounce;function handleInput(e){if(e.target.id==='topic-search'){query=e.target.value;clearTimeout(inputDebounce);inputDebounce=setTimeout(()=>{const pos=e.target.selectionStart;render();const el=$('#topic-search');if(el){el.focus();el.setSelectionRange(pos,pos)}},200)}if(e.target.id==='note-search'){noteQuery=e.target.value;clearTimeout(inputDebounce);inputDebounce=setTimeout(()=>{const pos=e.target.selectionStart;render();const el=$('#note-search');if(el){el.focus();el.setSelectionRange(pos,pos)}},180)}}
document.addEventListener('click',handleClick);document.addEventListener('change',handleChange);document.addEventListener('submit',handleSubmit);document.addEventListener('input',handleInput);document.addEventListener('click',e=>{if(e.target.matches('[data-dismiss]')){modal=null;render()}});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal){modal=null;render()}else if(e.key==='Escape'&&zenMode){zenMode=false;render()}});
const alerted=new Set();setInterval(()=>{if(!('Notification'in window)||Notification.permission!=='granted')return;const now=new Date().toISOString().slice(0,16),localNow=todayISO()+'T'+new Date().toTimeString().slice(0,5);state.reminders.filter(r=>!r.done&&r.dueAt<=localNow&&!alerted.has(r.id)).forEach(r=>{alerted.add(r.id);try{new Notification('UPSC reminder',{body:r.title})}catch{}})},60000);
if(!localStorage.getItem(STORE))save(false);bootTimer();render();
// A cloud session can finish connecting after the user opens Current Affairs.
// Refresh the feed whenever the authenticated cloud connection state changes.
window.addEventListener('syllabus-cloud-ready',()=>{if(page==='current')caLoad();});
let lastHeartbeat=0;setInterval(()=>{const t=state.timer;if(t?.status==='running'){const secs=getTimerSeconds(),lim=modeLimit[t.mode]||0;if(lim&&secs>=lim){stopTimer(true);return}const remaining=lim?Math.max(0,lim-secs):secs;document.querySelectorAll('[data-clock]').forEach(el=>el.textContent=secFmt(remaining));document.querySelectorAll('[data-timer-meter]').forEach(el=>el.style.width=(lim?Math.min(100,secs/lim*100):Math.min(100,dailyStudied(todayISO())/21600*100))+'%');const amount=shortDuration(dailyStudied(todayISO()));document.querySelectorAll('[data-live-today],[data-live-total],[data-header-time]').forEach(el=>el.textContent=amount);if(Date.now()-lastHeartbeat>9000){t.lastHeartbeat=nowStamp();save(false);lastHeartbeat=Date.now();}}},1000);
window.addEventListener('pagehide',()=>{if(state.timer?.status==='running')pauseTimer()});window.addEventListener('pageshow',e=>{if(e.persisted)render()});
})();
