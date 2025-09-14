(function(){
	const API_BASE = window.API_BASE || 'https://dimeloweb.onrender.com';
	const $id = s => document.getElementById(s);

	// DOM
	const widget = $id('chat-widget');
	const contactsCol = $id('chat-contacts');
	const chatWindow = $id('chat-window');
	const chatForm = $id('chat-form');
	const chatInput = $id('chat-input');
	const chatCloseBtn = $id('chat-close-btn');
	const openChatBtn = $id('open-chat-btn'); // en index es un <a>
	const chatUserAvatar = $id('chat-user-avatar');
	const chatUsernameLabel = $id('chat-username');
	const chatRecipientSelect = $id('chat-recipient-select');

	// estado
	let socket = null;
	let selectedContactId = null;
	let contactPresence = {}; // { userId: { online, lastSeen } }
	let typingIndicator = false;
	let lastTypingTimeout = null;
	let typingState = false;
	let sentMessages = {}; // { messageId: { delivered, seen } }

	// util
	function getCurrentUserId(){ return localStorage.getItem('currentUserId') || ''; }
	function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

	// UI
	function showWidget(){ if (widget) widget.style.display = 'flex'; if (chatInput) setTimeout(()=>chatInput.focus(),120); }
	function hideWidget(){ if (widget) widget.style.display = 'none'; }

	// Fetch users
	async function fetchUsers(){
		try {
			const r = await fetch(`${API_BASE}/api/users`);
			if (!r.ok) throw new Error('users fetch failed');
			return await r.json();
		} catch(e){ console.warn(e); return []; }
	}

	// populate contacts/select
	async function populateContacts(){
		if (contactsCol) contactsCol.innerHTML = '';
		if (chatRecipientSelect) chatRecipientSelect.innerHTML = '<option value="">Seleccionar contacto</option>';
		const list = await fetchUsers();
		list.forEach(u => {
			if (contactsCol) {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'chat-contact';
				btn.dataset.id = u._id || u.id;
				btn.textContent = u.username || 'User';
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
			if (chatRecipientSelect) {
				const opt = document.createElement('option');
				opt.value = u._id || u.id;
				opt.textContent = u.username || 'Contacto';
				chatRecipientSelect.appendChild(opt);
			}
		});
		// select change
		if (chatRecipientSelect) {
			chatRecipientSelect.addEventListener('change', async () => {
				selectedContactId = chatRecipientSelect.value || null;
				if (contactsCol) Array.from(contactsCol.children).forEach(c => c.classList.toggle('active', c.dataset.id === selectedContactId));
				if (selectedContactId) await loadMessages(getCurrentUserId(), selectedContactId);
				updateChatHeaderPresence();
			});
			// choose first by default
			if (!selectedContactId && chatRecipientSelect.options.length > 1) {
				chatRecipientSelect.selectedIndex = 1;
				selectedContactId = chatRecipientSelect.value;
				if (selectedContactId) await loadMessages(getCurrentUserId(), selectedContactId);
			}
		}
		// set header avatar/name for current user if present
		const curId = getCurrentUserId();
		if (curId && chatUserAvatar) {
			const me = (await fetchUsers()).find(x => (x._id||x.id) == curId);
			if (me) chatUserAvatar.textContent = (me.username||'U').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
		}
	}

	// render messages (modificado para incluir data-id y botón eliminar para mensajes propios)
	function renderMessages(list, currentUserId){
		if (!chatWindow) return;
		chatWindow.innerHTML = '';
		list.forEach(m => {
			const isUser = String(m.fromUserId) === String(currentUserId);
			let statusHtml = '';
			if (isUser) {
				const delivered = sentMessages[m._id]?.delivered || false;
				const seen = sentMessages[m._id]?.seen || false;
				if (seen) statusHtml = `<span class="msg-seen msg-seen-green" title="Visto">&#10003;&#10003;</span>`;
				else if (delivered) statusHtml = `<span class="msg-seen" title="Entregado">&#10003;&#10003;</span>`;
				else statusHtml = `<span class="msg-sent" title="Enviado">&#10003;</span>`;
			}
			const div = document.createElement('div');
			div.className = 'msg ' + (isUser ? 'user' : 'bot');
			div.dataset.id = m._id;
			// contenido principal: separar timestamp y estado para poder actualizarlos luego
			div.innerHTML = `<div class="msg-body">${escapeHtml(m.text)}</div><small><span class="msg-timestamp">${new Date(m.createdAt).toLocaleString()}</span> <span class="msg-status">${statusHtml}</span></small>`;
			// si es mensaje propio, añadir botón eliminar
			if (isUser) {
				const delBtn = document.createElement('button');
				delBtn.type = 'button';
				delBtn.className = 'msg-delete';
				delBtn.title = 'Eliminar mensaje';
				delBtn.style.marginLeft = '8px';
				delBtn.style.background = 'transparent';
				delBtn.style.border = 'none';
				delBtn.style.cursor = 'pointer';
				delBtn.textContent = '🗑️';
				delBtn.addEventListener('click', async (ev) => {
					ev.stopPropagation();
					if (!confirm('¿Eliminar este mensaje?')) return;
					try {
						const r = await fetch(`${API_BASE}/api/messages/${encodeURIComponent(m._id)}`, { method: 'DELETE' });
						if (!r.ok) {
							const body = await r.json().catch(()=>({}));
							throw new Error(body && body.error ? body.error : 'delete failed');
						}
						// remover de la UI y del estado local
						removeMessageFromUI(m._id);
						delete sentMessages[m._id];
					} catch (err) {
						console.warn('delete message failed', err);
						alert('No se pudo eliminar el mensaje.');
					}
				});
				// colocar botón al inicio del contenedor para visibilidad
				div.querySelector('.msg-body').appendChild(delBtn);
			}
			chatWindow.appendChild(div);
		});
		chatWindow.scrollTop = chatWindow.scrollHeight;
	}

	// utilidad: actualizar el status visual (entregado/visto) de un mensaje específico en el DOM
	function updateSentMessageStatusInUI(messageId) {
		if (!chatWindow || !messageId) return;
		const el = chatWindow.querySelector(`[data-id="${messageId}"]`);
		if (!el) return;
		const statusContainer = el.querySelector('.msg-status');
		if (!statusContainer) return;
		const st = sentMessages[messageId] || {};
		let statusHtml = '';
		if (st.seen) statusHtml = `<span class="msg-seen msg-seen-green" title="Visto">&#10003;&#10003;</span>`;
		else if (st.delivered) statusHtml = `<span class="msg-seen" title="Entregado">&#10003;&#10003;</span>`;
		else statusHtml = `<span class="msg-sent" title="Enviado">&#10003;</span>`;
		statusContainer.innerHTML = statusHtml;
	}

	// utilidad: eliminar mensaje del DOM si existe
	function removeMessageFromUI(messageId) {
		if (!chatWindow) return;
		const el = chatWindow.querySelector(`[data-id="${messageId}"]`);
		if (el) {
			el.parentNode.removeChild(el);
		}
		// limpiar estado local si aplica
		if (sentMessages[messageId]) delete sentMessages[messageId];
	}

	// load messages historical
	async function loadMessages(user1, user2){
		if (!user1 || !user2) { if (chatWindow) chatWindow.innerHTML = '<div class="note">Selecciona un contacto para ver el historial</div>'; return; }
		try {
			const r = await fetch(`${API_BASE}/api/messages?user1=${encodeURIComponent(user1)}&user2=${encodeURIComponent(user2)}`);
			if (!r.ok) throw new Error('no history');
			const list = await r.json();

			// preserve previous sentMessages state (so "seen" / delivery flags survive refresh)
			const prev = sentMessages || {};
			const nextState = {};
			list.forEach(m => {
				const isUser = String(m.fromUserId) === String(user1);
				const old = prev[m._id] || {};
				nextState[m._id] = {
					// si existía, respetar; si no, marcar entregado para mensajes propios
					delivered: (typeof old.delivered !== 'undefined') ? old.delivered : !!isUser,
					seen: !!old.seen
				};
			});
			sentMessages = nextState;

			renderMessages(list, user1);

			// mark last received as read
			const lastMsg = list.length ? list[list.length - 1] : null;
			if (lastMsg && lastMsg.toUserId === user1 && lastMsg._id && window.socket) {
				window.socket.emit('message:read', { fromUserId: lastMsg.fromUserId, toUserId: lastMsg.toUserId, messageId: lastMsg._id });
			}
		} catch(e){ console.warn(e); if (chatWindow) chatWindow.innerHTML = '<div class="note">No se pudo cargar el historial</div>'; }
	}

	// socket connect & handlers
	async function ensureSocketAndJoin(){
		try {
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
			window.socket = socket;
			const cur = getCurrentUserId();
			if (cur && socket) {
				socket.emit('user:join', String(cur));
				socket.off('message:created');
				socket.on('message:created', m => {
					const curUser = getCurrentUserId();
					if (!curUser) return;
					// if conversation open, refresh and mark delivered
					if (selectedContactId && ((m.fromUserId === curUser && m.toUserId === selectedContactId) || (m.fromUserId === selectedContactId && m.toUserId === curUser))) {
						if (String(m.fromUserId) === String(curUser) && m._id) {
							sentMessages[m._id] = sentMessages[m._id] || {};
							sentMessages[m._id].delivered = true;
							// actualizar UI si el mensaje ya está en DOM
							updateSentMessageStatusInUI(m._id);
						}
						loadMessages(curUser, selectedContactId);
					}
				});
				socket.on('presence:update', ({ userId, online, lastSeen }) => {
					contactPresence[userId] = { online, lastSeen };
					updateChatHeaderPresence();
				});
				socket.on('typing', ({ fromUserId, typing }) => {
					if (selectedContactId && fromUserId === selectedContactId) {
						typingIndicator = typing;
						updateChatHeaderPresence();
					}
				});
				socket.on('message:read', ({ fromUserId, toUserId, messageId }) => {
					const curUser = getCurrentUserId();
					// marcar seen siempre que el evento llegue (y actualizar UI si existe)
					if (messageId) {
						sentMessages[messageId] = sentMessages[messageId] || {};
						sentMessages[messageId].seen = true;
						// actualizar DOM directamente (si el mensaje está visible)
						updateSentMessageStatusInUI(messageId);
						// además, si corresponde a la conversación abierta, recargar historial para mantener consistencia
						if (curUser && toUserId === curUser && selectedContactId && fromUserId === selectedContactId) {
							loadMessages(curUser, selectedContactId);
						}
					}
				});
				// añadir listener para eliminación
				socket.off('message:deleted');
				socket.on('message:deleted', ({ messageId, fromUserId, toUserId } = {}) => {
					try {
						if (!messageId) return;
						// si estamos viendo la conversación que contenía el mensaje, removerlo
						removeMessageFromUI(messageId);
						// si era nuestro mensaje en estado enviado, limpiar flags
						if (sentMessages[messageId]) delete sentMessages[messageId];
					} catch (e) { console.warn('handle message:deleted', e); }
				});
			}
		} catch(e){ console.warn('socket fail', e); }
	}

	// header presence update
	function updateChatHeaderPresence(){
		const curContact = selectedContactId;
		const label = chatUsernameLabel;
		if (!label) return;
		// ensure state div exists
		let state = document.getElementById('chat-user-state');
		if (!state) {
			state = document.createElement('div');
			state.id = 'chat-user-state';
			state.style.fontSize = '12px';
			state.style.color = 'var(--muted)';
			label.parentNode.appendChild(state);
		}
		// contact name
		let contactName = '';
		if (chatRecipientSelect && curContact) {
			const opt = Array.from(chatRecipientSelect.options).find(o => o.value === curContact);
			if (opt) contactName = opt.textContent;
		}
		label.textContent = contactName || 'Contacto';
		label.style.color = '#111';
		// don't show presence for self
		const myId = getCurrentUserId();
		if (!curContact || curContact === myId) { state.textContent = ''; return; }
		// typing > online > lastSeen
		if (typingIndicator) {
			state.textContent = 'Escribiendo...';
			state.style.color = '#4f46e5';
		} else {
			const p = contactPresence[curContact] || {};
			if (p.online) { state.textContent = 'En línea'; state.style.color = '#10b981'; }
			else if (p.lastSeen) { state.textContent = 'Últ. vez: ' + (new Date(p.lastSeen)).toLocaleString(); state.style.color = '#888'; }
			else { state.textContent = ''; }
		}
	}

	// typing events: emit typing to server
	if (chatInput) {
		chatInput.addEventListener('input', () => {
			const cur = getCurrentUserId();
			const to = (chatRecipientSelect && chatRecipientSelect.value) ? chatRecipientSelect.value : selectedContactId;
			if (!cur || !to) return;
			if (!typingState) {
				typingState = true;
				if (window.socket) window.socket.emit('typing', { fromUserId: cur, toUserId: to, typing: true });
			}
			clearTimeout(lastTypingTimeout);
			lastTypingTimeout = setTimeout(() => {
				typingState = false;
				if (window.socket) window.socket.emit('typing', { fromUserId: cur, toUserId: to, typing: false });
			}, 1200);
		});
	}

	// submit handler para evitar reload y enviar mensaje
	if (chatForm) {
		chatForm.addEventListener('submit', async (ev) => {
			ev.preventDefault(); // evita que el form recargue la página
			const text = chatInput ? (chatInput.value || '').trim() : '';
			const from = getCurrentUserId();
			const to = (chatRecipientSelect && chatRecipientSelect.value) ? chatRecipientSelect.value : selectedContactId;
			if (!text) return; // nada que enviar
			if (!from) { alert('Debe configurar currentUserId en localStorage'); return; }
			if (!to) { alert('Selecciona un contacto'); return; }

			try {
				const r = await fetch(`${API_BASE}/api/messages`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fromUserId: from, toUserId: to, text })
				});
				if (!r.ok) {
					const body = await r.json().catch(() => ({}));
					throw new Error(body && body.error ? body.error : 'send failed');
				}
				const msg = await r.json();
				// marcar estado local y refrescar historial (el servidor emitirá 'message:created' también)
				sentMessages[msg._id] = sentMessages[msg._id] || {};
				sentMessages[msg._id].delivered = true;
				// refrescar mensajes para mostrar el enviado
				await loadMessages(from, to);
				if (chatInput) { chatInput.value = ''; chatInput.focus(); }
			} catch (err) {
				console.warn('send message failed', err);
				alert('No se pudo enviar el mensaje.');
			}
		});
	}

	// viewport / keyboard handling
	function updateVhVar(){
		try {
			const height = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
			document.documentElement.style.setProperty('--vh', (height * 0.01) + 'px');
		} catch(e){}
	}
	function onChatInputFocus(){ document.body.classList.add('keyboard-open'); setTimeout(()=>{ updateVhVar(); if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight; }, 120); }
	function onChatInputBlur(){ setTimeout(()=>{ document.body.classList.remove('keyboard-open'); updateVhVar(); }, 160); }
	try {
		updateVhVar();
		if (window.visualViewport) { window.visualViewport.addEventListener('resize', updateVhVar); window.visualViewport.addEventListener('scroll', updateVhVar); }
		window.addEventListener('resize', updateVhVar);
		window.addEventListener('orientationchange', updateVhVar);
		window.addEventListener('focusin', (ev) => { if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) onChatInputFocus(); });
		window.addEventListener('focusout', (ev) => { if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) onChatInputBlur(); });
		if (chatInput) { chatInput.addEventListener('focus', onChatInputFocus); chatInput.addEventListener('blur', onChatInputBlur); }
	} catch(e){ console.warn('viewport handlers init failed', e); }

	// init
	(async function init(){
		if (widget) widget.style.display = 'none';
		updateVhVar();
		await populateContacts();
		await ensureSocketAndJoin();
		if (chatRecipientSelect && chatRecipientSelect.value) selectedContactId = chatRecipientSelect.value;
	})();

	// handlers
	if (chatCloseBtn) chatCloseBtn.addEventListener('click', hideWidget);
	// openChatBtn is an <a> that opens standalone page; do not override.

})();
