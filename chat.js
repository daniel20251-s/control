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

	// NUEVAS referencias DOM para upload de foto
	const changePhotoBtn = $id('change-photo-btn');
	const chatPhotoInput = $id('chat-photo-input');

	// NUEVAS referencias DOM para modal avatar
	const avatarModal = $id('avatar-modal');
	const avatarModalImg = $id('avatar-modal-img');

	// estado
	let socket = null;
	let selectedContactId = null;
	let contactPresence = {}; // { userId: { online, lastSeen } }
	let typingIndicator = false;
	let lastTypingTimeout = null;
	let typingState = false;
	let sentMessages = {}; // { messageId: { delivered, seen } }

	// NUEVO: cache de usuarios
	let usersList = [];

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
		// guardar lista para uso posterior
		usersList = list || [];
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
					// actualizar avatar del header según el contacto seleccionado (o usuario actual como fallback)
					updateHeaderAvatarForSelectedContact();
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
				// actualizar avatar del header según el contacto seleccionado (o usuario actual como fallback)
				updateHeaderAvatarForSelectedContact();
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
			// usamos la lista ya obtenida (evita otra petición)
			const me = list.find(x => (x._id||x.id) == curId);
			if (me) {
				// si tiene photoUrl, mostrar <img>, si no mostrar iniciales
				if (me.photoUrl) {
					const src = (me.photoUrl.indexOf('http') === 0) ? me.photoUrl : (API_BASE + me.photoUrl);
					chatUserAvatar.innerHTML = `<img src="${src}" alt="avatar" />`;
				} else {
					chatUserAvatar.textContent = (me.username||'U').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
				}
			}
		}
		// actualizar avatar del header según el contacto seleccionado (o usuario actual como fallback)
		updateHeaderAvatarForSelectedContact();
	}

	// Mostrar la foto/iniciales del contacto seleccionado (o del usuario actual si no hay seleccionado).
	function updateHeaderAvatarForSelectedContact() {
		const curId = getCurrentUserId();
		let target = null;
		if (selectedContactId) {
			target = usersList.find(u => (u._id || u.id) == selectedContactId) || null;
		}
		// si no hay seleccionado, mostrar al usuario actual (si existe)
		if (!target && curId) {
			target = usersList.find(u => (u._id || u.id) == curId) || null;
		}
		if (chatUserAvatar) {
			if (target && target.photoUrl) {
				const src = (target.photoUrl.indexOf('http') === 0) ? target.photoUrl : (API_BASE + target.photoUrl);
				chatUserAvatar.innerHTML = `<img src="${src}" alt="avatar" />`;
			} else if (target && target.username) {
				chatUserAvatar.innerHTML = ''; // limpiar antes de poner texto
				chatUserAvatar.textContent = (target.username || 'U').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
			} else {
				chatUserAvatar.innerHTML = '💬';
			}
		}
		// Mostrar el botón de cambiar foto sólo cuando el avatar mostrado es el del usuario actual
		if (changePhotoBtn) {
			if (curId && selectedContactId && String(selectedContactId) === String(curId)) changePhotoBtn.style.display = 'inline-flex';
			else if (!selectedContactId && curId) changePhotoBtn.style.display = 'inline-flex';
			else changePhotoBtn.style.display = 'none';
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
				// actualizar contactos cuando un usuario se registra/actualiza (por ejemplo subida de foto)
				socket.off('user:registered');
				socket.on('user:registered', async (u) => {
					try { await populateContacts(); } catch(e){ console.warn('refresh contacts after user:registered', e); }
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

	// Upload de foto: abrir selector y subir
	if (changePhotoBtn && chatPhotoInput) {
		changePhotoBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			chatPhotoInput.click();
		});
		chatPhotoInput.addEventListener('change', async (ev) => {
			const file = (ev.target && ev.target.files && ev.target.files[0]) ? ev.target.files[0] : null;
			if (!file) return;
			if (!file.type.startsWith('image/')) { alert('Selecciona una imagen'); return; }
			// permitir archivos más grandes (hasta 50MB)
			if (file.size > 50 * 1024 * 1024) { alert('La imagen debe ser menor a 50MB'); return; }

			const cur = getCurrentUserId();
			if (!cur) { alert('Debe configurar currentUserId en localStorage antes de subir foto'); return; }

			try {
				changePhotoBtn.disabled = true;
				// leer como dataURL
				const dataUrl = await new Promise((resolve, reject) => {
					const r = new FileReader();
					r.onload = () => resolve(r.result);
					r.onerror = () => reject(new Error('file read error'));
					r.readAsDataURL(file);
				});
				const r = await fetch(`${API_BASE}/api/users/${encodeURIComponent(cur)}/photo`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ dataUrl })
				});
				if (!r.ok) {
					const body = await r.json().catch(()=>({}));
					throw new Error(body && body.error ? body.error : 'upload failed');
				}
				const updated = await r.json();
				// actualizar avatar en UI (usar photoUrl retornado)
				if (updated && updated.photoUrl) {
					const src = (updated.photoUrl.indexOf('http') === 0) ? updated.photoUrl : (API_BASE + updated.photoUrl);
					if (chatUserAvatar) chatUserAvatar.innerHTML = `<img src="${src}" alt="avatar" />`;
				}
				// refrescar contactos para que otros cambios se reflejen
				await populateContacts();
			} catch (err) {
				console.warn('upload avatar failed', err);
				alert('No se pudo subir la foto.');
			} finally {
				changePhotoBtn.disabled = false;
				chatPhotoInput.value = '';
			}
		});
	}

	// Abrir modal al clicar el avatar (si contiene <img>)
	if (chatUserAvatar && avatarModal && avatarModalImg) {
		function openAvatarModal() {
			const img = chatUserAvatar.querySelector('img');
			if (!img || !img.src) return;
			avatarModalImg.src = img.src;
			avatarModal.classList.remove('hidden');
			avatarModal.classList.add('show');
			avatarModal.setAttribute('aria-hidden', 'false');
		}
		function closeAvatarModal() {
			avatarModal.classList.add('hidden');
			avatarModal.classList.remove('show');
			avatarModal.setAttribute('aria-hidden', 'true');
			avatarModalImg.src = '';
		}

		chatUserAvatar.addEventListener('click', openAvatarModal);
		chatUserAvatar.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openAvatarModal(); } });

		// Cerrar al clicar fuera de la imagen (overlay) o con ESC
		avatarModal.addEventListener('click', (ev) => {
			// si se clicó fuera de la imagen -> cerrar
			if (ev.target === avatarModal || ev.target === avatarModalImg) {
				// si clic en la imagen, no cerrar (clic en fondo sí)
				if (ev.target === avatarModal) closeAvatarModal();
			}
		});
		// cerrar con ESC
		window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && avatarModal && !avatarModal.classList.contains('hidden')) closeAvatarModal(); });
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
		if (chatRecipientSelect && chatRecipientSelect.value) {
			selectedContactId = chatRecipientSelect.value;
			updateHeaderAvatarForSelectedContact();
		}
	})();

	// handlers
	if (chatCloseBtn) chatCloseBtn.addEventListener('click', hideWidget);
	// openChatBtn is an <a> that opens standalone page; do not override.

})();



