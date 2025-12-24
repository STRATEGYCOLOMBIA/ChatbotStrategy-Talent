/* js/app.js */
(() => {
  const $chat = document.getElementById("chat");
  const $txt = document.getElementById("txt");
  const $btn = document.getElementById("btn");
  const $btnAvail = document.getElementById("btnAvail");

  if (!$chat || !$txt || !$btn) {
    console.warn("[app.js] Faltan elementos del DOM (#chat, #txt, #btn)");
    return;
  }

  const cfg = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);

  const fullName = params.get("fullName") || params.get("name") || "";
  const email = params.get("email") || "";
  const phone = params.get("phone") || "";

  const helloEl = document.getElementById("hello");
  if (helloEl && fullName) {
    helloEl.textContent = `Hola ${fullName} 👋 Pregunta lo que necesites sobre la vacante.`;
  }

  const startedAt = Date.now();
  let userMsgCount = 0;
  let availEnabled = false;

  const transcript = [];

  function addMsg(role, text) {
    const row = document.createElement("div");
    row.className = "msg " + (role === "me" ? "me" : "bot");
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    $chat.appendChild(row);
    $chat.scrollTop = $chat.scrollHeight;
    transcript.push({ role: role === "me" ? "user" : "bot", text, at: new Date().toISOString() });
    if (transcript.length > 30) transcript.shift();
  }

  addMsg("bot", "¡Hola! 👋 Soy el chatbot de la vacante. ¿Qué quieres saber?");

  function maybeEnableAvailabilityCTA() {
    if (availEnabled || !$btnAvail) return;
    const byMsgs = userMsgCount >= (cfg.ENABLE_AVAIL_AFTER_MESSAGES ?? 4);
    const byTime = Date.now() - startedAt >= (cfg.ENABLE_AVAIL_AFTER_MS ?? 120000);
    if (byMsgs || byTime) {
      availEnabled = true;
      $btnAvail.disabled = false;
      $btnAvail.title = "Haz clic para confirmar disponibilidad y recibir el link de Bookings";
      addMsg("bot", "✅ Puedes usar el botón 'Confirmar disponibilidad' para recibir el enlace de agendamiento (Bookings) por correo.");
    }
  }

  setTimeout(() => maybeEnableAvailabilityCTA(), cfg.ENABLE_AVAIL_AFTER_MS ?? 120000);

  const VACANTE_KB = `
Eres un asistente que responde SOLO sobre esta vacante:

Vacante: Apoyo en Gestión del Talento Humano y del Conocimiento (KM) - Strategy.
Base: Bogotá. Modalidad: proceso presencial. Contrato: término fijo.
Rango salarial: $1.423.500 – $1.970.000 COP según perfil y experiencia.
Requisitos: recién egresado profesional en Psicología organizacional, Administración, Ingeniería Industrial o afines.
Conocimientos: GH/DO, planes de capacitación, material instruccional (presentaciones/manuales/cápsulas), Excel básico, Office, Canva.
Experiencia: hasta 1 año (prácticas/pasantías/voluntariados) en GH, formación corporativa, DO o afines.
Ofrecemos: plan de carrera, acceso #StrategyBrainbox, salario emocional / bienestar.

Reglas:
- Si preguntan algo que NO está en la descripción, di que no está especificado y sugiere preguntar por correo en selección.
- No inventes beneficios o condiciones no mencionadas.
- Responde claro, corto y amable.
`;

  function buildPrompt(userMessage) {
    return `${VACANTE_KB}\n\nUsuario pregunta: ${userMessage}\n\nRespuesta:`;
  }

  // --- CHATGPT / OPENAI ---
  async function askOpenAI(userMessage) {
    const apiKey = cfg.OPENAI_API_KEY;
    const model = cfg.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey || apiKey.includes("PEGA_AQUI")) {
      return "⚠️ Falta configurar la API Key en js/config.js";
    }

    const url = "https://api.openai.com/v1/chat/completions";

    const payload = {
      model,
      messages: [
        { role: "system", content: "Eres un asistente de selección de personal para Strategy Colombia." },
        { role: "user", content: buildPrompt(userMessage) },
      ],
      temperature: 0.3,
      max_tokens: 400,
    };

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const msg = data?.error?.message || `HTTP ${r.status}`;
        return `😕 No pude responder en este momento. (${msg})`;
      }

      const data = await r.json();
      const text = data.choices?.[0]?.message?.content;
      return (text || "").trim() || "Ups 😅 no encontré una respuesta para eso. ¿Puedes reformular?";
    } catch (e) {
      console.error("[OpenAI fetch]", e);
      return "😕 No pude conectarme a ChatGPT. Intenta nuevamente o revisa tu conexión.";
    }
  }

  // --- POWER AUTOMATE ---
  async function confirmAvailability() {
    const flowUrl = cfg.POWER_AUTOMATE_URL;
    if (!flowUrl || flowUrl.includes("PEGA_AQUI")) {
      addMsg("bot", "⚠️ Falta configurar POWER_AUTOMATE_URL en js/config.js");
      return;
    }

    const payload = {
      fullName: fullName || "",
      email: email || "",
      phone: phone || "",
      source: "vacante-km-chatbot",
      pageUrl: location.href,
      createdAt: new Date().toISOString(),
      transcript,
    };

    if (!payload.email) {
      addMsg("bot", "📩 No recibí tu correo en la URL. Abre el enlace original de confirmación.");
      return;
    }

    addMsg("me", "✅ Confirmar disponibilidad");
    addMsg("bot", "⏳ Registrando tu confirmación...");

    try {
      const r = await fetch(flowUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      addMsg("bot", "✅ Listo. Te enviaremos un correo con el enlace de Bookings.");
    } catch (e) {
      console.error("[PowerAutomate]", e);
      addMsg("bot", "😕 No pude registrar tu confirmación (CORS o conexión). Intenta nuevamente.");
    }
  }

  // --- ENVÍO DE MENSAJE ---
  async function send() {
    const msg = $txt.value.trim();
    if (!msg) return;

    addMsg("me", msg);
    $txt.value = "";
    $btn.disabled = true;

    userMsgCount++;
    maybeEnableAvailabilityCTA();

    const answer = await askOpenAI(msg);
    addMsg("bot", answer);

    $btn.disabled = false;
    $txt.focus();
    maybeEnableAvailabilityCTA();
  }

  $btn.addEventListener("click", send);
  $txt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });

  document.querySelectorAll(".chip[data-q]").forEach((b) => {
    b.addEventListener("click", () => {
      $txt.value = b.dataset.q;
      send();
    });
  });

  if ($btnAvail) {
    $btnAvail.addEventListener("click", confirmAvailability);
  }
})();
