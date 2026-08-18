/* =========================================================
   Entrega de Turno — I-PASS/SBAR
   Almacenamiento: localStorage (offline-first) + sync opcional
   en Firestore cuando /firebase-config.js tiene credenciales reales.
   ========================================================= */

const SHIFTS_KEY = 'handoff.shifts.v2';
const ACTIVE_SHIFT_KEY = 'handoff.activeShiftId.v2';
const OLD_PATIENTS_KEY = 'handoff.patients.v1';
const THEME_KEY = 'handoff.theme';

const SEVERITY_LABEL = { green: 'Estable', yellow: 'Watcher', red: 'Inestable' };
const SEVERITY_ORDER = { red: 0, yellow: 1, green: 2, '': 3 };
const SHIFT_TYPE_LABEL = { dia: 'Día', noche: 'Noche' };
const SHIFT_TYPE_ICON = { dia: '☀️', noche: '🌙' };

const MAIN_SPECIALTIES = [
  { id:'urgencias', label:'Medicina de Urgencias' },
  { id:'cirugia_general', label:'Cirugía General' },
  { id:'medicina_interna', label:'Medicina Interna' },
  { id:'cuidados_paliativos', label:'Cuidados Paliativos' },
  { id:'neurocirugia', label:'Neurocirugía' },
  { id:'ginecologia', label:'Ginecología' },
  { id:'ortopedia', label:'Ortopedia' },
  { id:'medicina_general', label:'Medicina General' },
];
const OTHER_SPECIALTIES = [
  { id:'neumologia', label:'Neumología' },
  { id:'reumatologia', label:'Reumatología' },
  { id:'oncologia', label:'Oncología' },
  { id:'hematologia', label:'Hematología' },
];
const ALL_SPECIALTIES = [...MAIN_SPECIALTIES, ...OTHER_SPECIALTIES];
const SPECIALTY_LABEL = Object.fromEntries(ALL_SPECIALTIES.map(s => [s.id, s.label]));
const OTHER_SPECIALTY_IDS = OTHER_SPECIALTIES.map(s => s.id);

const DISPOSITIONS = [
  { id:'salida', label:'Salida', icon:'🚪' },
  { id:'observacion', label:'Observación', icon:'🕒' },
  { id:'hospitalizacion', label:'Hospitalización', icon:'🛏️' },
  { id:'uci', label:'UCI', icon:'🫁' },
  { id:'ucin', label:'UCIN', icon:'👶' },
  { id:'morgue', label:'Morgue', icon:'⚰️' },
];
const DISPOSITION_LABEL = Object.fromEntries(DISPOSITIONS.map(d => [d.id, d.label]));
const DISPOSITION_ICON = Object.fromEntries(DISPOSITIONS.map(d => [d.id, d.icon]));

/* ---------- Estado en memoria ---------- */
let shifts = [];
let activeShiftId = null;
let currentFilter = 'all';
let currentSpecialtyTab = MAIN_SPECIALTIES[0].id;
let editingId = null;
let currentStep = 1;
let draftActions = [];
let draftSeverity = null;
let draftSpecialties = [];
let draftShiftType = null;
let lastMainView = 'listView';

/* ---------- Utilidades de fecha/turno ---------- */
function todayISO(){
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off*60000).toISOString().slice(0,10);
}
function guessShiftType(){
  const h = new Date().getHours();
  return (h >= 7 && h < 19) ? 'dia' : 'noche';
}
function formatShiftDate(iso){
  const d = new Date(iso + 'T00:00:00');
  const s = d.toLocaleDateString('es-CO', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function nowTimeLabel(){
  return new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
}

/* ---------- Persistencia local ---------- */
function loadShifts(){
  try{
    const raw = localStorage.getItem(SHIFTS_KEY);
    if (raw) return JSON.parse(raw);
  }catch(e){ console.error('Error leyendo turnos', e); }

  try{
    const oldRaw = localStorage.getItem(OLD_PATIENTS_KEY);
    if (oldRaw){
      const oldPatients = JSON.parse(oldRaw);
      if (Array.isArray(oldPatients) && oldPatients.length){
        return [{
          id: 'migrated-' + Date.now().toString(36),
          date: todayISO(),
          type: guessShiftType(),
          createdAt: new Date().toISOString(),
          patients: oldPatients,
        }];
      }
    }
  }catch(e){ console.error('Error migrando datos previos', e); }

  return [];
}
function saveShiftsLocal(){
  try{ localStorage.setItem(SHIFTS_KEY, JSON.stringify(shifts)); }
  catch(e){ console.error('Error guardando turnos', e); showToast('No se pudo guardar localmente'); }
}
function saveActiveShiftId(){
  try{ localStorage.setItem(ACTIVE_SHIFT_KEY, activeShiftId || ''); }catch(e){}
}
/* Guarda local y además sincroniza el turno activo a la nube (si está configurada) */
function persistActiveShift(){
  saveShiftsLocal();
  queueCloudSync();
}

function getActiveShift(){ return shifts.find(s => s.id === activeShiftId) || null; }
function getActivePatients(){ const s = getActiveShift(); return s ? s.patients : []; }

function ensureActiveShift(){
  let saved = null;
  try{ saved = localStorage.getItem(ACTIVE_SHIFT_KEY); }catch(e){}
  if (saved && shifts.some(s => s.id === saved)){ activeShiftId = saved; return; }
  if (shifts.length){
    const sorted = [...shifts].sort((a,b) => (b.date+b.type).localeCompare(a.date+a.type) || (b.createdAt||'').localeCompare(a.createdAt||''));
    activeShiftId = sorted[0].id;
  } else {
    const s = createShiftObject(todayISO(), guessShiftType());
    shifts.push(s);
    activeShiftId = s.id;
    saveShiftsLocal();
  }
  saveActiveShiftId();
}
function createShiftObject(date, type){
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), date, type, createdAt: new Date().toISOString(), patients: [] };
}
function findShiftByDateType(date, type){ return shifts.find(s => s.date === date && s.type === type); }

function switchOrCreateShift(date, type){
  let s = findShiftByDateType(date, type);
  if (!s){ s = createShiftObject(date, type); shifts.push(s); saveShiftsLocal(); }
  activeShiftId = s.id;
  saveActiveShiftId();
  attachCloudListener(s);
  fetchShiftFromCloudOnce(s);
}

/* =========================================================
   SINCRONIZACIÓN EN LA NUBE (opcional, Firestore)
   Se activa solo si /firebase-config.js trae credenciales reales.
   Cada turno (fecha+jornada) es un documento compartido:
   quien use la misma fecha y jornada ve los mismos pacientes.
   ========================================================= */
let cloudEnabled = false;
let db = null;
let cloudUnsub = null;
let cloudSyncTimer = null;
let applyingRemoteSnapshot = false;

function initCloud(){
  try{
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || cfg.apiKey.indexOf('TU_') === 0 || cfg.apiKey === '') return;
    if (typeof firebase === 'undefined') return;
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    cloudEnabled = true;
  }catch(e){
    console.warn('Sincronización en la nube no disponible', e);
    cloudEnabled = false;
  }
}
function shiftDocId(shift){ return `${shift.date}_${shift.type}`; }

function attachCloudListener(shift){
  if (!cloudEnabled) return;
  if (cloudUnsub){ cloudUnsub(); cloudUnsub = null; }
  const id = shiftDocId(shift);
  try{
    cloudUnsub = db.collection('shifts').doc(id).onSnapshot((docSnap) => {
      if (!docSnap.exists) return;
      const data = docSnap.data();
      if (!data || !Array.isArray(data.patients)) return;
      const target = shifts.find(x => x.id === shift.id);
      if (!target) return;
      applyingRemoteSnapshot = true;
      target.patients = data.patients;
      saveShiftsLocal();
      updateSyncBadge(true);
      if (views.form.hidden){ refreshCurrentView(); }
      applyingRemoteSnapshot = false;
    }, (err) => {
      console.warn('Error de sincronización', err);
      updateSyncBadge(false);
    });
    updateSyncBadge(true);
  }catch(e){ console.warn(e); }
}

function fetchShiftFromCloudOnce(shift){
  if (!cloudEnabled) return;
  const id = shiftDocId(shift);
  db.collection('shifts').doc(id).get().then((docSnap) => {
    if (!docSnap.exists) return;
    const data = docSnap.data();
    if (!data || !Array.isArray(data.patients)) return;
    const target = shifts.find(x => x.id === shift.id);
    if (!target) return;
    if (data.patients.length > target.patients.length || target.patients.length === 0){
      target.patients = data.patients;
      saveShiftsLocal();
      refreshCurrentView();
    }
  }).catch((e) => console.warn('No se pudo leer el turno en la nube', e));
}

function queueCloudSync(){
  if (!cloudEnabled || applyingRemoteSnapshot) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    const s = getActiveShift();
    if (!s) return;
    const id = shiftDocId(s);
    db.collection('shifts').doc(id).set({
      date: s.date, type: s.type, patients: s.patients,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).then(() => updateSyncBadge(true)).catch((e) => { console.warn('Error guardando en la nube', e); updateSyncBadge(false); });
  }, 700);
}

function updateSyncBadge(ok){
  const el = document.getElementById('shiftSyncBadge');
  if (!cloudEnabled){ el.hidden = true; return; }
  el.hidden = false;
  el.textContent = ok ? '☁️ Sincronizado' : '⚠️ Sin conexión';
  el.style.color = ok ? 'var(--green)' : 'var(--yellow)';
}

/* ---------- Tema ---------- */
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', saved || (prefersLight ? 'light' : 'dark'));
}
function toggleTheme(){
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

/* ---------- Navegación entre vistas ---------- */
const MAIN_VIEWS = ['listView', 'pendientesView', 'specialtyView', 'dispositionView'];
const views = {
  listView: document.getElementById('listView'),
  pendientesView: document.getElementById('pendientesView'),
  specialtyView: document.getElementById('specialtyView'),
  dispositionView: document.getElementById('dispositionView'),
  formView: document.getElementById('formView'),
  reportView: document.getElementById('reportView'),
  shiftView: document.getElementById('shiftView'),
};
const fab = document.getElementById('btnNew');
const bottomNav = document.getElementById('bottomNav');

function showView(name){
  Object.values(views).forEach(v => v.hidden = true);
  views[name].hidden = false;
  fab.hidden = name !== 'listView';
  bottomNav.hidden = !MAIN_VIEWS.includes(name);
  if (MAIN_VIEWS.includes(name)){
    lastMainView = name;
    document.querySelectorAll('.bn-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    refreshCurrentView();
  }
}
function refreshCurrentView(){
  renderShiftBar();
  if (lastMainView === 'listView') render();
  else if (lastMainView === 'pendientesView') renderPendientes();
  else if (lastMainView === 'specialtyView') renderSpecialtyView();
  else if (lastMainView === 'dispositionView') renderDispositionView();
  renderPendientesBadge();
}

document.querySelectorAll('.bn-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.tab));
});

/* ---------- Barra de turno ---------- */
function renderShiftBar(){
  const s = getActiveShift();
  if (!s) return;
  document.getElementById('shiftIcon').textContent = SHIFT_TYPE_ICON[s.type] || '🕐';
  document.getElementById('shiftDateLabel').textContent = formatShiftDate(s.date);
  document.getElementById('shiftTypeLabel').textContent = `Turno ${SHIFT_TYPE_LABEL[s.type] || s.type}`;
  const n = s.patients.length;
  document.getElementById('shiftPatientCount').textContent = `${n} paciente${n===1?'':'s'}`;
  document.getElementById('shiftMeta').textContent = `${formatShiftDate(s.date)} · ${SHIFT_TYPE_LABEL[s.type]} · diligenciado ${nowTimeLabel()}`;
  updateSyncBadge(true);
}

/* ---------- Helpers de tarjeta (compartidos por Pacientes y Especialidades) ---------- */
function specialtyTagsHtml(p){
  if (!p.specialties || !p.specialties.length) return '';
  return `<div class="card-specialties">${p.specialties.map(id => `<span class="spec-tag">${escapeHtml(SPECIALTY_LABEL[id] || id)}</span>`).join('')}</div>`;
}
function pendingPreviewHtml(p){
  const pend = (p.actions || []).filter(a => !a.done);
  if (!pend.length) return '';
  const shown = pend.slice(0, 3);
  let html = `<ul class="card-pending-preview">${shown.map(a => `<li>${escapeHtml(a.text)}</li>`).join('')}</ul>`;
  if (pend.length > shown.length) html += `<div class="card-pending-more">+${pend.length - shown.length} pendiente(s) más</div>`;
  return html;
}
function patientCardHtml(p){
  return `
    <div class="card-stripe ${p.severity||''}"></div>
    <div class="card-body">
      <div class="card-top">
        <span class="card-bed">${escapeHtml(p.bed || 'Sin cama')}</span>
        <span class="card-age">${p.age ? p.age+' a\u00f1os' : ''} ${p.sex ? '· '+p.sex : ''}</span>
      </div>
      <p class="card-dx">${escapeHtml(p.diagnosis || 'Sin diagnóstico registrado')}</p>
      <div class="card-meta">
        <span class="badge ${p.severity||''}">${SEVERITY_LABEL[p.severity] || 'Sin clasificar'}</span>
        <span class="card-actions-count">${(p.actions||[]).filter(a=>!a.done).length} pendiente(s)</span>
      </div>
      ${specialtyTagsHtml(p)}
      ${pendingPreviewHtml(p)}
    </div>
    <button class="card-quick-copy" aria-label="Copiar reporte de ${escapeHtml(p.bed||'paciente')}" data-action="quickcopy" data-id="${p.id}">
      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
    </button>`;
}
function bindPatientCard(card, p){
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="quickcopy"]')){ e.stopPropagation(); copyToClipboard(buildPatientReport(p)); return; }
    openReport(p.id);
  });
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function sortBySeverity(list){
  return [...list].sort((a,b) => (SEVERITY_ORDER[a.severity]??3) - (SEVERITY_ORDER[b.severity]??3));
}

/* ---------- TAB: Pacientes ---------- */
function render(){
  const patients = getActivePatients();
  const listEl = document.getElementById('patientList');
  const emptyEl = document.getElementById('emptyState');

  const counts = { all: patients.length, green: 0, yellow: 0, red: 0 };
  patients.forEach(p => counts[p.severity] = (counts[p.severity]||0) + 1);
  document.getElementById('countAll').textContent = counts.all;
  document.getElementById('countGreen').textContent = counts.green || 0;
  document.getElementById('countYellow').textContent = counts.yellow || 0;
  document.getElementById('countRed').textContent = counts.red || 0;

  const filtered = currentFilter === 'all' ? patients : patients.filter(p => p.severity === currentFilter);
  listEl.innerHTML = '';
  emptyEl.hidden = patients.length !== 0;

  sortBySeverity(filtered).forEach(p => {
    const card = document.createElement('div');
    card.className = 'patient-card';
    card.innerHTML = patientCardHtml(p);
    bindPatientCard(card, p);
    listEl.appendChild(card);
  });
}
document.querySelectorAll('.chip[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#listView .chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-selected','false'); });
    chip.classList.add('active'); chip.setAttribute('aria-selected','true');
    currentFilter = chip.dataset.filter;
    render();
  });
});

/* ---------- TAB: Pendientes agrupados ---------- */
function renderPendientesBadge(){
  const total = getActivePatients().reduce((acc,p) => acc + (p.actions||[]).filter(a=>!a.done).length, 0);
  const badge = document.getElementById('pendientesBadge');
  badge.hidden = total === 0;
  badge.textContent = total > 99 ? '99+' : total;
}
function renderPendientes(){
  const patients = sortBySeverity(getActivePatients());
  const wrap = document.getElementById('pendientesGroups');
  const empty = document.getElementById('pendientesEmpty');
  wrap.innerHTML = '';

  const groups = [
    { key:'red', title: '🔴 Inestables' },
    { key:'yellow', title: '🟡 Watcher' },
    { key:'green', title: '🟢 Estables' },
  ];
  let any = false;

  groups.forEach(g => {
    const patientsInGroup = patients.filter(p => (p.severity||'') === g.key && (p.actions||[]).length);
    if (!patientsInGroup.length) return;
    any = true;
    const groupEl = document.createElement('div');
    groupEl.className = 'pending-group';
    let itemsHtml = '';
    patientsInGroup.forEach(p => {
      (p.actions||[]).forEach((a, idx) => {
        itemsHtml += `
          <div class="pending-item ${a.done?'done':''}" data-patient="${p.id}" data-idx="${idx}">
            <span class="pi-check"></span>
            <div class="pi-body">
              <div class="pi-text">${escapeHtml(a.text)}</div>
              <div class="pi-meta">Cama ${escapeHtml(p.bed||'-')}</div>
            </div>
          </div>`;
      });
    });
    groupEl.innerHTML = `<div class="pending-group-title">${g.title}</div>${itemsHtml}`;
    wrap.appendChild(groupEl);
  });

  empty.hidden = any;

  wrap.querySelectorAll('.pending-item').forEach(item => {
    item.addEventListener('click', () => {
      const pid = item.dataset.patient;
      const idx = Number(item.dataset.idx);
      const p = getActivePatients().find(x => x.id === pid);
      if (!p || !p.actions[idx]) return;
      p.actions[idx].done = !p.actions[idx].done;
      persistActiveShift();
      renderPendientes();
      renderPendientesBadge();
    });
  });
}

/* ---------- TAB: Especialidades ---------- */
function renderSpecialtyTabs(){
  const wrap = document.getElementById('specialtyTabs');
  wrap.innerHTML = '';
  ALL_SPECIALTIES.filter(s => MAIN_SPECIALTIES.includes(s)).forEach(s => addSpecialtyTab(wrap, s.id, s.label));
  const otherBtn = document.createElement('button');
  otherBtn.className = 'chip' + (currentSpecialtyTab === '__otras__' ? ' active' : '');
  otherBtn.dataset.spec = '__otras__';
  otherBtn.textContent = 'Otras';
  otherBtn.addEventListener('click', () => { currentSpecialtyTab = '__otras__'; renderSpecialtyTabs(); renderSpecialtyView(); });
  wrap.appendChild(otherBtn);
}
function addSpecialtyTab(wrap, id, label){
  const btn = document.createElement('button');
  btn.className = 'chip' + (currentSpecialtyTab === id ? ' active' : '');
  btn.dataset.spec = id;
  btn.textContent = label;
  btn.addEventListener('click', () => { currentSpecialtyTab = id; renderSpecialtyTabs(); renderSpecialtyView(); });
  wrap.appendChild(btn);
}
function renderSpecialtyView(){
  if (!document.getElementById('specialtyTabs').children.length) renderSpecialtyTabs();
  const patients = getActivePatients();
  const matchIds = currentSpecialtyTab === '__otras__' ? OTHER_SPECIALTY_IDS : [currentSpecialtyTab];
  const filtered = sortBySeverity(patients.filter(p => (p.specialties||[]).some(id => matchIds.includes(id))));
  const listEl = document.getElementById('specialtyList');
  const emptyEl = document.getElementById('specialtyEmpty');
  listEl.innerHTML = '';
  emptyEl.hidden = filtered.length !== 0;
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'patient-card';
    card.innerHTML = patientCardHtml(p);
    bindPatientCard(card, p);
    listEl.appendChild(card);
  });
}

/* ---------- TAB: Traslados ---------- */
function renderDispositionView(){
  const patients = getActivePatients();
  const wrap = document.getElementById('dispositionGroups');
  wrap.innerHTML = '';
  DISPOSITIONS.forEach(d => {
    const inGroup = patients.filter(p => p.disposition === d.id);
    const groupEl = document.createElement('div');
    groupEl.className = 'disposition-group';
    let itemsHtml = inGroup.length
      ? inGroup.map(p => `
          <div class="disposition-item" data-id="${p.id}">
            <span class="dn-icon">${SEVERITY_ICON_DOT(p.severity)}</span>
            <span class="di-bed">${escapeHtml(p.bed||'-')}</span>
            <span class="di-dx">${escapeHtml(p.diagnosis||'')}</span>
          </div>`).join('')
      : `<p class="disposition-empty">Sin pacientes en este destino</p>`;
    groupEl.innerHTML = `<div class="disposition-group-title">${d.icon} ${d.label} <span style="opacity:.6">(${inGroup.length})</span></div>${itemsHtml}`;
    wrap.appendChild(groupEl);
  });
  const sinDefinir = patients.filter(p => !p.disposition);
  if (sinDefinir.length){
    const groupEl = document.createElement('div');
    groupEl.className = 'disposition-group';
    groupEl.innerHTML = `<div class="disposition-group-title">⬜ Sin definir <span style="opacity:.6">(${sinDefinir.length})</span></div>` +
      sinDefinir.map(p => `<div class="disposition-item" data-id="${p.id}"><span class="dn-icon">${SEVERITY_ICON_DOT(p.severity)}</span><span class="di-bed">${escapeHtml(p.bed||'-')}</span><span class="di-dx">${escapeHtml(p.diagnosis||'')}</span></div>`).join('');
    wrap.appendChild(groupEl);
  }
  wrap.querySelectorAll('.disposition-item').forEach(item => {
    item.addEventListener('click', () => openReport(item.dataset.id));
  });
}
function SEVERITY_ICON_DOT(sev){ return { red:'🔴', yellow:'🟡', green:'🟢' }[sev] || '⚪'; }

/* ---------- Formulario: apertura ---------- */
function renderSpecialtyGrid(){
  const grid = document.getElementById('specialtyGrid');
  grid.innerHTML = '';
  ALL_SPECIALTIES.forEach(s => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'spec-chip' + (draftSpecialties.includes(s.id) ? ' selected' : '');
    chip.dataset.spec = s.id;
    chip.innerHTML = `<span class="spec-box"></span><span>${escapeHtml(s.label)}</span>`;
    chip.addEventListener('click', () => {
      const i = draftSpecialties.indexOf(s.id);
      if (i === -1) draftSpecialties.push(s.id); else draftSpecialties.splice(i,1);
      renderSpecialtyGrid();
    });
    grid.appendChild(chip);
  });
}
function populateDispositionSelect(){
  const sel = document.getElementById('fDisposition');
  sel.innerHTML = '<option value="">Sin definir</option>' +
    DISPOSITIONS.map(d => `<option value="${d.id}">${d.icon} ${d.label}</option>`).join('');
}

function openNewPatient(){
  editingId = null;
  draftActions = [];
  draftSeverity = null;
  draftSpecialties = [];
  currentStep = 1;
  document.getElementById('formTitle').textContent = 'Nuevo paciente';
  document.getElementById('btnDelete').hidden = true;
  document.getElementById('patientForm').reset();
  renderActions();
  renderSpecialtyGrid();
  setSeverity(null);
  goToStep(1);
  showView('formView');
}
function openEditPatient(id){
  const p = getActivePatients().find(x => x.id === id);
  if (!p) return;
  editingId = id;
  draftActions = JSON.parse(JSON.stringify(p.actions || []));
  draftSeverity = p.severity || null;
  draftSpecialties = [...(p.specialties || [])];
  currentStep = 1;

  document.getElementById('formTitle').textContent = `Editar · ${p.bed || 'paciente'}`;
  document.getElementById('btnDelete').hidden = false;

  document.getElementById('fBed').value = p.bed || '';
  document.getElementById('fAge').value = p.age || '';
  document.getElementById('fSex').value = p.sex || '';
  document.getElementById('fDx').value = p.diagnosis || '';
  document.getElementById('fVitals').value = p.vitals || '';
  document.getElementById('fRespType').value = p.respType || '';
  document.getElementById('fRespDetail').value = p.respDetail || '';
  document.getElementById('fHemoType').value = p.hemoType || '';
  document.getElementById('fHemoDetail').value = p.hemoDetail || '';
  document.getElementById('fMeds').value = p.meds || '';
  document.getElementById('fContingency').value = p.contingency || '';
  document.getElementById('fDisposition').value = p.disposition || '';

  renderActions();
  renderSpecialtyGrid();
  setSeverity(draftSeverity);
  goToStep(1);
  showView('formView');
}
document.getElementById('btnNew').addEventListener('click', openNewPatient);
document.getElementById('btnBack').addEventListener('click', () => showView(lastMainView));

/* ---------- Pasos del formulario ---------- */
function goToStep(n){
  currentStep = n;
  document.querySelectorAll('.step-panel').forEach(p => p.classList.toggle('active', Number(p.dataset.panel) === n));
  document.querySelectorAll('.step-btn').forEach(b => {
    const bn = Number(b.dataset.step);
    b.classList.toggle('active', bn === n);
    b.setAttribute('aria-selected', bn === n ? 'true' : 'false');
    b.classList.toggle('done', bn < n);
  });
  document.getElementById('btnPrevStep').hidden = n === 1;
  document.getElementById('btnNextStep').hidden = n === 4;
  document.getElementById('btnSave').hidden = n !== 4;
}
document.querySelectorAll('.step-btn').forEach(btn => btn.addEventListener('click', () => goToStep(Number(btn.dataset.step))));
document.getElementById('btnNextStep').addEventListener('click', () => {
  if (currentStep === 1 && !document.getElementById('fBed').value.trim()){
    document.getElementById('fBed').focus();
    showToast('Ingresa la cama del paciente');
    return;
  }
  goToStep(Math.min(4, currentStep + 1));
});
document.getElementById('btnPrevStep').addEventListener('click', () => goToStep(Math.max(1, currentStep - 1)));

/* ---------- Selector de gravedad ---------- */
function setSeverity(sev){
  draftSeverity = sev;
  document.querySelectorAll('.sev-btn').forEach(b => b.classList.toggle('selected', b.dataset.sev === sev));
}
document.getElementById('severitySelect').addEventListener('click', (e) => {
  const btn = e.target.closest('.sev-btn');
  if (btn) setSeverity(btn.dataset.sev);
});

/* ---------- Lista de acciones dinámica ---------- */
function renderActions(){
  const ul = document.getElementById('actionList');
  const hint = document.getElementById('actionHint');
  ul.innerHTML = '';
  hint.hidden = draftActions.length !== 0;
  draftActions.forEach((a, idx) => {
    const li = document.createElement('li');
    li.className = 'action-item';
    li.innerHTML = `<span>${escapeHtml(a.text)}</span>
      <button type="button" aria-label="Eliminar pendiente" data-idx="${idx}">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>`;
    li.querySelector('button').addEventListener('click', () => { draftActions.splice(idx, 1); renderActions(); });
    ul.appendChild(li);
  });
}
function addActionFromInput(){
  const input = document.getElementById('fActionInput');
  const text = input.value.trim();
  if (!text) return;
  draftActions.push({ text, done:false });
  input.value = '';
  renderActions();
  input.focus();
}
document.getElementById('btnAddAction').addEventListener('click', addActionFromInput);
document.getElementById('fActionInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter'){ e.preventDefault(); addActionFromInput(); }
});

/* ---------- Guardar / eliminar paciente ---------- */
document.getElementById('btnSave').addEventListener('click', () => {
  const bed = document.getElementById('fBed').value.trim();
  if (!bed){ goToStep(1); showToast('Ingresa la cama del paciente'); return; }

  const data = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
    bed,
    age: document.getElementById('fAge').value.trim(),
    sex: document.getElementById('fSex').value,
    diagnosis: document.getElementById('fDx').value.trim(),
    severity: draftSeverity,
    specialties: [...draftSpecialties],
    vitals: document.getElementById('fVitals').value.trim(),
    respType: document.getElementById('fRespType').value,
    respDetail: document.getElementById('fRespDetail').value.trim(),
    hemoType: document.getElementById('fHemoType').value,
    hemoDetail: document.getElementById('fHemoDetail').value.trim(),
    meds: document.getElementById('fMeds').value.trim(),
    actions: draftActions,
    contingency: document.getElementById('fContingency').value.trim(),
    disposition: document.getElementById('fDisposition').value,
    updatedAt: new Date().toISOString(),
  };

  const patients = getActivePatients();
  if (editingId){
    const idx = patients.findIndex(p => p.id === editingId);
    patients[idx] = data;
  } else {
    patients.push(data);
  }
  persistActiveShift();
  showView(lastMainView);
  showToast('Paciente guardado');
});

document.getElementById('btnDelete').addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('¿Eliminar este paciente de la entrega de turno?')) return;
  const s = getActiveShift();
  s.patients = s.patients.filter(p => p.id !== editingId);
  persistActiveShift();
  showView(lastMainView);
  showToast('Paciente eliminado');
});

/* ---------- Reporte individual / texto plano ---------- */
function buildPatientReport(p){
  const sevIcon = { green: '🟢', yellow: '🟡', red: '🔴' }[p.severity] || '⚪';
  const specs = (p.specialties||[]).map(id => SPECIALTY_LABEL[id]).filter(Boolean).join(', ');
  const lines = [];
  lines.push(`${sevIcon} CAMA ${p.bed || '-'}  |  ${p.age ? p.age+' a\u00f1os' : 'edad ND'}  |  ${p.sex || 'sexo ND'}`);
  lines.push(`Gravedad: ${SEVERITY_LABEL[p.severity] || 'Sin clasificar'}`);
  lines.push(`Especialidad(es): ${specs || '-'}`);
  lines.push(`Dx: ${p.diagnosis || '-'}`);
  lines.push('');
  lines.push('— ESTADO Y SOPORTES —');
  lines.push(`SV/PAM: ${p.vitals || '-'}`);
  lines.push(`Resp: ${[p.respType, p.respDetail].filter(Boolean).join(' — ') || '-'}`);
  lines.push(`Hemodinámico: ${[p.hemoType, p.hemoDetail].filter(Boolean).join(' — ') || '-'}`);
  lines.push(`Medicación crítica: ${p.meds || '-'}`);
  lines.push('');
  lines.push('— PENDIENTES —');
  if (p.actions && p.actions.length) p.actions.forEach(a => lines.push(`[${a.done?'x':' '}] ${a.text}`));
  else lines.push('(sin pendientes)');
  lines.push('');
  lines.push('— CONTINGENCIA —');
  lines.push(p.contingency ? p.contingency : '(sin plan registrado)');
  lines.push('');
  lines.push(`Destino/traslado: ${p.disposition ? DISPOSITION_LABEL[p.disposition] : 'Sin definir'}`);
  return lines.join('\n');
}
function buildShiftReport(){
  const s = getActiveShift();
  const patients = s ? s.patients : [];
  const shiftHeader = s ? `${formatShiftDate(s.date)} — Turno ${SHIFT_TYPE_LABEL[s.type]} ${SHIFT_TYPE_ICON[s.type]}` : '';
  if (!patients.length) return `ENTREGA DE TURNO\n${shiftHeader}\n\nNo hay pacientes registrados en este turno.`;
  const header = `ENTREGA DE TURNO\n${shiftHeader}\n${patients.length} paciente(s)\n`;
  const body = sortBySeverity(patients).map(buildPatientReport).join('\n\n' + '─'.repeat(28) + '\n\n');
  return header + '\n' + body;
}

/* ---------- Vista de reporte ---------- */
function openReport(id){
  const p = getActivePatients().find(x => x.id === id);
  if (!p) return;
  document.getElementById('reportTitle').textContent = `Reporte · ${p.bed || 'paciente'}`;
  document.getElementById('reportText').textContent = buildPatientReport(p);
  window.__lastEditId = id;
  showView('reportView');
}
document.getElementById('btnReportBack').addEventListener('click', () => showView(lastMainView));
document.getElementById('btnReportEdit').addEventListener('click', () => { if (window.__lastEditId) openEditPatient(window.__lastEditId); });
document.getElementById('btnReportCopy').addEventListener('click', () => copyToClipboard(document.getElementById('reportText').textContent));
document.getElementById('btnCopyAll').addEventListener('click', () => copyToClipboard(buildShiftReport()));

/* ---------- Vista de turnos ---------- */
function openShiftView(){
  const s = getActiveShift();
  document.getElementById('fShiftDate').value = s ? s.date : todayISO();
  draftShiftType = s ? s.type : guessShiftType();
  setDayNight(draftShiftType);
  document.getElementById('shiftAutoHint').textContent =
    `Sugerido según la fecha y hora actuales (${nowTimeLabel()}): ${formatShiftDate(todayISO())} · ${SHIFT_TYPE_LABEL[guessShiftType()]}.`;
  const codeField = document.getElementById('cloudCodeField');
  if (cloudEnabled && s){
    codeField.hidden = false;
    document.getElementById('fCloudCode').value = shiftDocId(s);
  } else {
    codeField.hidden = true;
  }
  renderShiftHistory();
  showView('shiftView');
}
document.getElementById('btnShift').addEventListener('click', openShiftView);
document.getElementById('btnShiftBack').addEventListener('click', () => showView(lastMainView));

function setDayNight(type){
  draftShiftType = type;
  document.querySelectorAll('.dn-btn').forEach(b => b.classList.toggle('selected', b.dataset.type === type));
}
document.getElementById('daynightSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('.dn-btn');
  if (btn) setDayNight(btn.dataset.type);
});
document.getElementById('btnUseShift').addEventListener('click', () => {
  const date = document.getElementById('fShiftDate').value || todayISO();
  const type = draftShiftType || guessShiftType();
  switchOrCreateShift(date, type);
  currentFilter = 'all';
  showView('listView');
  showToast('Turno activo actualizado');
});

function renderShiftHistory(){
  const listEl = document.getElementById('shiftHistoryList');
  listEl.innerHTML = '';
  if (!shifts.length){ listEl.innerHTML = '<p class="shift-history-empty">Aún no hay turnos anteriores registrados.</p>'; return; }
  const sorted = [...shifts].sort((a,b) => (b.date+b.type).localeCompare(a.date+a.type) || (b.createdAt||'').localeCompare(a.createdAt||''));
  sorted.forEach(s => {
    const row = document.createElement('div');
    row.className = 'shift-history-item' + (s.id === activeShiftId ? ' active' : '');
    row.innerHTML = `
      <span class="dn-icon">${SHIFT_TYPE_ICON[s.type] || '🕐'}</span>
      <div class="shi-info">
        <div class="shi-date">${formatShiftDate(s.date)}</div>
        <div class="shi-meta">${SHIFT_TYPE_LABEL[s.type] || s.type} · ${s.patients.length} paciente(s)</div>
      </div>
      <button type="button" class="shi-delete" aria-label="Eliminar turno" data-id="${s.id}">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.shi-delete')){
        e.stopPropagation();
        if (shifts.length <= 1){ showToast('Debe quedar al menos un turno'); return; }
        if (!confirm(`¿Eliminar el turno del ${formatShiftDate(s.date)} (${SHIFT_TYPE_LABEL[s.type]}) y todos sus pacientes de este dispositivo?`)) return;
        shifts = shifts.filter(x => x.id !== s.id);
        if (activeShiftId === s.id){
          const sorted2 = [...shifts].sort((a,b) => (b.date+b.type).localeCompare(a.date+a.type));
          activeShiftId = sorted2[0].id;
          saveActiveShiftId();
        }
        saveShiftsLocal();
        renderShiftHistory();
        return;
      }
      activeShiftId = s.id;
      saveActiveShiftId();
      attachCloudListener(s);
      fetchShiftFromCloudOnce(s);
      document.getElementById('fShiftDate').value = s.date;
      setDayNight(s.type);
      renderShiftHistory();
      showView('listView');
      showToast('Turno cambiado');
    });
    listEl.appendChild(row);
  });
}

/* ---------- PDF (impresión) ---------- */
function buildPrintHtml(){
  const s = getActiveShift();
  const patients = s ? sortBySeverity(s.patients) : [];
  const shiftHeader = s ? `${formatShiftDate(s.date)} — Turno ${SHIFT_TYPE_LABEL[s.type]} ${SHIFT_TYPE_ICON[s.type]}` : '';
  let html = `<h1>Entrega de Turno</h1><div class="pp-meta">${escapeHtml(shiftHeader)} · Generado ${new Date().toLocaleString('es-CO')} · ${patients.length} paciente(s)</div>`;

  html += '<h2>Pacientes</h2>';
  patients.forEach(p => {
    const specs = (p.specialties||[]).map(id => SPECIALTY_LABEL[id]).filter(Boolean).join(', ') || '-';
    const pend = (p.actions||[]).length ? p.actions.map(a => `<li>${a.done?'✔ ':''}${escapeHtml(a.text)}</li>`).join('') : '<li>(sin pendientes)</li>';
    html += `<div class="pp-patient pp-sev-${p.severity||'green'}">
      <b>Cama ${escapeHtml(p.bed||'-')} · ${p.age?p.age+' años':'edad ND'} · ${escapeHtml(p.sex||'')}</b> — ${SEVERITY_LABEL[p.severity]||'Sin clasificar'}<br>
      Especialidad(es): ${escapeHtml(specs)}<br>
      Dx: ${escapeHtml(p.diagnosis||'-')}<br>
      SV/PAM: ${escapeHtml(p.vitals||'-')}<br>
      Resp: ${escapeHtml([p.respType,p.respDetail].filter(Boolean).join(' — ')||'-')} · Hemodinámico: ${escapeHtml([p.hemoType,p.hemoDetail].filter(Boolean).join(' — ')||'-')}<br>
      Medicación crítica: ${escapeHtml(p.meds||'-')}<br>
      Pendientes: <ul>${pend}</ul>
      Contingencia: ${escapeHtml(p.contingency||'(sin plan registrado)')}<br>
      Destino: ${p.disposition ? escapeHtml(DISPOSITION_LABEL[p.disposition]) : 'Sin definir'}
    </div>`;
  });

  html += '<h2>Traslados</h2><ul>';
  DISPOSITIONS.forEach(d => {
    const group = patients.filter(p => p.disposition === d.id);
    if (group.length) html += `<li><b>${d.icon} ${d.label}:</b> ${group.map(p=>escapeHtml(p.bed||'-')).join(', ')}</li>`;
  });
  html += '</ul>';

  return html;
}
document.getElementById('btnPdf').addEventListener('click', () => {
  document.getElementById('printArea').innerHTML = buildPrintHtml();
  setTimeout(() => window.print(), 50);
});

/* ---------- Portapapeles ---------- */
async function copyToClipboard(text){
  try{
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    showToast('Reporte copiado al portapapeles');
  } catch(e){ console.error(e); showToast('No se pudo copiar. Selecciona y copia manualmente.'); }
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

document.getElementById('btnTheme').addEventListener('click', toggleTheme);

/* ---------- Service worker (offline) ---------- */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW no registrado', err));
  });
}

/* ---------- Init ---------- */
initTheme();
populateDispositionSelect();
initCloud();
shifts = loadShifts();
ensureActiveShift();
saveShiftsLocal();
attachCloudListener(getActiveShift());
fetchShiftFromCloudOnce(getActiveShift());
showView('listView');
