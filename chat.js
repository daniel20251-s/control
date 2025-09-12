(function () {
	// use the API base exposed by app.js if available, otherwise fallback
	const API_BASE = (window && window.API_BASE) ? window.API_BASE : 'https://dimeloweb.onrender.com';

const chatWindow = document.getElementById('chat-window');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatUserAvatar = document.getElementById('chat-user-avatar');
const chatUsernameEl = document.getElementById('chat-username');
const chatPhotoInput = document.getElementById('chat-photo-input');
const chatUploadBtn = document.getElementById('chat-upload-photo'); // may be null in embedded, we use chatPhotoInput

function appendMessage(text, cls='bot') {
	const d = document.createElement('div');
	d.className = `msg ${cls}`;
	d.innerHTML = `<div>${text}</div>`;
	if (chatWindow) {
		chatWindow.appendChild(d);
		chatWindow.scrollTop = chatWindow.scrollHeight;
	}
}

// util: format money simple
function formatMoney(n){ return Number(n).toLocaleString('es-ES',{style:'currency',currency:'EUR'}); }

// formateador MXN para mensajes de antojos (el resto sigue usando formatMoney)
function formatMoneyMX(n){ return Number(n).toLocaleString('es-MX',{style:'currency',currency:'MXN'}); }

// ayudas AI simples (mismos datos que app.js usa)
async function getTransactions() {
	try {
		const res = await fetch(`${API_BASE}/api/transactions`);
		if (!res.ok) throw new Error('no api');
		const data = await res.json();
		localStorage.setItem('cachedTransactions', JSON.stringify(data));
		return data;
	} catch (e) {
		const cached = localStorage.getItem('cachedTransactions');
		return cached ? JSON.parse(cached) : [];
	}
}
async function getWallet() {
	try {
		const res = await fetch(`${API_BASE}/api/wallet`);
		if (!res.ok) throw new Error('no api');
		const data = await res.json();
		localStorage.setItem('cachedWallet', JSON.stringify(data));
		return data;
	} catch (e) {
		const cached = localStorage.getItem('cachedWallet');
		return cached ? JSON.parse(cached) : { balance:0, weeklySalary:0 };
	}
}

// NUEVO: obtener lista de usuarios con caché
async function getUsers() {
	try {
		const res = await fetch(`${API_BASE}/api/users`);
		if (!res.ok) throw new Error('no api');
		const data = await res.json();
		localStorage.setItem('cachedUsers', JSON.stringify(data));
		return data;
	} catch (e) {
		const cached = localStorage.getItem('cachedUsers');
		return cached ? JSON.parse(cached) : [];
	}
}

// NUEVO: obtener pagos programados con caché
async function getScheduled() {
	try {
		const res = await fetch(`${API_BASE}/api/scheduled`);
		if (!res.ok) throw new Error('no api');
		const data = await res.json();
		localStorage.setItem('cachedScheduled', JSON.stringify(data));
		return data;
	} catch (e) {
		const cached = localStorage.getItem('cachedScheduled');
		return cached ? JSON.parse(cached) : [];
	}
}

function computeFromTxs(txs){
	let income=0, expense=0;
	(txs || []).forEach(t=> { if (t.type==='income') income += Number(t.amount); else expense += Number(t.amount); });
	return { income, expense, balance: income-expense };
}

function avgDailyNet(txs, days=30){
	if (!txs || !txs.length) return 0;
	const now = Date.now();
	const cutoff = now - days*24*60*60*1000;
	let total=0, earliest=now, latest=0, count=0;
	txs.forEach(t=>{
		const ts = new Date(t.createdAt).getTime();
		if (ts >= cutoff) {
			total += (t.type==='income'? Number(t.amount) : -Number(t.amount));
			count++; if (ts<earliest) earliest=ts; if (ts>latest) latest=ts;
		}
	});
	if (count < 3) {
		// fallback global
		let allNet=0, min=Infinity, max=0;
		txs.forEach(t=>{
			const ts = new Date(t.createdAt).getTime();
			allNet += (t.type==='income'? Number(t.amount) : -Number(t.amount));
			if (ts<min) min=ts; if (ts>max) max=ts;
		});
		if (!isFinite(min)) return 0;
		const spanDays = Math.max(1, Math.ceil((max-min)/(24*60*60*1000)));
		return allNet/spanDays;
	}
	const spanDays = Math.max(1, Math.ceil((latest-earliest)/(24*60*60*1000)));
	return total/spanDays;
}

// reemplazo / ampliación del catálogo y funciones de sugerencia
const CRAVINGS_CATALOG = [
	{ name: 'agua', display: 'Agua 1.5L', price: 15 },
	{ name: 'coca litro', display: 'Coca 1L', price: 19 },
	{ name: 'papas', display: 'Papas', price: 18 },
	{ name: 'tamales', display: 'Tamales', price: 22 },
	{ name: 'pan', display: 'Pan', price: 9 },
	{ name: 'bieonico', display: 'Bieónico', price: 50 },
	{ name: 'taco', display: 'Taco', price: 15 },
	{ name: 'orden de tacos del chino', display: 'Orden de tacos (chino)', price: 140 },
	{ name: 'quesa birria', display: 'Quesa birria', price: 29 },
	{ name: 'tacos del comprade', display: 'Tacos del compadre', price: 22 },
	{ name: 'palomitas', display: 'Palomitas', price: 19 },
	{ name: 'chesquese', display: 'Chesquese', price: 45 }
];

// encontrar items mencionados en un texto (coincidencia simple)
function findItemsInText(txt) {
	if (!txt) return [];
	const norm = txt.toLowerCase();
	return CRAVINGS_CATALOG.filter(i => {
		// buscar por nombre clave o por display
		return norm.includes(i.name) || norm.includes(i.display.toLowerCase());
	});
}

// persistencia simple de antojos favoritos
function saveCraving(name) {
	try {
		const list = JSON.parse(localStorage.getItem('cravingsList') || '[]');
		if (!list.find(x => x.name === name)) {
			const item = CRAVINGS_CATALOG.find(c => c.name === name) || { name, display: name, price: 0 };
			list.push(item);
			localStorage.setItem('cravingsList', JSON.stringify(list));
			return true;
		}
		return false;
	} catch(e){ return false; }
}
function listCravings() {
	try {
		return JSON.parse(localStorage.getItem('cravingsList') || '[]');
	} catch(e){ return []; }
}

// recomendar si comprar items ahora y cómo afecta la semana
async function recommendForItems(items) {
	// items: array of catalog entries
	const total = items.reduce((s,i)=> s + Number(i.price || 0), 0);
	const wallet = await getWallet();
	const txs = await getTransactionsFilteredForUser();
	const avgDay = avgDailyNet(txs, 30); // net per day (ingreso - gasto)
	const weeklyNet = avgDay * 7;
	const bal = (wallet && typeof wallet.balance !== 'undefined') ? Number(wallet.balance) : computeFromTxs(txs).balance;
	const after = bal - total;
	let msg = `Total de ${items.length} artículo(s): ${formatMoneyMX(total)}. Balance antes: ${formatMoneyMX(bal)}. Balance después: ${formatMoneyMX(after)}.`;
	// reglas simples
	if (after < 0) {
		msg += ' No es recomendable comprar: te quedarías en saldo negativo.';
	} else {
		// indicar impacto semanal
		if (weeklyNet < -10) {
			// si estás gastando neto por semana, calcular días que cubre
			const daysLeft = Math.max(0, Math.floor(after / (-avgDay || 1)));
			msg += ` Al ritmo actual (${formatMoneyMX(avgDay)}/día) te quedarían aproximadamente ${daysLeft} día(s) hasta agotar el balance.`;
			if (after < bal * 0.1) msg += ' Advertencia: esto reduce tu colchón por debajo del 10%.';
		} else {
			msg += ' Parece razonable; tu flujo semanal es positivo o neutro.';
		}
	}
	// si hay items más baratos sugerir alternativas
	const cheapest = items.map(it => {
		const alt = CRAVINGS_CATALOG.filter(c=> c.price < it.price).sort((a,b)=>a.price-b.price)[0];
		return { item: it, alt };
	}).filter(x=>x.alt);
	if (cheapest.length) {
		msg += '<br/>Alternativas más baratas que podrías considerar: ';
		msg += cheapest.map(x => `${x.alt.display} (${formatMoneyMX(x.alt.price)}) en lugar de ${x.item.display}`).join('; ');
	}
	return msg;
}

// mejorar pickSuggestion para usar el catálogo y devolver objetos con MXN
function pickSuggestion(budget) {
	const aff = CRAVINGS_CATALOG.filter(i => i.price <= budget);
	if (!aff.length) return null;
	return aff[Math.floor(Math.random()*aff.length)];
}

let currentUserId = localStorage.getItem('currentUserId') || null;
let currentUser = null;

function avatarUrlForChat(user) {
	if (!user) return '';
	if (user.photoUrl) {
		if (user.photoUrl.startsWith('http')) return user.photoUrl;
		return API_BASE + (user.photoUrl.startsWith('/') ? user.photoUrl : ('/' + user.photoUrl));
	}
	const name = user && user.username ? user.username : 'U';
	const initials = name.split(' ').map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#e6eefc' /><text x='50%' y='50%' font-family='Arial' font-size='48' fill='#0f172a' text-anchor='middle' dominant-baseline='central'>${initials}</text></svg>`;
	return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

async function loadCurrentUserInfo() {
	try {
		currentUserId = localStorage.getItem('currentUserId') || null;
		// usar getUsers() (que maneja caché) en lugar de lógica ad-hoc
		const list = await getUsers();
		if (list && currentUserId) currentUser = list.find(u => (u._id || u.id) == currentUserId) || null;
		else currentUser = null;
		// actualizar UI (si existen elementos)
		if (chatUsernameEl) chatUsernameEl.textContent = currentUser ? (currentUser.username || 'Usuario') : 'Invitado';
		if (chatUserAvatar && currentUser) chatUserAvatar.src = avatarUrlForChat(currentUser);
		if (chatUserAvatar && !currentUser) chatUserAvatar.src = '';
	} catch (err) {
		console.warn('loadCurrentUserInfo', err);
	}
}

// reaccionar cuando cambia la sesión en otra pestaña/ventana
window.addEventListener('storage', (e) => {
	if (e.key === 'currentUserId') {
		currentUserId = localStorage.getItem('currentUserId') || null;
		loadCurrentUserInfo();
	}
});

// cuando se abra el chat desde index, actualizar info
window.addEventListener('chat-opened', () => {
	loadCurrentUserInfo();
});

// adaptar uploadChatPhoto si input existe
async function uploadChatPhoto() {
	if (!currentUserId) return alert('No estás identificado. Selecciona un usuario en la app principal.');
	const file = chatPhotoInput && chatPhotoInput.files && chatPhotoInput.files[0];
	if (!file) return alert('Selecciona una imagen');
	const reader = new FileReader();
	reader.onload = async () => {
		const dataUrl = reader.result;
		try {
			const res = await fetch(`${API_BASE}/api/users/${currentUserId}/photo`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dataUrl })
			});
			if (!res.ok) {
				const err = await res.json().catch(()=>({error:'error'}));
				return alert('Error al subir foto: ' + (err && err.error ? err.error : ''));
			}
			const updated = await res.json();
			// actualizar UI y caché
			await loadCurrentUserInfo();
			try {
				const cached = JSON.parse(localStorage.getItem('cachedUsers') || '[]');
				const mapped = cached.map(u => (u._id == updated._id ? updated : u));
				localStorage.setItem('cachedUsers', JSON.stringify(mapped));
			} catch(e){}
			alert('Foto actualizada');
			if (chatPhotoInput) chatPhotoInput.value = '';
			// notify main app to refresh header avatar
			try { localStorage.setItem('cachedUsers-updated-at', Date.now().toString()); } catch(e){}
		} catch (err) {
			console.error('uploadChatPhoto error', err);
			alert('Error al subir la foto');
		}
	};
	reader.readAsDataURL(file);
}

if (chatPhotoInput) {
	chatPhotoInput.addEventListener('change', uploadChatPhoto);
}

// adaptar getTransactions/getWallet para filtrar por usuario si existe el currentUserId
async function getTransactionsFilteredForUser() {
	const txs = await getTransactions();
	if (!currentUserId) return txs;
	return (txs || []).filter(t => {
		const uid = t.userId != null ? String(t.userId) : null;
		if (uid) return uid == currentUserId;
		if (t.username && currentUser) return t.username === currentUser.username;
		return false;
	});
}

// NUEVO: detectar saludo (varios formatos) - ampliado con modismos mexicanos
function isGreeting(text) {
	if (!text) return false;
	// incluir saludos y modismos comunes en México: qué onda, órale, qué pex, qué hubo, q onda, etc.
	return /\b(?:hola|holi|hi|hello|hey|oye|buen[oa]s|buenos|qué tal|que tal|qué onda|que onda|q onda|órale|orale|qué pex|q pex|qué hubo|que hubo|qué pasó|que pasó|qué show|qué rollo|qué onda güey|güey)\b/i.test(text);
}

// NUEVO: generar saludo variado y personalizar con el nombre si existe
function greetUser() {
	const name = (currentUser && currentUser.username) ? currentUser.username : (currentUserId ? 'Usuario' : 'Invitado');
	const variants = [
		`¡Hola, ${name}! ¿En qué puedo ayudarte hoy?`,
		`¡Hey ${name}! ¿Quieres consultar tu saldo o ver tus últimas transacciones?`,
		`¡Hola ${name}! Puedo mostrarte tu balance, pagos programados o darte una sugerencia.`,
		`¡Buenas, ${name}! Dime: "saldo", "sugerencia" o "pagos programados".`,
		`¡Qué tal ${name}! ¿Te gustaría un resumen rápido de tus gastos?`
	];
	// esperar solo la respuesta sobre Lee
	try {
		localStorage.removeItem('awaitingMood');
		localStorage.setItem('awaitingMoodLee', '1');
	} catch(e){}
	// preguntar únicamente por Lee
	return variants[Math.floor(Math.random() * variants.length)] + ' ¿Cómo está Lee?';
}

// Añadir helpers faltantes: listar programados filtrados por usuario y resumen por categoría
async function listScheduledForCurrentUser() {
	try {
		const list = await getScheduled();
		if (!currentUserId) return list;
		return (list || []).filter(s => {
			const uid = s.userId != null ? String(s.userId) : null;
			if (uid) return uid == currentUserId;
			if (s.username && currentUser) return s.username === currentUser.username;
			return false;
		});
	} catch (e) {
		console.warn('listScheduledForCurrentUser', e);
		return [];
	}
}

function summarizeByCategory(txs) {
	const out = {};
	(txs || []).forEach(t => {
		const k = t.category || 'General';
		const val = (t.type === 'income') ? Number(t.amount) : -Number(t.amount);
		out[k] = (out[k] || 0) + val;
	});
	return out;
}

// emparejamientos y tamaños por porción
const PAIRINGS = {
	'taco': ['coca litro', 'agua'],
	'orden de tacos (chino)': ['coca litro', 'agua'],
	'quesa birria': ['coca litro', 'agua'],
	'papas': ['agua', 'coca litro'],
	'palomitas': ['agua', 'coca litro'],
	'tamales': ['agua'],
	'pan': ['agua'],
	'chesquese': ['agua', 'coca litro']
};
const DEFAULT_TACOS_PER_PERSON = 3;

// devuelve el número de tacos por persona (o valor por defecto)
function tacosPerPerson() {
	// podríamos leer preferencia guardada en localStorage en futuro
	return Number(localStorage.getItem('tacosPerPerson')) || DEFAULT_TACOS_PER_PERSON;
}

// obtiene emparejamientos para un item (por display o name)
function getPairingsForItem(item) {
	if (!item) return [];
	const key = (item.display || item.name || '').toLowerCase();
	// buscar coincidencias en PAIRINGS por clave parcial
	for (const k of Object.keys(PAIRINGS)) {
		if (key.includes(k)) return PAIRINGS[k];
	}
	return [];
}

// Sugiere qué comer hoy: elige items asequibles y detalla por qué y acompañamientos
async function suggestMealToday() {
	const wallet = await getWallet();
	const txs = await getTransactionsFilteredForUser();
	const bal = (wallet && typeof wallet.balance !== 'undefined') ? Number(wallet.balance) : computeFromTxs(txs).balance;
	// presupuesto: 5% del balance o mínimo 20 MXN para sugerir algo
	const budget = Math.max(20, bal * 0.05);
	// buscar opciones dentro de presupuesto (o cerca para combos)
	const affordable = CRAVINGS_CATALOG.filter(i => i.price <= budget);
	// buscar tacos como opción especial (suele necesitar acompañamiento)
	const tacos = CRAVINGS_CATALOG.find(i => i.name.includes('taco') && !i.name.includes('orden'));
	// construir mensaje
	if ((!affordable || !affordable.length) && tacos && tacos.price <= bal) {
		// si no hay pequeños pero sí tacos que caben en el balance
		const tp = tacosPerPerson();
		const totalTacosPrice = tacos.price * tp;
		const pair = getPairingsForItem(tacos).map(p => CRAVINGS_CATALOG.find(c=>c.name===p || c.display.toLowerCase().includes(p))).filter(Boolean);
		let m = `Hoy podrías comer ${tp} ${tacos.display}(s) (${formatMoneyMX(totalTacosPrice)}). Es más barato si compartes o pides menos tacos.`;
		if (pair.length) m += ` Recomendado acompañamiento: ${pair.map(p=>p.display + ' (' + formatMoneyMX(p.price) + ')').join(' o ')} — recuerda que eso aumenta el total.`;
		if (bal - totalTacosPrice < 0) m += ' Atención: esto dejaría tu balance negativo.';
		return m;
	}
	if (affordable && affordable.length) {
		// elegir una opción barata y una alternativa (más barata) y mencionar por qué
		const pick = affordable[Math.floor(Math.random()*affordable.length)];
		// ver emparejamientos
		const pairNames = getPairingsForItem(pick);
		const pairs = pairNames.map(pn => CRAVINGS_CATALOG.find(c => c.name === pn || c.display.toLowerCase().includes(pn))).filter(Boolean);
		let msg = `Puedes comprarte hoy: ${pick.display} por ${formatMoneyMX(pick.price)}. Es una buena opción porque cabe en tu presupuesto estimado (${formatMoneyMX(budget)}).`;
		if (pairs.length) msg += ` Suele acompañarse con ${pairs.map(p=>p.display).join(' o ')}, que costaría ${pairs.map(p=>formatMoneyMX(p.price)).join(' / ')}.`;
		// si hay una alternativa aún más barata, mencionarla
		const cheaper = CRAVINGS_CATALOG.filter(c => c.price < pick.price).sort((a,b)=>a.price-b.price)[0];
		if (cheaper) msg += ` Si quieres ahorrar más, considera ${cheaper.display} por ${formatMoneyMX(cheaper.price)}.`;
		// sugerencia sobre tacos si el usuario quiere
		if (tacos) msg += ` Si te apetecen tacos, una referencia: ${tacosPerPerson()} tacos por persona (aprox.), cada taco ${formatMoneyMX(tacos.price)}.`;
		return msg;
	}
	// fallback usando catalog completo y balance
	const sensible = CRAVINGS_CATALOG.filter(i=> i.price <= bal).slice(0,3).map(i=> `${i.display} (${formatMoneyMX(i.price)})`);
	if (!sensible.length) return `No veo opciones económicas hoy con tu balance (${formatMoneyMX(bal)}). Considera esperar a recibir ingresos.`;
	return `Con tu balance (${formatMoneyMX(bal)}) podrías elegir entre: ${sensible.join(', ')}.`;
}

// Genera una lista de antojos variada para la semana con cantidades y costo total
async function generateWeeklyCravingsPlan() {
	const saved = listCravings();
	const source = (saved && saved.length) ? saved : CRAVINGS_CATALOG;
	// mezclar y escoger 7 elementos variando, permitiendo repeticiones razonables
	const shuffled = source.slice().sort(() => 0.5 - Math.random());
	const plan = [];
	let cost = 0;
	for (let d=0; d<7; d++) {
		const item = shuffled[d % shuffled.length];
		// determinar cantidad: tacos => tacosPerPerson, otros => 1 unidad
		let qty = 1;
		if ((item.display || item.name).toLowerCase().includes('taco') && !((item.display||'').toLowerCase().includes('orden'))) {
			qty = tacosPerPerson();
		}
		// si es "orden" se considera 1 orden (para compartir)
		plan.push({ day: d+1, item: item.display, qty, unitPrice: item.price, total: item.price * qty, pairings: getPairingsForItem(item) });
		cost += item.price * qty;
	}
	// construir mensaje con detalle y consejos de emparejamiento
	let msg = `Plan de antojos para 7 días (costo total aproximado: ${formatMoneyMX(cost)}):<br/>`;
	msg += plan.map(p => `Día ${p.day}: ${p.qty} x ${p.item} — ${formatMoneyMX(p.total)}` + (p.pairings && p.pairings.length ? ` (acompañado con: ${p.pairings.join(', ')})` : '')).join('<br/>');
	msg += `<br/>Consejo: si quieres reducir el total, intercambia opciones por alternativas más baratas como ${CRAVINGS_CATALOG.sort((a,b)=>a.price-b.price)[0].display}.`;
	return msg;
}

// NUEVO: funciones para pagos programados: próximos, vencidos y total semanal
async function getUpcomingPayments(days = 30) {
	try {
		const list = await listScheduledForCurrentUser();
		const now = Date.now();
		const end = now + days * 24 * 60 * 60 * 1000;
		return (list || []).filter(s => {
			if (!s.nextDue) return false;
			const ts = new Date(s.nextDue).getTime();
			return ts >= now && ts <= end;
		});
	} catch (e) {
		return [];
	}
}
async function getOverduePayments() {
	try {
		const list = await listScheduledForCurrentUser();
		const now = Date.now();
		return (list || []).filter(s => s.nextDue && new Date(s.nextDue).getTime() < now);
	} catch (e) {
		return [];
	}
}
async function totalPaymentsThisWeek() {
	try {
		const list = await listScheduledForCurrentUser();
		const now = new Date();
		const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); // hoy 00:00
		const end = start + 7 * 24 * 60 * 60 * 1000;
		const items = (list || []).filter(s => s.nextDue && new Date(s.nextDue).getTime() >= start && new Date(s.nextDue).getTime() < end);
		const total = items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
		return { items, total };
	} catch (e) {
		return { items: [], total: 0 };
	}
}

// procesamiento simple de consultas del usuario
async function handleQuery(q){
	const txtRaw = (q || '').toLowerCase();
	const txt = txtRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

	try {
		// RESPUESTA ESPERADA SOBRE LEE (si el bot preguntó "¿Cómo está Lee?")
		try {
			const awaitingLee = localStorage.getItem('awaitingMoodLee');
			if (awaitingLee === '1') {
				localStorage.removeItem('awaitingMoodLee');
				// detectar ánimo respecto a Lee
				const positive = /\b(bien|mejor|tranquil|tranquila|alegr|content|positivo|se recupera|está bien)\b/i;
				const negative = /\b(mal|peor|enfermo|llora|triste|fiebr|vomit|inquiet|preocup|urgent|no esta bien|no está bien)\b/i;
				if (positive.test(txtRaw)) {
					appendMessage('Me alegra que Lee esté bien. Si quieres puedo ayudarte a planear gastos para el bebé o guardar un antojo relacionado.', 'bot');
				} else if (negative.test(txtRaw)) {
					appendMessage('Siento que Lee esté mal. Puedo sugerir revisar tus pagos y presupuesto para gastos del bebé o recomendar acciones para ahorrar.', 'bot');
				} else {
					appendMessage('Gracias por contarme sobre Lee. Si quieres, dime si necesitas revisar pagos o crear un plan semanal para gastos del bebé.', 'bot');
				}
				return;
			}
		} catch(e){ /* no bloquear si localStorage falla */ }

		// si el usuario pregunta directamente "¿cómo está Lee?" iniciamos el mismo flujo
		if (/(como esta lee|cómo esta lee|como esta lee\?|cómo está lee|como esta lee es nuestro bebe|como esta lee es nuestro bebe)/.test(txt)) {
			try { localStorage.setItem('awaitingMoodLee', '1'); } catch(e){}
			appendMessage('¿Cómo está Lee exactamente? Cuéntame si está bien o si tiene algún síntoma.', 'bot');
			return;
		}

		// NUEVO: próximos pagos (30 días por defecto) y variantes
		if (/(proximos pagos|próximos pagos|pagos próximos|pagos proximos|que pagos proximos|cuales son mis proximos pagos)/.test(txt)) {
			const ups = await getUpcomingPayments(30);
			if (!ups || !ups.length) { appendMessage('No hay pagos programados en los próximos 30 días.', 'bot'); return; }
			const lines = ups.slice(0,20).map(p => `${p.description || p.title || 'Pago'} — ${formatMoney(Number(p.amount)||0)} — fecha: ${p.nextDue ? new Date(p.nextDue).toLocaleDateString() : '—'}`).join('<br/>');
			appendMessage(`Próximos pagos (30 días):<br/>${lines}`, 'bot');
			return;
		}

		// NUEVO: pagos vencidos / atrasados
		if (/(pagos vencidos|pagos atrasados|vencidos|atrasados|pagos pendientes)/.test(txt)) {
			const ovs = await getOverduePayments();
			if (!ovs || !ovs.length) { appendMessage('No tienes pagos vencidos.', 'bot'); return; }
			const lines = ovs.slice(0,20).map(p => `${p.description || p.title || 'Pago'} — ${formatMoney(Number(p.amount)||0)} — venció: ${p.nextDue ? new Date(p.nextDue).toLocaleDateString() : '—'}`).join('<br/>');
			appendMessage(`Pagos vencidos:<br/>${lines}`, 'bot');
			return;
		}

		// NUEVO: total de pagos de la semana
		if (/(total de pagos (de )?la semana|pagos de la semana|total pagos semana|cuanto debo esta semana)/.test(txt)) {
			const res = await totalPaymentsThisWeek();
			if (!res.items || !res.items.length) { appendMessage('No hay pagos programados para esta semana.', 'bot'); return; }
			const lines = res.items.map(p => `${p.description || p.title || 'Pago'} — ${formatMoney(Number(p.amount)||0)} — ${p.nextDue ? new Date(p.nextDue).toLocaleDateString() : '—'}`).join('<br/>');
			appendMessage(`Total de pagos esta semana: ${formatMoney(res.total)}.<br/>Detalle:<br/>${lines}`, 'bot');
			return;
		}

		// saludos y small-talk básicos
		if (isGreeting(txt)) {
			appendMessage(greetUser(), 'bot');
			return;
		}

		// SALDO / dinero (acepta modismos MX)
		if (/(saldo|balance|cuanto.*queda|cuanto me queda|cuánto.*queda|cuanto tengo|varos?|lana|plata|pisto|dinero restante|dinero que me queda)/.test(txt)) {
			const wallet = await getWallet();
			const txs = await getTransactionsFilteredForUser();
			const stats = computeFromTxs(txs);
			const bal = (wallet && typeof wallet.balance !== 'undefined') ? wallet.balance : stats.balance;
			const avg = avgDailyNet(txs, 30);
			let daysLeft = null;
			if (avg < -0.001) daysLeft = Math.max(0, Math.floor(bal / (-avg)));
			let who = currentUser ? ` (${currentUser.username})` : '';
			let msg = `Tu balance actual estimado${who}: ${formatMoney(bal)}.`;
			if (daysLeft !== null) msg += ` Al ritmo actual (${formatMoney(avg)}/día) quedaría aproximadamente ${daysLeft} día(s).`;
			appendMessage(msg, 'bot');
			return;
		}

		// SUELDO / QUINCENA / NÓMINA
		if (/(sueldo|sueldo semanal|pago semanal|mi sueldo|quincena|nomina|nómina|mi quincena|mi nomina)/.test(txt)) {
			const wallet = await getWallet();
			const weekly = (wallet && typeof wallet.weeklySalary !== 'undefined') ? Number(wallet.weeklySalary) : 0;
			if (weekly > 0) {
				appendMessage(`Tu sueldo semanal configurado es ${formatMoney(weekly)}. Puedes pulsar 'Pagar sueldo' en la app para añadirlo al balance.`, 'bot');
			} else {
				appendMessage('No tienes un sueldo semanal configurado. Puedes configurarlo en la sección de Sueldo semanal.', 'bot');
			}
			return;
		}

		// SUGERENCIAS / ANTOJOS avanzadas
		if (/(suger(en|e)cia|gusto|capricho|comprar|antojo|guardar antojo|mis antojos|lista de antojos)/.test(txt)) {
			// guardar antojo: "guardar antojo <nombre>"
			const saveMatch = txt.match(/guardar antojo(?:s?)(?:\s+de|\s+)|guardar(?:\s+)?(?:antojo|capricho)\s+(.*)/);
			if (/mis antojos|lista de antojos/.test(txt)) {
				const saved = listCravings();
				if (!saved || !saved.length) {
					appendMessage('No tienes antojos guardados. Puedes guardar con "guardar antojo <nombre>".', 'bot');
				} else {
					const lines = saved.map(s => `${s.display || s.name} — ${formatMoneyMX(s.price || 0)}`).join('<br/>');
					appendMessage(`Tus antojos guardados:<br/>${lines}`, 'bot');
				}
				return;
			}
			// intentar parsear items mencionados en la consulta
			const found = findItemsInText(txt);
			if (saveMatch && saveMatch[1]) {
				const name = saveMatch[1].trim();
				const key = name.toLowerCase();
				const catalogMatch = CRAVINGS_CATALOG.find(c => c.name === key || c.display.toLowerCase().includes(key));
				const saveName = (catalogMatch && catalogMatch.name) ? catalogMatch.name : key;
				const ok = saveCraving(saveName);
				appendMessage(ok ? `Antojo "${saveName}" guardado.` : `El antojo "${saveName}" ya está en tu lista.`, 'bot');
				return;
			}
			// si el usuario menciona items explícitos, evaluar compra
			if (found && found.length) {
				const msg = await recommendForItems(found);
				appendMessage(msg, 'bot');
				return;
			}
			// fallback: sugerir según presupuesto (5% del balance como antes)
			const wallet = await getWallet();
			const txs = await getTransactionsFilteredForUser();
			const stats = computeFromTxs(txs);
			const bal = (wallet && typeof wallet.balance !== 'undefined') ? wallet.balance : stats.balance;
			const budget = Math.max(0, bal * 0.05);
			const sugg = pickSuggestion(budget);
			let who = currentUser ? `, ${currentUser.username}` : '';
			if (sugg) appendMessage(`Sugerencia${who}: podrías permitirte ${sugg.display} por ${formatMoneyMX(sugg.price)}. Balance: ${formatMoneyMX(bal)}.`, 'bot');
			else appendMessage('Ahora mismo no veo margen para un capricho pequeño. Revisa tu presupuesto.', 'bot');
			return;
		}

		// PAGOS PROGRAMADOS
		if (/(pagos programad|pagos programados|programados|programado|abonos programados|pagos automaticos|pagos automáticos)/.test(txt)) {
			const list = await listScheduledForCurrentUser();
			if (!list || list.length === 0) {
				appendMessage(`No se encontraron pagos programados${currentUser ? ' para ' + currentUser.username : ''}.`, 'bot');
				return;
			}
			const lines = list.slice(0,10).map(s => `${s.description} — ${formatMoney(s.amount)} — próxima: ${s.nextDue ? new Date(s.nextDue).toLocaleDateString() : '—'}`).join('<br/>');
			appendMessage(`Pagos programados${currentUser ? ' para ' + currentUser.username : ''}:<br/>${lines}`, 'bot');
			return;
		}

		// TRANSACCIONES / ÚLTIMAS
		if (/(transaccion|gasto|ingreso|ultim|ultimos|ultimas|últim|últimos|últimas)/.test(txt)) {
			const txs = await getTransactionsFilteredForUser();
			if (!txs || txs.length === 0) { appendMessage('No tengo transacciones en cache ni desde el servidor para este usuario.', 'bot'); return; }
			const last = (txs.slice(0,5)).map(t => `- ${t.description} ${formatMoney(t.amount)} (${t.type})`).join('<br/>');
			appendMessage(`Últimas transacciones para ${currentUser ? currentUser.username : 'este usuario'}:<br/>${last}`, 'bot');
			return;
		}

		// RESUMEN POR CATEGORIA
		if (/(resumen por categoria|resumen por categoría|por categoria|por categoría|categorias|categorías|gastos por categoria)/.test(txt)) {
			const txs = await getTransactionsFilteredForUser();
			if (!txs || txs.length === 0) { appendMessage('No hay transacciones para resumir.', 'bot'); return; }
			const summary = summarizeByCategory(txs);
			const lines = Object.keys(summary).map(k => `${k}: ${formatMoney(summary[k])}`).join('<br/>');
			appendMessage(`Resumen por categoría${currentUser ? ' para ' + currentUser.username : ''}:<br/>${lines}`, 'bot');
			return;
		}

		// Fallback
		appendMessage('Puedo ayudar con: saldo, sueldo semanal, pagos programados, sugerencias, transacciones recientes o resumen por categoría. Prueba: "¿cuánto me queda?", "mis pagos programados", "mi sueldo" o "resumen por categoría".', 'bot');
	} catch (err) {
		console.error('handleQuery error', err);
		appendMessage('Lo siento, ocurrió un error procesando tu consulta.', 'bot');
	}
}

// gestión de conversación y memoria local
function saveChatHistory(entry) {
	try {
		const list = JSON.parse(localStorage.getItem('chatHistory') || '[]');
		list.push({ ...entry, time: Date.now() });
		localStorage.setItem('chatHistory', JSON.stringify(list.slice(-200))); // mantener últimos 200
	} catch(e){}
}
function loadChatHistory() {
	try {
		return JSON.parse(localStorage.getItem('chatHistory') || '[]');
	} catch(e){ return []; }
}

function renderHistory() {
	const hist = loadChatHistory();
	if (!hist.length) {
		appendMessage('Bienvenido al asistente. Puedes preguntar por tu saldo, obtener sugerencias o ver transacciones.', 'bot');
		return;
	}
	hist.forEach(h => appendMessage(h.text, h.role === 'user' ? 'user' : 'bot'));
}

// NUEVO: limpiar conversación (localStorage + DOM)
function clearChatConversation() {
	try { localStorage.removeItem('chatHistory'); } catch(e){}
	if (chatWindow) {
		chatWindow.innerHTML = '';
		// opcional: mensaje de bienvenida tras limpiar
		appendMessage('Conversación borrada. Bienvenido al asistente.', 'bot');
	}
}

// NUEVO: escuchar evento personalizado para cierre del chat
window.addEventListener('chat-closed', () => {
	clearChatConversation();
});

// NUEVO: vincular botones de cierre comunes para limpiar la conversación al cerrar
function bindChatCloseButtons() {
	try {
		// incluir múltiples selectores comunes para cierres de UI
		const selectors = ['#chat-close', '#chat-close-btn', '.chat-close', '[data-chat-close]', '#close-chat', '.close', '.modal-close'];
		const els = Array.from(document.querySelectorAll(selectors.join(',')));
		els.forEach(el => {
			el.addEventListener('click', (ev) => {
				// ocultar widget si existe
				const widget = document.getElementById('chat-widget');
				if (widget) widget.style.display = 'none';
				// limpiar y notificar
				clearChatConversation();
				try { window.dispatchEvent(new Event('chat-closed')); } catch(e){}
			});
		});
		// escuchar eventos personalizados que otras partes de la app puedan despachar
		window.addEventListener('close-chat', () => {
			const widget = document.getElementById('chat-widget');
			if (widget) widget.style.display = 'none';
			clearChatConversation();
			try { window.dispatchEvent(new Event('chat-closed')); } catch(e){}
		});
		window.addEventListener('hide-chat', () => {
			const widget = document.getElementById('chat-widget');
			if (widget) widget.style.display = 'none';
			clearChatConversation();
			try { window.dispatchEvent(new Event('chat-closed')); } catch(e){}
		});
		// limpiar al cerrar o recargar la página
		window.addEventListener('beforeunload', () => {
			try { clearChatConversation(); } catch(e){}
		});
	} catch(e){}
}

// evento submit del chat
if (chatForm) {
	chatForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		const v = chatInput && chatInput.value && chatInput.value.trim();
		if (!v) return;
		appendMessage(v, 'user');
		saveChatHistory({ role:'user', text:v });
		if (chatInput) chatInput.value = '';
		await handleQuery(v);
		// guardar última respuesta automática
		if (chatWindow) {
			const nodes = Array.from(chatWindow.querySelectorAll('.msg.bot'));
			if (nodes.length) {
				const last = nodes[nodes.length - 1].innerText;
				saveChatHistory({ role:'bot', text: last });
			}
		}
	});
}

// INYECCIÓN DE ESTILOS: alinea mensajes user a la derecha y bot a la izquierda, colores distintos
function injectChatStyles() {
	if (document.getElementById('chat-injected-styles')) return;
	const css = `
#chat-window .msg { display:flex; margin:8px 6px; }
#chat-window .msg.bot { justify-content:flex-start; }
#chat-window .msg.user { justify-content:flex-end; }
#chat-window .msg > div { max-width:72%; padding:10px 14px; border-radius:16px; font-size:0.95rem; line-height:1.3; word-wrap:break-word; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
#chat-window .msg.bot > div { background:#eef2ff; color:#07203a; border-bottom-left-radius:4px; text-align:left; }
#chat-window .msg.user > div { background:#0b84ff; color:#fff; border-bottom-right-radius:4px; text-align:right; }
#chat-window { padding-bottom:12px; }
/* enlaces mantienen contraste */
#chat-window .msg > div a { color:inherit; text-decoration:underline; }
`;
	const s = document.createElement('style');
	s.id = 'chat-injected-styles';
	s.appendChild(document.createTextNode(css));
	document.head.appendChild(s);
}

// inicialización limpia: cargar usuario, aplicar estilos y renderizar historial (si existe chatWindow)
(async function initChat() {
	await loadCurrentUserInfo();
	injectChatStyles();
	// vincular botones de cierre si existen
	bindChatCloseButtons();
	if (chatWindow) renderHistory();
})();

})(); // end IIFE

