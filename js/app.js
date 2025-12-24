/* js/app.js */
(() => {
  // ========= DOM =========
  const $chat = document.getElementById('chat');
  const $txt = document.getElementById('txt');
  const $btn = document.getElementById('btn');
  const $btnAvail = document.getElementById('btnAvail'); // botón "Confirmar disponibilidad" (opcional)

  // Si alguno de los nodos no existe, salimos para evitar errores
  if (!$chat || !$txt || !$btn) {
    console.warn('[app.js] Faltan elementos del DOM (#chat, #txt, #btn). Revisa index.html');
    return;
  }

  // ========= CONFIG =========
  const cfg = window.APP_CONFIG || {};

  // ✅ TU WORKER BASE URL (lo ideal es setearlo en js/config.js como WORKER_BASE_URL)
  const WORKER_BASE =
    (cfg.WORKER_BASE_URL || '').replace(/\/+$/, '') ||
    'https://white-mouse-bea4.esthefany-ramirez.workers.dev'; // <-- CAMBIA si tu worker tiene otro dominio

  // Parámetros por URL (Opción A)
  const params = new URLSearchParams(location.search);
  const fullName = params.get('fullName') || params.get('name') || '';
  const email = params.get('email') || '';
  const phone = params.get('phone') || '';

  // Mensaje de bienvenida
  const helloEl = document.getElementById('hello');
  if (helloEl && fullName) {
    // URLSearchParams ya devuelve decodificado normalmente
    helloEl.textContent = `Hola ${fullName} 👋 Pregunta lo que necesites sobre la vacante.`;
  }

  // ========= ESTADO =========
  const startedAt = Date.now();
  let userMsgCount = 0;
  let availEnabled = false;

  // transcript mínimo para enviar al Flow (opcional)
  const transcript = []; // {role:'user'|'bot', text, at}

  function addMsg(role, text) {
    const row = document.createElement('div');
    row.className = 'msg ' + (role === 'me' ? 'me' : 'bot');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    row.appendChild(bubble);
    $chat.appendChild(row);
    $chat.scrollTop = $chat.scrollHeight;

    transcript.push({
      role: role === 'me' ? 'user' : 'bot',
      text,
      at: new Date().toISOString(),
    });
    if (transcript.length > 30) transcript.shift();
  }

  addMsg('bot', '¡Hola! 👋 Soy el chatbot de la vacante. ¿Qué quieres saber?');

  // ========= CTA DISPONIBILIDAD =========
  function maybeEnableAvailabilityCTA() {
    if (availEnabled || !$btnAvail) return;

    const byMsgs = userMsgCount >= (cfg.ENABLE_AVAIL_AFTER_MESSAGES ?? 4);
    const byTime = (Date.now() - startedAt) >= (cfg.ENABLE_AVAIL_AFTER_MS ?? 120000);

    if (byMsgs || byTime) {
      availEnabled = true;
      $btnAvail.disabled = false;
      $btnAvail.title = 'Haz clic para confirmar disponibilidad y recibir el link de Bookings';
      // Importante: tu bubble usa textContent (no HTML), así que evitamos markdown ** **
      addMsg('bot', '✅ Cuando quieras, puedes Confirmar disponibilidad para enviarte el enlace de agendamiento (Bookings) por correo.');
    }
  }

  // Fallback por tiempo
  setTimeout(() => maybeEnableAvailabilityCTA(), (cfg.ENABLE_AVAIL_AFTER_MS ?? 120000));

  // ========= CHAT (vía Cloudflare Worker) =========
  async function askChat(userMessage) {
    const url = `${WORKER_BASE}/chat`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage }),
      cache: 'no-store',
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg = data?.error || `HTTP ${r.status}`;
      return `😕 No pude responder en este momento. (${msg})`;
    }

    return (data?.answer || '').trim() || 'Ups 😅 no pude responder eso. ¿Puedes reformular?';
  }

  // ========= DISPONIBILIDAD (vía Cloudflare Worker -> Power Automate) =========
  async function confirmAvailability() {
    const url = `${WORKER_BASE}/availability`;

    // Validación: con opción A, esto debe venir por URL desde el correo
    if (!email) {
      addMsg(
        'bot',
        '📩 Para enviarte el enlace de Bookings necesito tu correo. Abre el chatbot desde el link del correo de aceptación (con ?email=...).'
      );
      return;
    }

    const payload = {
      fullName: fullName || '',
      email: email || '',
      phone: phone || '',
      source: 'vacante-km-chatbot',
      pageUrl: location.href,
      createdAt: new Date().toISOString(),
      transcript, // opcional
    };

    addMsg('me', '✅ Confirmar disponibilidad');
    addMsg('bot', '⏳ Perfecto, registrando tu confirmación para enviarte el enlace de agendamiento…');

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        const msg = data?.error || `HTTP ${r.status}`;
        addMsg('bot', `😕 No pude registrar tu confirmación. (${msg})`);
        return;
      }

      addMsg('bot', '✅ Listo. Te enviaremos un correo con el enlace para agendar en Bookings. Revisa tu bandeja de entrada 📩');
    } catch (e) {
      console.error('[availability] fetch error:', e);
      addMsg('bot', '😕 Error de conexión. Intenta nuevamente en unos minutos.');
    }
  }

  // ========= SEND =========
  async function send() {
    const msg = $txt.value.trim();
    if (!msg) return;

    addMsg('me', msg);
    $txt.value = '';
    $btn.disabled = true;

    userMsgCount += 1;
    maybeEnableAvailabilityCTA();

    try {
      const answer = await askChat(msg);
      addMsg('bot', answer);
      maybeEnableAvailabilityCTA();
    } catch (e) {
      console.error('[chat] fetch error:', e);
      addMsg('bot', 'Error de conexión 😕. Intenta nuevamente en unos minutos.');
    } finally {
      $btn.disabled = false;
      $txt.focus();
    }
  }

  // ========= EVENTOS =========
  $btn.addEventListener('click', send);
  $txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });

  document.querySelectorAll('.chip[data-q]').forEach((b) => {
    b.addEventListener('click', () => {
      $txt.value = b.dataset.q || '';
      send();
    });
  });

  if ($btnAvail) {
    // si no se habilitó aún, queda disabled (como en index.html)
    $btnAvail.addEventListener('click', confirmAvailability);
  }
})();
