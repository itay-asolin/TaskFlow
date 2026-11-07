const CACHE_NAME = "taskflow-shell-v26";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./widgets/taskflow-card.json",
  "./widgets/taskflow-preview.png",
  "./icons/taskflow-180.png",
  "./icons/taskflow-192.png",
  "./icons/taskflow-512.png"
];
const WIDGET_DB = "taskflow-widgets-v1";
const WIDGET_STORE = "snapshots";
const TASKFLOW_URL = "https://itay-asolin.github.io/TaskFlow/";
const WIDGET_IDS = ["calendar-day","calendar-week","calendar-month","tasks","lists-top-2","lists-top-3","lists-top-4","lists-favorites","shared","shopping","mini-tasks","work-hours","weather","next-task","day-progress","next-event"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("taskflow-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => refreshInstalledWidgets())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) || (await cache.match("./index.html")) || (await cache.match("./"));
      })
    );
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});

function openWidgetDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(WIDGET_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(WIDGET_STORE))request.result.createObjectStore(WIDGET_STORE)};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function readSnapshot(){
  try{
    const db=await openWidgetDb();
    const value=await new Promise((resolve,reject)=>{const tx=db.transaction(WIDGET_STORE,"readonly"),request=tx.objectStore(WIDGET_STORE).get("current");request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)});
    db.close();return value;
  }catch{return null}
}
async function writeSnapshot(value){
  const db=await openWidgetDb();
  await new Promise((resolve,reject)=>{const tx=db.transaction(WIDGET_STORE,"readwrite");tx.objectStore(WIDGET_STORE).put(value,"current");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
  db.close();
}
function dateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function parseDateKey(key){const [y,m,d]=String(key||"").split("-").map(Number);return y&&m&&d?new Date(y,m-1,d,12):null}
function dateLabel(key,options={weekday:"short",day:"numeric",month:"short"}){const d=parseDateKey(key);return d?new Intl.DateTimeFormat("he-IL",options).format(d):""}
function isTaskDone(task){return !!task?.subs?.length&&task.subs.every(sub=>sub.done)}
function openTasks(snapshot){return (snapshot?.state?.tasks||[]).filter(task=>!isTaskDone(task))}
function safeItem(text){return {text:String(text||"").trim().slice(0,100)}}
function eventText(event){const day=dateLabel(event.date);const time=event.allDay?"כל היום":event.time||"ללא שעה";return `${day} · ${time} · ${event.title||"אירוע"}`}
function makeWidgetData(id,snapshot){
  const state=snapshot?.state||{},tasks=state.tasks||[],events=(state.events||[]).filter(event=>event.showInCalendar!==false),cats=state.cats||[],now=new Date(),today=dateKey(now),month=today.slice(0,7),open=openTasks(snapshot),dueOrToday=open.filter(task=>!task.due||task.due<=today),prefs=snapshot?.todayPrefs||{},items=[];
  const titleById={"calendar-day":"יומן יומי","calendar-week":"יומן שבועי","calendar-month":"יומן חודשי","tasks":"משימות להיום","lists-top-2":"2 הרשימות הפעילות","lists-top-3":"3 הרשימות הפעילות","lists-top-4":"4 הרשימות הפעילות","lists-favorites":"רשימות מועדפות","shared":"רשימות משותפות","shopping":"רשימת קניות","mini-tasks":"מטלות קטנות","work-hours":"שעות עבודה","weather":"מזג אוויר","next-task":"המשימה הבאה","day-progress":"התקדמות יומית","next-event":"האירוע הבא"};
  let subtitle="TaskFlow",footer="הנתונים מתעדכנים כש־TaskFlow פתוח";
  const addTasks=list=>list.slice(0,6).forEach(task=>items.push(safeItem(`${task.name||"מטלה ללא שם"}${task.due?` · ${dateLabel(task.due,{day:"numeric",month:"short"})}`:" · ללא תאריך"}`)));
  if(id==="calendar-day"){
    subtitle=dateLabel(today,{weekday:"long",day:"numeric",month:"long"});
    events.filter(event=>event.date===today).sort((a,b)=>(a.time||"").localeCompare(b.time||"")).slice(0,4).forEach(event=>items.push(safeItem(eventText(event))));
    addTasks(open.filter(task=>task.due===today));
  }else if(id==="calendar-week"){
    const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+7);
    events.filter(event=>event.date>=today&&event.date<dateKey(end)).sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||""))).slice(0,6).forEach(event=>items.push(safeItem(eventText(event))));
    subtitle="אירועים בשבעת הימים הקרובים";
  }else if(id==="calendar-month"){
    subtitle=now.toLocaleDateString("he-IL",{month:"long",year:"numeric"});
    events.filter(event=>event.date?.startsWith(month)).sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||""))).slice(0,6).forEach(event=>items.push(safeItem(eventText(event))));
  }else if(id==="tasks"){
    subtitle="היום וללא תאריך";addTasks(dueOrToday);
  }else if(id.startsWith("lists-top-")){
    const limit=Number(id.slice(-1));subtitle="לפי מספר המטלות הפתוחות";
    cats.map((cat,index)=>({cat,index,count:open.filter(task=>task.catId===cat.id).length})).sort((a,b)=>b.count-a.count||a.index-b.index).slice(0,limit).forEach(({cat,count})=>items.push(safeItem(`${cat.name||"רשימה"} · ${count} פתוחות`)));
  }else if(id==="lists-favorites"){
    subtitle="הרשימות המועדפות שלך";(prefs.favorites||[]).map(catId=>cats.find(cat=>cat.id===catId)).filter(Boolean).slice(0,6).forEach(cat=>items.push(safeItem(`${cat.name} · ${open.filter(task=>task.catId===cat.id).length} פתוחות`)));
  }else if(id==="shared"){
    subtitle="הרשימות המשותפות שלך";(snapshot?.shared||[]).slice(0,6).forEach(list=>items.push(safeItem(list.name||"רשימה משותפת")));
  }else if(id==="shopping"){
    subtitle="פריטים שעדיין צריך לקנות";(state.shopList||[]).filter(item=>!item.done).slice(0,6).forEach(item=>items.push(safeItem(item.text||item.name||"פריט")));
  }else if(id==="mini-tasks"){
    subtitle="המטלות הקטנות שלך";(state.dailyMemo?.lines||[]).filter(line=>String(line||"").trim()).slice(0,6).forEach(line=>items.push(safeItem(line)));
  }else if(id==="work-hours"){
    subtitle="החודש הנוכחי";const work=events.filter(event=>event.date?.startsWith(month)&&(event.kind==="work"||event.eventType==="work"||event.type==="work"));work.slice(0,5).forEach(event=>items.push(safeItem(eventText(event))));if(work.length>5)items.push(safeItem(`${work.length} דיווחים החודש`));
  }else if(id==="weather"){
    subtitle=snapshot?.weather?.name||"מזג האוויר עכשיו";const current=snapshot?.weather?.data?.current;if(current)items.push(safeItem(`${Math.round(Number(current.temperature_2m))}° · ${subtitle}`));else items.push(safeItem("פתחו את TaskFlow כדי לרענן את מזג האוויר"));
  }else if(id==="next-task"){
    subtitle="המטלה הפתוחה הקרובה";const next=open.slice().sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999")||(a.name||"").localeCompare(b.name||"","he"))[0];if(next)items.push(safeItem(`${next.name||"מטלה ללא שם"}${next.due?` · ${dateLabel(next.due,{day:"numeric",month:"long"})}`:" · ללא תאריך"}`));
  }else if(id==="day-progress"){
    const relevant=tasks.filter(task=>!task.due||task.due<=today),done=relevant.filter(isTaskDone).length,total=relevant.length,pct=total?Math.round(done/total*100):100;subtitle="כמה מהמטלות הושלמו";items.push(safeItem(`${done} מתוך ${total} · ${pct}%`));
  }else if(id==="next-event"){
    const clock=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;const next=events.filter(event=>event.date>=today&&(event.date>today||event.allDay||!event.time||event.time>=clock)).sort((a,b)=>(a.date+(a.time||"99:99")).localeCompare(b.date+(b.time||"99:99")))[0];subtitle="האירוע הקרוב ביומן";if(next)items.push(safeItem(eventText(next)));
  }
  if(!items.length)items.push(safeItem("אין כרגע פריטים להצגה"));
  return {title:titleById[id]||"TaskFlow",subtitle,items,footer};
}
async function updateWidget(widget,snapshot){
  if(!self.widgets||!widget?.definition)return;
  const id=String(widget.definition.tag||"").replace(/^taskflow-/ ,"");if(!WIDGET_IDS.includes(id))return;
  try{
    const response=await fetch("./widgets/taskflow-card.json");if(!response.ok)return;
    const template=await response.text(),data=JSON.stringify(makeWidgetData(id,snapshot));
    await self.widgets.updateByTag(widget.definition.tag,{template,data});
  }catch{}
}
async function refreshInstalledWidgets(snapshot){
  if(!self.widgets)return;
  const current=snapshot||await readSnapshot();if(!current)return;
  try{
    const installed=await self.widgets.matchAll({installed:true});
    const tags=[...new Set((installed||[]).map(widget=>widget.definition?.tag).filter(Boolean))];
    await Promise.all(tags.map(async tag=>{const widget=await self.widgets.getByTag(tag);if(widget)await updateWidget(widget,current)}));
  }catch{}
}
self.addEventListener("message",event=>{
  if(event.data?.type!=="TASKFLOW_WIDGET_STATE")return;
  event.waitUntil(writeSnapshot(event.data.snapshot).then(()=>refreshInstalledWidgets(event.data.snapshot)).catch(()=>{}));
});
self.addEventListener("widgetinstall",event=>{
  event.waitUntil((async()=>{
    const snapshot=await readSnapshot();await updateWidget(event.widget,snapshot);
    try{await self.registration.periodicSync?.register(event.widget.definition.tag,{minInterval:(event.widget.definition.update||3600)*1000})}catch{}
  })());
});
self.addEventListener("widgetresume",event=>event.waitUntil((async()=>updateWidget(event.widget,await readSnapshot()))()));
self.addEventListener("periodicsync",event=>event.waitUntil(refreshInstalledWidgets()));
self.addEventListener("widgetclick",event=>{
  event.waitUntil(self.clients.openWindow(TASKFLOW_URL));
});