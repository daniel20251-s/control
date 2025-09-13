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
	let lastTypingTimeout = null;
	let typingState = false;
	let lastReadMessageId = null;
	let lastDeliveredMessageId = null;
	let contactPresence = {}; // { userId: { online, lastSeen } }
	let typingIndicator = false;
	let sentMessages = {}; // { messageId: { delivered: bool, seen: bool } }

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
		list.forEach((m, idx) => {
			const isUser = String(m.fromUserId) === String(currentUserId);
			const isLast = idx === list.length - 1;
			let statusHtml = '';
			if (isUser) {
				// Estado de ticks
				const sent = true;
				const delivered = sentMessages[m._id]?.delivered || false;
				const seen = sentMessages[m._id]?.seen || false;
				if (seen) {
					statusHtml = `<span class="msg-seen msg-seen-green" title="Visto">&#10003;&#10003;</span>`;
				} else if (delivered) {
					statusHtml = `<span class="msg-seen" title="Entregado">&#10003;&#10003;</span>`;
				} else if (sent) {
					statusHtml = `<span class="msg-sent" title="Enviado">&#10003;</span>`;
				}
			}
			const div = document.createElement('div');
			div.className = 'msg ' + (isUser ? 'user' : 'bot');
			div.innerHTML = `<div>${escapeHtml(m.text)}</div><small>${new Date(m.createdAt).toLocaleString()}${statusHtml}</small>`;
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
			// Reset status
			sentMessages = {};
			list.forEach(m => {
				const isUser = String(m.fromUserId) === String(user1);
				sentMessages[m._id] = { delivered: false, seen: false };
				// Si el mensaje fue enviado por mí y el destinatario ya lo recibió (está en la lista), marcar como entregado
				if (isUser && m._id) {
					sentMessages[m._id].delivered = true;
				}
			});
			renderMessages(list, user1);
			// Marcar como leído el último mensaje recibido
			const lastMsg = list.length ? list[list.length - 1] : null;
			if (lastMsg && lastMsg.toUserId === user1 && lastMsg._id) {
				lastReadMessageId = lastMsg._id;
				if (window.socket) {
					window.socket.emit('message:read', { fromUserId: lastMsg.fromUserId, toUserId: lastMsg.toUserId, messageId: lastMsg._id });
				}
			}
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
			window.socket = socket;
			const cur = getCurrentUserId();
			if (cur && socket) {
				socket.emit('user:join', String(cur));
				socket.off('message:created');
				socket.on('message:created', m => {
					const curUser = getCurrentUserId();
					if (selectedContactId && curUser && ((m.fromUserId === curUser && m.toUserId === selectedContactId) || (m.fromUserId === selectedContactId && m.toUserId === curUser))) {
						// Marcar como entregado si soy el remitente
						if (String(m.fromUserId) === String(curUser) && m._id) {
							sentMessages[m._id] = sentMessages[m._id] || {};
							sentMessages[m._id].delivered = true;
						}
						loadMessages(curUser, selectedContactId);
					} else {
						if (m.toUserId === curUser && (!widget || widget.style.display === 'none')) {
							unreadCount++;
							updateBubbleBadge();
						}
					}
				});
				// NUEVO: presencia y typing
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
					// Si yo soy el remitente y el destinatario es el contacto abierto, marcar como visto
					const curUser = getCurrentUserId();
					if (curUser && fromUserId === curUser && toUserId === selectedContactId) {
						if (messageId) {
							sentMessages[messageId] = sentMessages[messageId] || {};
							sentMessages[messageId].seen = true;
						}
						loadMessages(curUser, selectedContactId);
					}
				});
			}
		} catch(e) { console.warn('socket fail', e); }
	}

	// NUEVO: actualizar header del chat con presencia y typing
	function updateChatHeaderPresence() {
		const curContact = selectedContactId;
		const p = contactPresence[curContact] || {};
		const label = chatUsernameLabel;
		const typing = typingIndicator;
		if (label) {
			if (typing) {
				label.textContent = 'Escribiendo...';
				label.style.color = '#4f46e5';
			} else if (p.online) {
				label.textContent = 'En línea';
				label.style.color = '#10b981';
			} else if (p.lastSeen) {
				const d = new Date(p.lastSeen);
				label.textContent = 'Últ. vez: ' + d.toLocaleString();
				label.style.color = '#888';
			}
		}
	}

	// --- typing events ---
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

	// --- BEGIN: adapt viewport height & keyboard handling ---
	function updateVhVar() {
		try {
			const height = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
			// set --vh as 1% of visual viewport in px units
			document.documentElement.style.setProperty('--vh', (height * 0.01) + 'px');
		} catch(e){ /* ignore */ }
	}

	// keep chat scrolled to bottom and ensure visibility when input receives focus
	function onChatInputFocus() {
		document.body.classList.add('keyboard-open');
		// update vh and scroll after a short delay to let viewport settle
		setTimeout(() => {
			updateVhVar();
			if (chatWindow) { chatWindow.scrollTop = chatWindow.scrollHeight; }
			// also ensure widget visible
			if (widget) widget.style.display = 'block';
		}, 120);
	}
	function onChatInputBlur() {
		// small delay to avoid flicker between focus changes
		setTimeout(() => {
			document.body.classList.remove('keyboard-open');
			updateVhVar();
		}, 160);
	}

	// attach viewport/keyboard listeners early
	try {
		updateVhVar();
		// prefer visualViewport events when available (more accurate with virtual keyboard)
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', updateVhVar);
			window.visualViewport.addEventListener('scroll', updateVhVar);
		}
		window.addEventListener('resize', updateVhVar);
		window.addEventListener('orientationchange', updateVhVar);
		// focusin/out to detect when keyboard is likely open
		window.addEventListener('focusin', (ev) => { if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) onChatInputFocus(); });
		window.addEventListener('focusout', (ev) => { if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) onChatInputBlur(); });
		// also attach directly to chat input if present
		if (chatInput) {
			chatInput.addEventListener('focus', onChatInputFocus);
			chatInput.addEventListener('blur', onChatInputBlur);
		}
	} catch(e){ console.warn('viewport handlers init failed', e); }
	// --- END: adapt viewport height & keyboard handling ---

	// bootstrap inicial
	(async function init(){
		// asegurar estado inicial: widget oculto, bubble visible
		if (widget) widget.style.display = 'none';
		if (bubble) bubble.style.display = 'flex';
		// actualizar variable vh al iniciar (por si el navegador ya tiene teclado o tamaños distintos)
		updateVhVar();
		await populateContacts();
		await ensureSocketAndJoin();

		// si hay contacto seleccionado en el DOM (por ejemplo marcado), cargar
		// si existe el select de destinatarios, seleccionar el primero disponible (ya manejado en populateContacts)
		if (chatRecipientSelect && chatRecipientSelect.value) {
			selectedContactId = chatRecipientSelect.value;
		}
	})();
})();

