
/* Reemplazo completo del archivo con versión consolidada y sin duplicados.
   ...existing code... (funcionalidad preservada) */

const API_BASE = 'https://dimeloweb.onrender.com';
window.API_BASE = window.API_BASE || API_BASE;

const $ = sel => document.querySelector(sel);

// Elements
const balanceEl = $('#balance');
const incomeEl = $('#total-income');
const expenseEl = $('#total-expense');
const listEl = $('#transactions-list');
const form = $('#transaction-form');
const typeEl = $('#type');
const descEl = $('#description');
const amountEl = $('#amount');
const categoryEl = $('#category');
const clearAllBtn = $('#clear-all');

const authOverlay = $('#auth-overlay');
const authUserSelect = $('#auth-user-select');
const authUsernameInput = $('#auth-username-input');
const authRegisterBtn = $('#auth-register-user');
const loginBtn = $('#login-btn');
const logoutBtn = $('#logout-btn');

const headerAvatar = $('#header-avatar');
const authAvatar = $('#auth-avatar');
const authPhotoInput = $('#auth-photo-input');

const weeklySalaryEl = $('#weekly-salary');
const weeklyInput = $('#weekly-salary-input');
const setSalaryBtn = $('#set-weekly-salary');
const paySalaryBtn = $('#pay-salary');

const scheduledForm = $('#scheduled-form');
const schedDesc = $('#sched-description');
const schedAmount = $('#sched-amount');
const schedFreq = $('#sched-frequency');
const schedNextDue = $('#sched-nextdue');
const schedEndDate = $('#sched-enddate');
const createScheduledBtn = $('#create-scheduled');
const clearScheduledBtn = $('#clear-scheduled');
const scheduledListEl = $('#scheduled-list');

const enablePushBtn = $('#enable-push-btn');

let transactions = [];
let users = [];
let scheduledPayments = [];
let socket = null;
let pollIntervalId = null;
let swRegistrationForPush = null;

// small helpers
function formatMoney(n) {
	return Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}
function formatMoneyMX(n){ return Number(n).toLocaleString('es-MX',{style:'currency',currency:'MXN'}); }

// CACHING / FETCHING
async function fetchJson(url, fallbackKey) {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error('network');
		const data = await res.json();
		try { if (fallbackKey) localStorage.setItem(fallbackKey, JSON.stringify(data)); } catch(e){}
		return data;
	} catch(e) {
		if (!fallbackKey) return null;
		const cached = localStorage.getItem(fallbackKey);
		return cached ? JSON.parse(cached) : null;
	}
}

async function fetchTransactions(){ return await fetchJson(`${API_BASE}/api/transactions`, 'cachedTransactions') || []; }
async function fetchWallet(){ return await fetchJson(`${API_BASE}/api/wallet`, 'cachedWallet') || { balance:0, weeklySalary:0 }; }
async function fetchUsers(){ return await fetchJson(`${API_BASE}/api/users`, 'cachedUsers') || []; }
async function fetchScheduled(){ return await fetchJson(`${API_BASE}/api/scheduled`, 'cachedScheduled') || []; }

// UI renderers
function updateTotals() {
	let income = 0, expense = 0;
	transactions.forEach(t => { if (t.type === 'income') income += Number(t.amount); else expense += Number(t.amount); });
	if (balanceEl) balanceEl.textContent = formatMoney(income - expense);
	if (incomeEl) incomeEl.textContent = formatMoney(income);
	if (expenseEl) expenseEl.textContent = formatMoney(expense);
}

function addTransactionToDOM(t) {
	const div = document.createElement('div');
	div.className = `transaction ${t.type}`;
	div.dataset.id = t._id || t.id || '';
	div.innerHTML = `
		<div class="tx-left">
			<strong>${t.description}</strong>
			<br/><small>${t.category || 'General'} · ${new Date(t.createdAt || Date.now()).toLocaleString()}${t.username ? ' · por ' + t.username : ''}</small>
		</div>
		<div class="tx-right">
			<span class="tx-amount ${t.type === 'income' ? 'income' : 'expense'}">${formatMoney(Number(t.amount))}</span>
			<button class="btn small danger btn-delete">Eliminar</button>
		</div>
	`;
	if (listEl) listEl.appendChild(div);
	const delBtn = div.querySelector('.btn-delete');
	if (delBtn) delBtn.addEventListener('click', () => deleteTransaction(div.dataset.id));
}

function renderList() {
	if (!listEl) return;
	listEl.innerHTML = '';
	transactions.forEach(addTransactionToDOM);
	updateTotals();
}

function renderScheduledList() {
	if (!scheduledListEl) return;
	scheduledListEl.innerHTML = '';
	const now = Date.now();
	scheduledPayments.forEach(s => {
		const div = document.createElement('div');
		div.className = 'transaction';
		div.dataset.id = s._id || s.id;
		const dueTs = s.nextDue ? new Date(s.nextDue).getTime() : null;
		const due = s.nextDue ? new Date(s.nextDue).toLocaleDateString() : '—';
		let isDue = false, isSoon = false;
		if (dueTs) {
			if (dueTs <= now) isDue = true;
			else if (dueTs - now <= 24 * 60 * 60 * 1000) isSoon = true;
		}
		if (isSoon) div.classList.add('ending-soon');
		if (isDue) div.classList.add('due');

		div.innerHTML = `
			<div class="tx-left">
				<strong>${s.description}</strong>
				<br/><small>${s.category || 'General'} · ${s.frequency || '—'} · próxima: ${due}${s.username ? ' · por ' + s.username : ''}</small>
			</div>
			<div class="tx-right">
				<span>${formatMoney(Number(s.amount || 0))}</span>
				<div class="tx-actions">
					<button class="btn small" data-action="pay">Pagar</button>
					<button class="btn small danger" data-action="del">Eliminar</button>
				</div>
			</div>
		`;
		// Badge visual compacto con emoji y color según estado (vencido / próximo / normal)
		(function addSchedBadge() {
			const left = div.querySelector('.tx-left');
			if (!left) return;
			const badge = document.createElement('span');
			badge.className = 'sched-badge ' + (isDue ? 'due' : (isSoon ? 'soon' : 'normal'));
			badge.textContent = isDue ? '⚠️ Vencido' : (isSoon ? '🔔 Próximo' : '📌 Programado');
			// insertamos antes del título para visibilidad
			left.insertBefore(badge, left.firstChild);
		})();

 		scheduledListEl.appendChild(div);
 		const payBtn = div.querySelector('[data-action="pay"]');
 		const delBtn = div.querySelector('[data-action="del"]');
 		if (payBtn) payBtn.addEventListener('click', () => payScheduled(div.dataset.id));
 		if (delBtn) delBtn.addEventListener('click', () => deleteScheduled(div.dataset.id));
 	});
}

// AUTH / USERS
function showAuthOverlay() {
	if (authOverlay) authOverlay.style.display = 'flex';
	if (logoutBtn) logoutBtn.style.display = 'none';
	const appMain = document.getElementById('app-main');
	if (appMain) appMain.classList.add('hidden');
}
function hideAuthOverlay() {
	if (authOverlay) authOverlay.style.display = 'none';
	if (logoutBtn) logoutBtn.style.display = 'inline-block';
	const appMain = document.getElementById('app-main');
	if (appMain) appMain.classList.remove('hidden');
}

function getCurrentUser() {
	const id = authUserSelect ? authUserSelect.value : '';
	if (!id) return null;
	return users.find(u => (u._id || u.id) == id) || null;
}

async function registerUser() {
	const name = (authUsernameInput && authUsernameInput.value || '').trim();
	if (!name) return alert('Introduce nombre de usuario');
	try {
		const res = await fetch(`${API_BASE}/api/users/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: name })
		});
		if (!res.ok) {
			const err = await res.json().catch(()=>({error:'error'}));
			return alert('Error registro: ' + (err && err.error ? err.error : ''));
		}
		const user = await res.json();
		await loadUsersAndPopulate();
		if (authUserSelect) authUserSelect.value = user._id;
		localStorage.setItem('currentUserId', user._id);
		if (authUsernameInput) authUsernameInput.value = '';
		if (authPhotoInput && authPhotoInput.files && authPhotoInput.files[0]) {
			const file = authPhotoInput.files[0];
			const r = new FileReader();
			r.onload = async () => {
				try { await uploadProfilePhotoForUser(user._id || user.id, r.result); } catch(e){ console.warn(e); }
				authPhotoInput.value = '';
			};
			r.readAsDataURL(file);
		}
		handleLogin();
	} catch (e) {
		alert('Error registro');
	}
}

function svgAvatarDataUrl(name) {
	const initials = (name || '').split(' ').map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'U';
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#f3f4f6' /><text x='50%' y='50%' font-family='Arial' font-size='48' fill='#0f172a' text-anchor='middle' dominant-baseline='central'>${initials}</text></svg>`;
	return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function avatarUrlFor(user) {
	if (!user) return '';
	if (user.photoUrl) {
		if (user.photoUrl.startsWith('http')) return user.photoUrl;
		return API_BASE + (user.photoUrl.startsWith('/') ? user.photoUrl : ('/' + user.photoUrl));
	}
	return svgAvatarDataUrl(user && user.username ? user.username : '');
}
function attachAvatarFallback(imgEl, user) {
	if (!imgEl) return;
	imgEl.onerror = () => { imgEl.src = svgAvatarDataUrl(user && user.username ? user.username : ''); };
}
if (headerAvatar) headerAvatar.onerror = () => { headerAvatar.src = svgAvatarDataUrl(''); };
if (authAvatar) authAvatar.onerror = () => { authAvatar.src = svgAvatarDataUrl(''); };

async function populateUserSelect(list) {
	users = list || [];
	if (!authUserSelect) return;
	authUserSelect.innerHTML = '';
	const empty = document.createElement('option');
	empty.value = '';
	empty.textContent = 'Seleccionar usuario';
	authUserSelect.appendChild(empty);
	users.forEach(u => {
		const opt = document.createElement('option');
		opt.value = u._id || u.id;
		opt.textContent = u.username;
		authUserSelect.appendChild(opt);
	});
	const saved = localStorage.getItem('currentUserId');
	if (saved) {
		authUserSelect.value = saved;
		const sel = users.find(x => (x._id || x.id) == saved);
		if (sel) {
			if (authAvatar) authAvatar.src = avatarUrlFor(sel);
			updateHeaderUser(sel);
		}
	}
}

async function loadUsersAndPopulate() {
	const list = await fetchUsers();
	await populateUserSelect(list);
	try {
		const saved = localStorage.getItem('currentUserId');
		if (saved) {
			const sel = list.find(u => (u._id || u.id) == saved);
			if (sel) {
				if (authAvatar) { authAvatar.src = avatarUrlFor(sel); attachAvatarFallback(authAvatar, sel); }
				updateHeaderUser(sel);
				attachAvatarFallback(headerAvatar, sel);
			}
		}
	} catch(e){ console.warn('loadUsersAndPopulate post actions', e); }
}

function updateHeaderUser(user) {
	try {
		if (headerAvatar) {
			headerAvatar.src = user && user.photoUrl ? avatarUrlFor(user) : svgAvatarDataUrl(user && user.username ? user.username : '');
			headerAvatar.style.display = user ? 'inline-block' : 'none';
		}
		// Mostrar/ocultar control de cambiar foto en header (solo el lápiz)
		try {
			const btn = document.getElementById('change-photo-btn');
			// mantener el input siempre oculto; solo mostrar el lápiz cuando hay usuario
			if (btn) btn.style.display = user ? 'inline-block' : 'none';
		} catch(e){}
		const nameEl = document.getElementById('header-username');
		if (nameEl) {
			if (user) { nameEl.textContent = user.username; nameEl.style.display = 'block'; }
			else { nameEl.textContent = ''; nameEl.style.display = 'none'; }
		}
	} catch(e){ console.warn(e); }
}

// pequeño alias para compatibilidad (usado en parts previas/anteriores)
function setHeaderAvatar(user) {
	try { updateHeaderUser(user); } catch(e){ console.warn('setHeaderAvatar', e); }
}

// TRANSACTIONS / SCHEDULED CRUD
async function createScheduled() {
	const current = getCurrentUser();
	const description = (schedDesc && schedDesc.value || '').trim();
	const amount = Number(schedAmount && schedAmount.value);
	const frequency = schedFreq && schedFreq.value;
	const nextDue = schedNextDue && schedNextDue.value;
	const endDate = schedEndDate && schedEndDate.value || null;
	if (!description || !amount || !frequency || !nextDue) return alert('Completa los campos requeridos');
	const payload = {
		description, amount, frequency, nextDue,
		endDate, category: 'Programado',
		userId: current ? (current._id || current.id) : null,
		username: current ? current.username : null,
		type: 'expense'
	};
	try {
		const res = await fetch(`${API_BASE}/api/scheduled`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const err = await res.json().catch(()=>({error:'error'}));
			return alert('Error al crear programado: ' + (err && err.error ? err.error : ''));
		}
		await loadScheduledAndRender();
		if (scheduledForm) scheduledForm.reset();
	} catch (e) {
		alert('Error al crear programado');
	}
}

async function payScheduled(id) {
	if (!confirm('Confirmar pago programado?')) return;
	try {
		const res = await fetch(`${API_BASE}/api/scheduled/${id}/pay`, { method: 'POST' });
		if (!res.ok) {
			const err = await res.json().catch(()=>({error:'error'}));
			return alert('Error al marcar pagado: ' + (err && err.error ? err.error : ''));
		}
		await loadScheduledAndRender();
	} catch (e) {
		alert('Error al marcar pagado');
	}
}

async function deleteScheduled(id) {
	if (!confirm('Eliminar pago programado?')) return;
	try {
		const res = await fetch(`${API_BASE}/api/scheduled/${id}`, { method: 'DELETE' });
		if (res.ok) {
			scheduledPayments = scheduledPayments.filter(s => (s._id || s.id) !== id);
			renderScheduledList();
		}
	} catch(e) {
		console.warn('deleteScheduled error', e);
	}
}

async function loadScheduledAndRender() {
	scheduledPayments = await fetchScheduled();
	renderScheduledList();
}

// basic wallet helpers
function updateWalletUI(w) {
	try {
		if (!w) return;
		if (weeklySalaryEl) weeklySalaryEl.textContent = formatMoney((w.weeklySalary || 0));
		if (weeklyInput) weeklyInput.value = (typeof w.weeklySalary !== 'undefined') ? w.weeklySalary : '';
		if (typeof w.balance !== 'undefined' && balanceEl) balanceEl.textContent = formatMoney(w.balance);
	} catch(e){ console.warn('updateWalletUI', e); }
}

async function submitForm(e) {
	if (e && e.preventDefault) e.preventDefault();
	const current = getCurrentUser();
	const payload = {
		description: descEl ? descEl.value.trim() : '',
		amount: Number(amountEl ? amountEl.value : 0),
		type: typeEl ? typeEl.value : 'expense',
		category: categoryEl ? categoryEl.value || 'General' : 'General',
		userId: current ? (current._id || current.id) : null,
		username: current ? current.username : null
	};
	if (!payload.description || !payload.amount || !payload.type) return;
	try {
		await fetch(`${API_BASE}/api/transactions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (form) form.reset();
	} catch (e) {
		console.warn('submitForm error', e);
	}
}

async function deleteTransaction(id) {
	try {
		const res = await fetch(`${API_BASE}/api/transactions/${id}`, { method: 'DELETE' });
		if (res.ok) {
			transactions = transactions.filter(t => (t._id || t.id) !== id);
			renderList();
		}
	} catch (e) { console.warn('deleteTransaction', e); }
}

// Push & ServiceWorker helpers (únicos)
function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - base64String.length % 4) % 4);
	const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
}
async function getVapidPublicKey() {
	try {
		const res = await fetch(`${API_BASE}/api/push/vapidPublicKey`);
		if (!res.ok) return null;
		const data = await res.json();
		return data && data.key ? data.key : null;
	} catch (e) { console.warn('getVapidPublicKey error', e); return null; }
}
async function registerServiceWorkerAndGetRegistration() {
	if (!('serviceWorker' in navigator)) return null;
	try {
		if (location && (location.protocol === 'file:' || location.origin === 'null')) {
			console.warn('Skipping ServiceWorker registration: unsupported protocol/origin', location.protocol, location.origin);
			return null;
		}
	} catch (e) { console.warn('Could not determine location safely for SW registration check', e); }
	try {
		const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
		console.log('ServiceWorker registrado', reg);
		return reg;
	} catch (err) {
		console.warn('No se pudo registrar SW', err);
		return null;
	}
}

async function sendSubscriptionToServer(subscription, userId) {
	try {
		await fetch(`${API_BASE}/api/push/subscribe`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ subscription, userId })
		});
	} catch (e) { console.warn('sendSubscriptionToServer error', e); }
}
async function removeSubscriptionFromServer(endpoint) {
	try {
		await fetch(`${API_BASE}/api/push/unsubscribe`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint })
		});
	} catch (e) { console.warn('removeSubscriptionFromServer error', e); }
}

async function subscribeForPush(userId) {
	if (!('PushManager' in window) || !('serviceWorker' in navigator)) return null;
	const perm = await Notification.requestPermission();
	if (perm !== 'granted') return null;
	swRegistrationForPush = swRegistrationForPush || await registerServiceWorkerAndGetRegistration();
	if (!swRegistrationForPush) return null;
	const vapidKey = await getVapidPublicKey();
	if (!vapidKey) return null;
	try {
		const sub = await swRegistrationForPush.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(vapidKey)
		});
		await sendSubscriptionToServer(sub, userId);
		return sub;
	} catch (err) { console.warn('No se pudo suscribir para push', err); return null; }
}

async function unsubscribePushLocalAndServer() {
	try {
		swRegistrationForPush = swRegistrationForPush || await navigator.serviceWorker.getRegistration();
		if (!swRegistrationForPush) return;
		const sub = await swRegistrationForPush.pushManager.getSubscription();
		if (!sub) return;
		await sub.unsubscribe();
		await removeSubscriptionFromServer(sub.endpoint);
	} catch (e) { console.warn('unsubscribePush error', e); }
}

// polling fallback
function startPolling() {
	if (pollIntervalId) return;
	pollIntervalId = setInterval(async ()=> {
		try {
			transactions = await fetchTransactions();
			renderList();
			const w = await fetchWallet();
			updateWalletUI(w);
			scheduledPayments = await fetchScheduled();
			renderScheduledList();
		} catch(e){ console.warn('poll error', e); }
	}, 10000);
}
function stopPolling() {
	if (!pollIntervalId) return;
	clearInterval(pollIntervalId);
	pollIntervalId = null;
}

// notifications UI helper
function showAlert(type='info', title='', message='', opts={}) {
	try {
		const container = document.getElementById('alerts-container');
		if (!container) { if (message) alert(title ? (title + '\n' + message) : message); return; }
		const el = document.createElement('div');
		el.className = `alert ${type}`;
		el.innerHTML = `<div class="icon">${type==='warn'?'⚠️':type==='danger'?'❌':type==='success'?'✅':'ℹ️'}</div><div class="body"><strong>${title}</strong><div style="margin-top:4px">${message}</div></div>`;
		container.appendChild(el);
		const timeout = opts && typeof opts.timeout === 'number' ? opts.timeout : 4000;
		if (timeout > 0) setTimeout(()=> { el.style.animation = 'alert-out 300ms forwards'; setTimeout(()=> el.remove(), 320); }, timeout);
	} catch(e){ console.warn('showAlert', e); }
}

// Socket client loader and handlers
async function loadSocketClient() {
	if (window.io) return;
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = `${API_BASE}/socket.io/socket.io.js`;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('No se pudo cargar socket.io desde el servidor remoto'));
		document.head.appendChild(s);
	});
}

async function initAfterAuth() {
	transactions = await fetchTransactions();
	renderList();
	const w = await fetchWallet();
	updateWalletUI(w);
	await loadScheduledAndRender();

	try {
		await loadSocketClient();
		if (!socket && window.io) socket = io(API_BASE);
		if (!socket) { startPolling(); return; }
		socket.on('connect', () => { stopPolling(); });
		socket.on('connect_error', () => startPolling());
		socket.on('error', () => startPolling());

		socket.on('transaction:created', tx => {
			if (!tx || !tx._id) return;
			transactions = transactions.filter(t => t._id !== tx._id);
			transactions.unshift(tx);
			renderList();
		});
		socket.on('transaction:deleted', data => {
			if (!data || !data.id) return;
			transactions = transactions.filter(t => (t._id || t.id) !== data.id);
			renderList();
		});
		socket.on('transactions:cleared', () => {
			transactions = [];
			renderList();
		});
		socket.on('wallet:updated', w2 => updateWalletUI(w2));
		socket.on('user:registered', user => {
			users = users.filter(u => (u._id || u.id) !== (user._id || user.id));
			users.push(user);
			populateUserSelect(users);
		});
		socket.on('scheduled:due', s => { try { handleScheduledDue(s); } catch(e){ console.warn(e); } });
		socket.on('scheduled:created', s => {
			scheduledPayments = scheduledPayments.filter(x => (x._id || x.id) !== (s._id || s.id));
			scheduledPayments.push(s);
			renderScheduledList();
		});
		socket.on('scheduled:paid', data => { try { handleScheduledPaid(data); } catch(e){ console.warn(e);} });
		socket.on('scheduled:deleted', d => {
			if (!d || !d.id) return;
			scheduledPayments = scheduledPayments.filter(x => (x._id || x.id) !== d.id);
			renderScheduledList();
		});
	} catch (err) {
		console.warn('No se pudo conectar a Socket.IO, usando polling:', err && err.message);
		startPolling();
	}
}

// scheduled handlers
function handleScheduledDue(s) {
	const amt = s.amount ? formatMoney(Number(s.amount)) : '';
	const when = s.nextDue ? new Date(s.nextDue).toLocaleString() : 'hoy';
	showAlert('warn', 'Pago por vencer', `${s.description} ${amt} — ${when}`, { timeout: 0 });
	try { notifyUser('Pago programado por vencer', `${s.description}: ${amt} — ${when}`); } catch(e){ console.warn(e); }
}
function handleScheduledPaid(obj) {
	const s = obj && obj.scheduled ? obj.scheduled : (obj || {});
	const amt = obj && obj.transaction ? formatMoney(Number(obj.transaction.amount)) : (s.amount ? formatMoney(Number(s.amount)) : '');
	showAlert('success', 'Pago registrado', `${s.description} ${amt}`, { timeout:5000 });
	try { notifyUser('Pago registrado', `${s.description} · ${amt}`); } catch(e){ console.warn(e); }
	if (headerAvatar) { headerAvatar.classList.add('success-burst'); setTimeout(()=> headerAvatar.classList.remove('success-burst'), 1000); }
}

// simple upload helper used on register
async function uploadProfilePhotoForUser(userId, dataUrl) {
	if (!userId || !dataUrl) return null;
	try {
		const res = await fetch(`${API_BASE}/api/users/${userId}/photo`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ dataUrl })
		});
		if (!res.ok) throw new Error('upload failed');
		const updated = await res.json();
		try {
			const cached = JSON.parse(localStorage.getItem('cachedUsers') || '[]');
			const mapped = cached.map(u => ((u._id == updated._id) ? updated : u));
			localStorage.setItem('cachedUsers', JSON.stringify(mapped));
		} catch(e){}
		await loadUsersAndPopulate();
		return updated;
	} catch (e) {
		console.warn('uploadProfilePhotoForUser', e);
		return null;
	}
}

// Restaurar/añadir handlers faltantes: login/logout y control de fotos + abrir chat
function handleLogin() {
	try {
		const current = getCurrentUser();
		if (!current) return alert('Selecciona un usuario');
		localStorage.setItem('currentUserId', current._id || current.id);
		updateHeaderUser(current);
		hideAuthOverlay();
		// iniciar lógica post-login (sockets, carga de datos)
		initAfterAuth();
	} catch (e) { console.warn('handleLogin error', e); }
}

function handleLogout() {
	try {
		localStorage.removeItem('currentUserId');
		updateHeaderUser(null);
		transactions = [];
		renderList();
		updateWalletUI({ balance: 0, weeklySalary: 0 });
		try { if (socket) socket.close(); } catch(e){}
		socket = null;
		showAuthOverlay();
	} catch (e) { console.warn('handleLogout error', e); }
}

// botón de cambiar foto en header -> abrir input file
const changePhotoBtn = document.getElementById('change-photo-btn');
const changePhotoInput = document.getElementById('change-photo-input');
if (changePhotoBtn && changePhotoInput) {
	changePhotoBtn.addEventListener('click', () => {
		const cur = getCurrentUser();
		if (!cur) return alert('Selecciona un usuario antes de cambiar la foto');
		changePhotoInput.click();
	});
	changePhotoInput.addEventListener('change', async () => {
		const cur = getCurrentUser();
		if (!cur) return alert('Selecciona un usuario antes de subir la foto');
		const file = changePhotoInput.files && changePhotoInput.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = async () => {
			try {
				await uploadProfilePhotoForUser(cur._id || cur.id, reader.result);
				// recargar usuarios y header
				await loadUsersAndPopulate();
				const refreshed = users.find(u => (u._id || u.id) == (cur._id || cur.id));
				if (refreshed) updateHeaderUser(refreshed);
				alert('Foto actualizada');
			} catch (e) { console.warn('changePhoto upload error', e); alert('No se pudo actualizar la foto'); }
			finally { changePhotoInput.value = ''; }
		};
		reader.readAsDataURL(file);
	});
}

// auth overlay: botón "Subir" que abre input y carga para usuario seleccionado
const authUploadBtn = document.getElementById('auth-upload-photo');
if (authUploadBtn && authPhotoInput) {
	authUploadBtn.addEventListener('click', () => {
		// si hay un usuario seleccionado, abrir input para elegir archivo
		const sel = getCurrentUser();
		if (!sel) return alert('Selecciona un usuario en el selector antes de subir foto');
		authPhotoInput.click();
	});
}
// Si se cambia el archivo en el overlay, subirlo para el usuario seleccionado
if (authPhotoInput) {
	authPhotoInput.addEventListener('change', async () => {
		const sel = getCurrentUser();
		if (!sel) return alert('Selecciona un usuario antes de subir la foto');
		const file = authPhotoInput.files && authPhotoInput.files[0];
		if (!file) return;
		const r = new FileReader();
		r.onload = async () => {
			try {
				await uploadProfilePhotoForUser(sel._id || sel.id, r.result);
				await loadUsersAndPopulate();
				alert('Foto subida correctamente');
			} catch (e) { console.warn('auth photo upload error', e); alert('Error al subir foto'); }
			finally { authPhotoInput.value = ''; }
		};
		r.readAsDataURL(file);
	});
}

// botón del asistente (abrir chat embebido) - muestra widget y notifica al chat.js
const openChatBtn = document.getElementById('open-chat-btn');
if (openChatBtn) {
	openChatBtn.addEventListener('click', () => {
		const widget = document.getElementById('chat-widget');
		if (!widget) return;
		const isVisible = widget.style.display && widget.style.display !== 'none';
		if (isVisible) {
			widget.style.display = 'none';
			try { window.dispatchEvent(new Event('chat-closed')); } catch(e){}
		} else {
			widget.style.display = 'block';
			try { window.dispatchEvent(new Event('chat-opened')); } catch(e){}
		}
	});
}

// Asegurar que login/logout UI button enlazan a las funciones restauradas
if (loginBtn) {
	// quitar listeners previos defensivamente y agregar el correcto
	try { loginBtn.removeEventListener('click', handleLogin); } catch(e){}
	loginBtn.addEventListener('click', handleLogin);
}
if (logoutBtn) {
	try { logoutBtn.removeEventListener('click', handleLogout); } catch(e){}
	logoutBtn.addEventListener('click', handleLogout);
}

// Wire up UI handlers
if (form) form.addEventListener('submit', submitForm);
if (createScheduledBtn) createScheduledBtn.addEventListener('click', e => { e && e.preventDefault(); createScheduled(); });
if (authRegisterBtn) authRegisterBtn.addEventListener('click', registerUser);
if (logoutBtn) logoutBtn.addEventListener('click', () => { localStorage.removeItem('currentUserId'); handleLogout(); });
if (authUserSelect) authUserSelect.addEventListener('change', () => {
	const sel = getCurrentUser();
	if (sel && authAvatar) { authAvatar.src = avatarUrlFor(sel); attachAvatarFallback(authAvatar, sel); }
});

// SW init and auto push after login (single, consistent implementation)
if (enablePushBtn) {
	enablePushBtn.addEventListener('click', async () => {
		const current = getCurrentUser();
		const uid = current ? (current._id || current.id) : null;
		const sub = await subscribeForPush(uid);
		if (sub) alert('Notificaciones activadas'); else alert('No se pudieron activar las notificaciones (revisa permisos)');
	});
}
if (loginBtn) {
	const original = () => { // preserve original behavior: call handleLogin then auto push logic
		handleLogin();
		(async () => {
			try {
				if (Notification && Notification.permission === 'granted') {
					const current = getCurrentUser();
					if (current) {
						swRegistrationForPush = swRegistrationForPush || await registerServiceWorkerAndGetRegistration();
						if (swRegistrationForPush) {
							const existing = await swRegistrationForPush.pushManager.getSubscription();
							if (!existing) await subscribeForPush(current._id || current.id);
							else await sendSubscriptionToServer(existing, current._id || current.id);
						}
					}
				}
			} catch(e){ console.warn('auto push after login', e); }
		})();
	};
	// replace click listener to include auto-push behavior
	loginBtn.addEventListener('click', original);
}

// initial bootstrap
(async function bootstrap(){
	try {
		await loadUsersAndPopulate();
		const cur = localStorage.getItem('currentUserId');
		if (!cur) showAuthOverlay(); else { if (authUserSelect) authUserSelect.value = cur; hideAuthOverlay(); await initAfterAuth(); }
		// register SW to enable prompt later
		try { swRegistrationForPush = swRegistrationForPush || await registerServiceWorkerAndGetRegistration(); } catch(e){ console.warn('SW init', e); }
	} catch(e){ console.warn('bootstrap error', e); }
})();
(async function bootstrap(){
	try {
		await loadUsersAndPopulate();
		const cur = localStorage.getItem('currentUserId');
		if (!cur) showAuthOverlay(); else { if (authUserSelect) authUserSelect.value = cur; hideAuthOverlay(); await initAfterAuth(); }
		// register SW to enable prompt later
		try { swRegistrationForPush = swRegistrationForPush || await registerServiceWorkerAndGetRegistration(); } catch(e){ console.warn('SW init', e); }
	} catch(e){ console.warn('bootstrap error', e); }
})();
