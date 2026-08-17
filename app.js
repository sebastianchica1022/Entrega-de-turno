/* =========================================================
   Entrega de Turno — I-PASS/SBAR
   Almacenamiento: localStorage (offline-first)
   ========================================================= */

const STORAGE_KEY = 'handoff.patients.v1';
const THEME_KEY = 'handoff.theme';

const SEVERITY_LABEL = { green: 'Estable', yellow: 'Watcher', red: 'Inestable' };

/* ---------- Estado en memoria ---------- */
let patients = loadPatients();
let currentFilter = 'all';
let editingId = null;      // id del paciente que se está editando (null = nuevo)
let currentStep = 1;
let draftActions = [];     // acciones del paciente en edición
let draftSeverity = null;

/* ---------- Persistencia ---------- */
function loadPatients(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    console.error('Error leyendo almacenamiento local', e);
    return [];
  }
}
function savePatients(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
  }catch(e){
    console.error('Error guardando en almacenamiento local', e);
    showToast('No se pudo guardar (almacenamiento lleno u no disponible)');
  }
}

/* ---------- Tema ---------- */
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = saved || (prefersLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

/* ---------- Navegación entre vistas ---------- */
const views = {
  list: document.getElementById('listView'),
  form: document.getElementById('formView'),
  report: document.getElementById('reportView'),
};
const fab = document.getElementById('btnNew');

function showView(name){
  Object.values(views).forEach(v => v.hidden = true);
  views[name].hidden = false;
  fab.hidden = name !== 'list';
}

/* ---------- Render lista de pacientes ---------- */
function render(){
  const listEl = document.getElementById('patientList');
  const emptyEl = document.getElementById('emptyState');

  const counts = { all: patients.length, green: 0, yellow: 0, red: 0 };
  patients.forEach(p => counts[p.severity] = (counts[p.severity]||0) + 1);
  document.getElementById('countAll').textContent = counts.all;
  document.getElementById('countGreen').textContent = counts.green || 0;
  document.getElementById('countYellow').textContent = counts.yellow || 0;
  document.getElementById('countRed').textContent = counts.red || 0;

  document.getElementById('shiftMeta').textContent =
    patients.length ? `${patients.length} paciente${patients.length===1?'':'s'} en el turno` : 'Sin pacientes aún';

  const filtered = currentFilter === 'all' ? patients : patients.filter(p => p.severity === currentFilter);

  listEl.innerHTML = '';
  emptyEl.hidden = patients.length !== 0;

  // orden: rojo > amarillo > verde, luego por cama
  const order = { red: 0, yellow: 1, green: 2, '': 3 };
  const sorted = [...filtered].sort((a,b) => (order[a.severity]??3) - (order[b.severity]??3));

  sorted.forEach(p => {
    const card = document.createElement('div');
    card.className = 'patient-card';
    card.innerHTML = `
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
      </div>
      <button class="card-quick-copy" aria-label="Copiar reporte de ${escapeHtml(p.bed||'paciente')}" data-action="quickcopy" data-id="${p.id}">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="quickcopy"]')) {
        e.stopPropagation();
        copyToClipboard(buildPatientReport(p));
        return;
      }
      openReport(p.id);
    });
    listEl.appendChild(card);
  });
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

/* ---------- Filtros ---------- */
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-selected','false'); });
    chip.classList.add('active');
    chip.setAttribute('aria-selected','true');
    currentFilter = chip.dataset.filter;
    render();
  });
});

/* ---------- Formulario: apertura ---------- */
function openNewPatient(){
  editingId = null;
  draftActions = [];
  draftSeverity = null;
  currentStep = 1;
  document.getElementById('formTitle').textContent = 'Nuevo paciente';
  document.getElementById('btnDelete').hidden = true;
  document.getElementById('patientForm').reset();
  renderActions();
  setSeverity(null);
  goToStep(1);
  showView('form');
}

function openEditPatient(id){
  const p = patients.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  draftActions = JSON.parse(JSON.stringify(p.actions || []));
  draftSeverity = p.severity || null;
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

  renderActions();
  setSeverity(draftSeverity);
  goToStep(1);
  showView('form');
}

document.getElementById('btnNew').addEventListener('click', openNewPatient);
document.getElementById('btnBack').addEventListener('click', () => { showView('list'); render(); });

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

document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => goToStep(Number(btn.dataset.step)));
});
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
  if (!btn) return;
  setSeverity(btn.dataset.sev);
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
    li.querySelector('button').addEventListener('click', () => {
      draftActions.splice(idx, 1);
      renderActions();
    });
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
    vitals: document.getElementById('fVitals').value.trim(),
    respType: document.getElementById('fRespType').value,
    respDetail: document.getElementById('fRespDetail').value.trim(),
    hemoType: document.getElementById('fHemoType').value,
    hemoDetail: document.getElementById('fHemoDetail').value.trim(),
    meds: document.getElementById('fMeds').value.trim(),
    actions: draftActions,
    contingency: document.getElementById('fContingency').value.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (editingId){
    const idx = patients.findIndex(p => p.id === editingId);
    patients[idx] = data;
  } else {
    patients.push(data);
  }
  savePatients();
  showView('list');
  render();
  showToast('Paciente guardado');
});

document.getElementById('btnDelete').addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('¿Eliminar este paciente de la entrega de turno?')) return;
  patients = patients.filter(p => p.id !== editingId);
  savePatients();
  showView('list');
  render();
  showToast('Paciente eliminado');
});

/* ---------- Reporte individual ---------- */
function buildPatientReport(p){
  const sevIcon = { green: '🟢', yellow: '🟡', red: '🔴' }[p.severity] || '⚪';
  const lines = [];
  lines.push(`${sevIcon} CAMA ${p.bed || '-'}  |  ${p.age ? p.age+' a\u00f1os' : 'edad ND'}  |  ${p.sex || 'sexo ND'}`);
  lines.push(`Gravedad: ${SEVERITY_LABEL[p.severity] || 'Sin clasificar'}`);
  lines.push(`Dx: ${p.diagnosis || '-'}`);
  lines.push('');
  lines.push('— ESTADO Y SOPORTES —');
  lines.push(`SV/PAM: ${p.vitals || '-'}`);
  lines.push(`Resp: ${[p.respType, p.respDetail].filter(Boolean).join(' — ') || '-'}`);
  lines.push(`Hemodinámico: ${[p.hemoType, p.hemoDetail].filter(Boolean).join(' — ') || '-'}`);
  lines.push(`Medicación crítica: ${p.meds || '-'}`);
  lines.push('');
  lines.push('— PENDIENTES —');
  if (p.actions && p.actions.length){
    p.actions.forEach(a => lines.push(`[ ] ${a.text}`));
  } else {
    lines.push('(sin pendientes)');
  }
  lines.push('');
  lines.push('— CONTINGENCIA —');
  lines.push(p.contingency ? p.contingency : '(sin plan registrado)');
  return lines.join('\n');
}

function buildShiftReport(){
  if (!patients.length) return 'No hay pacientes registrados en este turno.';
  const header = `ENTREGA DE TURNO — ${new Date().toLocaleString('es-CO', { dateStyle:'medium', timeStyle:'short' })}\n${patients.length} paciente(s)\n`;
  const order = { red: 0, yellow: 1, green: 2, '': 3 };
  const sorted = [...patients].sort((a,b) => (order[a.severity]??3) - (order[b.severity]??3));
  const body = sorted.map(buildPatientReport).join('\n\n' + '─'.repeat(28) + '\n\n');
  return header + '\n' + body;
}

/* ---------- Vista de reporte ---------- */
function openReport(id){
  const p = patients.find(x => x.id === id);
  if (!p) return;
  document.getElementById('reportTitle').textContent = `Reporte · ${p.bed || 'paciente'}`;
  document.getElementById('reportText').textContent = buildPatientReport(p);
  showView('report');
  window.__lastEditId = id;
}
document.getElementById('btnReportBack').addEventListener('click', () => { showView('list'); render(); });
document.getElementById('reportText').addEventListener('click', () => {
  if (window.__lastEditId) openEditPatient(window.__lastEditId);
});
document.getElementById('btnReportCopy').addEventListener('click', () => {
  copyToClipboard(document.getElementById('reportText').textContent);
});

document.getElementById('btnCopyAll').addEventListener('click', () => {
  copyToClipboard(buildShiftReport());
});

/* ---------- Portapapeles ---------- */
async function copyToClipboard(text){
  try{
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast('Reporte copiado al portapapeles');
  } catch(e){
    console.error(e);
    showToast('No se pudo copiar. Selecciona y copia manualmente.');
  }
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Tema toggle ---------- */
document.getElementById('btnTheme').addEventListener('click', toggleTheme);

/* ---------- Service worker (offline) ---------- */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW no registrado', err));
  });
}

/* ---------- Init ---------- */
initTheme();
render();
showView('list');
