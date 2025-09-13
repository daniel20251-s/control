(function(){
	const API_BASE = window.API_BASE || 'https://dimeloweb.onrender.com';
	const $id = s => document.getElementById(s);
	const $ = s => document.querySelector(s);

	// Usar el widget ya presente en index.html
	const widget = $id('chat-widget');
	const bubbleId = 'chat-bubble';
	let bubble = $id(bubbleId);
	const contactsCol = $id('chat-contacts');
	const chatWindow = $id('chat-window');
	const chatForm = $id('chat-form');
	const chatInput = $id('chat-input');
	const chatCloseBtn = $id('chat-close-btn');
	const openChatBtn = $id('open-chat-btn');
	const chatUserAvatar = $id('chat-user-avatar');
	const chatUsernameLabel = $id('chat-username');
	const chatRecipientSelect = $id('chat-recipient-select'); // nuevo selector claro para elegir destinatario

	let socket = null;
	let selectedContactId = null;
	let unreadCount = 0;

	function createBubbleIfNeeded() {
		if (bubble) return bubble;
		bubble = document.createElement('button');
		bubble.id = bubbleId;
		bubble.type = 'button';
		bubble.title = 'Abrir chat';
		bubble.className = 'chat-bubble';
		bubble.innerHTML = `<span class="bubble-avatar">💬</span><span class="bubble-badge" style="display:none">0</span>`;
		document.body.appendChild(bubble);
		return bubble;
	}

	function showWidget() {
		if (widget) widget.style.display = 'block';
		if (bubble) bubble.style.display = 'none';
		unreadCount = 0;
		updateBubbleBadge();
		// focus input
		setTimeout(()=> chatInput && chatInput.focus(), 120);
	}

	function hideWidget() {
		if (widget) widget.style.display = 'none';
		if (bubble) bubble.style.display = 'flex';
	}

	function updateBubbleBadge() {
		const badge = bubble && bubble.querySelector('.bubble-badge');
		if (!badge) return;
		if (unreadCount > 0) { badge.style.display = 'inline-block'; badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount); }
		else badge.style.display = 'none';
	}

	function getCurrentUserId() {
		return localStorage.getItem('currentUserId') || '';
	}
	function setCurrentUserId(id) {
		if (id) localStorage.setItem('currentUserId', id); else localStorage.removeItem('currentUserId');
	}

	async function fetchUsers() {
		try {
			const r = await fetch(`${API_BASE}/api/users`);
			if (!r.ok) throw new Error('users fetch failed');
			return await r.json();
		} catch(e){ console.warn(e); return []; }
	}

	function optionToContactElem(user) {
		const el = document.createElement('button');
		el.type = 'button';
		el.className = 'chat-contact';
		el.dataset.id = user._id || user.id;
		el.textContent = user.username || 'User';
		return el;
	}

	async function populateContacts() {
		if (contactsCol) contactsCol.innerHTML = '';
		if (chatRecipientSelect) chatRecipientSelect.innerHTML = '<option value="">Seleccionar contacto</option>';
		const list = await fetchUsers();
		list.forEach(u => {
			// llenar columna (si existe)
			if (contactsCol) {
				const btn = optionToContactElem(u);
				btn.addEventListener('click', async () => {
					selectedContactId = btn.dataset.id;
					Array.from(contactsCol.children).forEach(c => c.classList.remove('active'));
					btn.classList.add('active');
					if (chatRecipientSelect) chatRecipientSelect.value = selectedContactId;
					await loadMessages(getCurrentUserId(), selectedContactId);
					if (chatUsernameLabel) chatUsernameLabel.textContent = u.username || 'Contacto';
				});
				contactsCol.appendChild(btn);
			}
			// llenar select de destinatarios
			if (chatRecipientSelect) {
				const opt = document.createElement('option');
				opt.value = u._id || u.id;
				opt.textContent = u.username || 'Contacto';
				chatRecipientSelect.appendChild(opt);
			}
		});
		// manejar selección desde el select (más claro para el usuario)
		if (chatRecipientSelect) {
			chatRecipientSelect.addEventListener('change', async () => {
				selectedContactId = chatRecipientSelect.value || null;
				// si hay columna de contactos, sincronizar selección visual
				if (contactsCol) {
					Array.from(contactsCol.children).forEach(c => c.classList.toggle('active', c.dataset.id === selectedContactId));
				}
				if (selectedContactId) await loadMessages(getCurrentUserId(), selectedContactId);
			});
		}
		// setear primer contacto por defecto si existe (para mayor usabilidad)
		if (!selectedContactId && chatRecipientSelect && chatRecipientSelect.options.length > 1) {
			chatRecipientSelect.selectedIndex = 1;
			selectedContactId = chatRecipientSelect.value;
			if (selectedContactId) await loadMessages(getCurrentUserId(), selectedContactId);
		}
		// si hay current user, set avatar/name en header/burbuja
		const curId = getCurrentUserId();
		if (curId) {
			const me = list.find(x => (x._id||x.id) == curId);
			if (me) {
				if (chatUserAvatar) chatUserAvatar.textContent = (me.username||'U').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
				if (chatUsernameLabel) chatUsernameLabel.textContent = me.username || 'Yo';
			}
		}
	}

	function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

	function renderMessages(list, currentUserId) {
		if (!chatWindow) return;
		chatWindow.innerHTML = '';
		list.forEach(m => {
			const div = document.createElement('div');
			div.className = 'msg ' + (String(m.fromUserId) === String(currentUserId) ? 'user' : 'bot');
			div.innerHTML = `<div>${escapeHtml(m.text)}</div><small>${new Date(m.createdAt).toLocaleString()}</small>`;
			chatWindow.appendChild(div);
		});
		chatWindow.scrollTop = chatWindow.scrollHeight;
	}

	async function loadMessages(user1, user2) {
		if (!user1 || !user2) { if (chatWindow) chatWindow.innerHTML = '<div class="note">Selecciona un contacto para ver el historial</div>'; return; }
		try {
			const r = await fetch(`${API_BASE}/api/messages?user1=${encodeURIComponent(user1)}&user2=${encodeURIComponent(user2)}`);
			if (!r.ok) throw new Error('no history');
			const list = await r.json();
			renderMessages(list, user1);
		} catch (e) {
			console.warn(e);
			if (chatWindow) chatWindow.innerHTML = '<div class="note">No se pudo cargar el historial</div>';
		}
	}

	async function ensureSocketAndJoin() {
		try {
			// cargar cliente si es necesario
			if (!window.io) {
				await new Promise((resolve, reject) => {
					const s = document.createElement('script');
					s.src = `${API_BASE}/socket.io/socket.io.js`;
					s.onload = () => resolve();
					s.onerror = () => reject(new Error('no socket.io'));
					document.head.appendChild(s);
				});
			}
			if (!window.io) return;
			if (!socket) socket = io(API_BASE);
			const cur = getCurrentUserId();
			if (cur && socket) {
				socket.emit('user:join', String(cur));
				socket.off('message:created');
				socket.on('message:created', m => {
					// si la conversación abierta corresponde, mostrar; si no, aumentar unread
					const curUser = getCurrentUserId();
					if (selectedContactId && curUser && ((m.fromUserId === curUser && m.toUserId === selectedContactId) || (m.fromUserId === selectedContactId && m.toUserId === curUser))) {
						// append to chatWindow
						renderMessages((Array.from(chatWindow.querySelectorAll('.msg')) || []).concat([m]), curUser);
						// mejor usar reload parcial: pedir nuevamente historial para consistencia
						loadMessages(curUser, selectedContactId);
					} else {
						// si el mensaje es para mi, y widget oculto, incrementar unread
						if (m.toUserId === curUser && (!widget || widget.style.display === 'none')) {
							unreadCount++;
							updateBubbleBadge();
						}
					}
				});
			}
		} catch(e) { console.warn('socket fail', e); }
	}

	// enviar mensaje
	async function sendMessage(from, to, text) {
		try {
			const r = await fetch(`${API_BASE}/api/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fromUserId: from, toUserId: to, text })
			});
			if (!r.ok) throw new Error('send failed');
			const saved = await r.json();
			// recargar historial brevemente
			setTimeout(()=> loadMessages(from, to), 150);
			return saved;
		} catch (e) {
			console.warn('send msg error', e);
			throw e;
		}
	}

	// eventos UI
	createBubbleIfNeeded();
	if (bubble) {
		bubble.addEventListener('click', () => { showWidget(); });
		bubble.style.display = widget && widget.style.display === 'block' ? 'none' : 'flex';
	}
	if (openChatBtn) openChatBtn.addEventListener('click', () => { showWidget(); });
	if (chatCloseBtn) chatCloseBtn.addEventListener('click', () => { hideWidget(); });

	if (chatForm) {
		chatForm.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const from = getCurrentUserId();
			// preferir selector claro del destinatario, si existe; si no, usar selectedContactId (compatibilidad)
			const to = (chatRecipientSelect && chatRecipientSelect.value) ? chatRecipientSelect.value : selectedContactId;
			const txt = (chatInput && chatInput.value || '').trim();
			if (!from) return alert('Selecciona un usuario en el login para enviar mensajes');
			if (!to) return alert('Selecciona un contacto');
			if (!txt) return;
			try {
				await sendMessage(from, to, txt);
				if (chatInput) chatInput.value = '';
			} catch(e){ alert('No se pudo enviar el mensaje'); }
		});
	}

	// bootstrap inicial
	(async function init(){
		// asegurar estado inicial: widget oculto, bubble visible
		if (widget) widget.style.display = 'none';
		if (bubble) bubble.style.display = 'flex';
		await populateContacts();
		await ensureSocketAndJoin();

		// si hay contacto seleccionado en el DOM (por ejemplo marcado), cargar
		// si existe el select de destinatarios, seleccionar el primero disponible (ya manejado en populateContacts)
		if (chatRecipientSelect && chatRecipientSelect.value) {
			selectedContactId = chatRecipientSelect.value;
		}
	})();
})();
