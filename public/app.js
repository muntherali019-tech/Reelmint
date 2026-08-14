// Reelmint front-end. Talks to the API and does all media work in the browser:
// renders Smart Slides to canvas, previews with voiceover, and exports a real
// .webm video via MediaRecorder.

const $ = (s) => document.querySelector(s);

let TOKEN = localStorage.getItem("reelmint_token") || "";
const api = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => r.json());

let CONFIG = { enabled: false, model: "demo", watermark: true, plans: [] };
let USER = null; // logged-in user (or null)
let storyboard = null; // current storyboard
let chatLog = [];

const PALETTES = [
  { bg: "#0E1116", accent: "#5B8CFF", text: "#F4F6FB" },
  { bg: "#13070A", accent: "#FF5C7A", text: "#FFF1F3" },
  { bg: "#06120E", accent: "#36E0A0", text: "#EAFBF4" },
  { bg: "#120E06", accent: "#FFB23E", text: "#FFF6E8" },
  { bg: "#0B0716", accent: "#A66BFF", text: "#F3EDFF" },
];

// ---------- boot ----------
init();
async function init() {
  try {
    CONFIG = await fetch("/api/config", {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    }).then((r) => r.json());
    USER = CONFIG.user || null;
  } catch {}
  const pill = $("#statusPill");
  pill.textContent = CONFIG.enabled ? `● AI live · ${CONFIG.model}` : "● demo mode";
  pill.style.color = CONFIG.enabled ? "var(--good)" : "var(--muted)";
  if (!CONFIG.enabled)
    $("#createHint").textContent =
      "Demo mode — add ANTHROPIC_API_KEY on the server for real AI output.";
  renderAccount();
  renderFeatures();
  renderPlans();
  renderPacks();
  renderReferral();
  animateHero();
  wireTabs();
  wireCreate();
  wireEditor();
  wireCampaign();
  wireTrends();
  wireAds();
  wireThumbnails();
  wireCarousel();
  wireArticle();
  wireImage();
  wireBrand();
  wireScan();
  wireRepurpose();
  wireAuth();
  wireReferral();
  captureReferral();
  if (USER) loadBrandKit();
  handleReturnFromCheckout();
  initReveal();
  registerServiceWorker();
}

// sw.js caches the app shell (cache-first) and never caches /api/*, so the
// studio opens offline. Registration is best-effort: an unsupported browser or
// a blocked registration must not break boot.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Reveal-on-scroll for the marketing sections.
function initReveal() {
  const targets = document.querySelectorAll(".feature, .plan, .pack, .features h2, .pricing h2");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((t) => t.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
    { threshold: 0.12 }
  );
  targets.forEach((t) => { t.classList.add("reveal"); io.observe(t); });
}

// Persist a ?ref= code so it survives the sign-up flow.
function captureReferral() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) localStorage.setItem("reelmint_ref", ref);
}

// ---------- tabs ----------
function wireTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.querySelector(`.panel[data-panel="${t.dataset.tab}"]`).classList.add("active");
    });
  });
}

// ---------- create ----------
function wireCreate() {
  const dur = $("#duration");
  dur.addEventListener("input", () => ($("#durLabel").textContent = dur.value + "s"));

  $("#genBtn").addEventListener("click", async () => {
    const topic = $("#topic").value.trim();
    if (!topic) return toast("Type your idea first ✍️");
    busy($("#genBtn"), true, "Generating…");
    try {
      const res = await api("/api/script", {
        topic,
        platform: $("#platform").value,
        tone: $("#tone").value,
        durationSec: Number(dur.value),
        format: Number(dur.value) > 90 ? "long" : "short",
      });
      if (res.error === "out_of_credits") {
        USER = res.user || USER;
        renderAccount();
        toast("You're out of credits this month — upgrade to keep minting.");
        location.hash = "#pricing";
        return;
      }
      if (res.user) {
        USER = res.user;
        renderAccount();
      }
      storyboard = res;
      renderStoryboard();
      drawScene(0, 0.5);
      toast("Storyboard minted ✨ — preview or export it.");
      chatLog = [{ role: "bot", text: "Storyboard ready. Tell me what to tweak!" }];
      renderChat();
    } catch (e) {
      toast("Generation failed — try again.");
    } finally {
      busy($("#genBtn"), false, "✨ Generate storyboard");
    }
  });

  $("#playBtn").addEventListener("click", () => (previewing ? stopPreview() : previewPlay()));
  $("#exportBtn").addEventListener("click", exportVideo);
  $("#pngBtn").addEventListener("click", () => downloadCanvas($("#stage"), "reelmint-frame.png"));
}

function renderStoryboard() {
  const el = $("#storyboard");
  if (!storyboard) return (el.innerHTML = "");
  el.innerHTML = `
    <div><b>${esc(storyboard.title || "")}</b></div>
    <div class="muted">Hook: ${esc(storyboard.hook || "")}</div>
    ${storyboard.scenes
      .map(
        (s, i) => `<div class="scene-card">
          <span class="idx">SCENE ${i + 1}</span>
          <span class="cap">${esc(s.caption)}</span>
          <span class="vo">🎙 ${esc(s.voiceover)}</span>
        </div>`
      )
      .join("")}
    <div class="tagline">${(storyboard.hashtags || [])
      .map((h) => `<span class="tag">${esc(h)}</span>`)
      .join("")}</div>
    <div class="muted" style="font-size:13px">${esc(storyboard.description || "")}</div>`;
}

// ---------- canvas rendering ----------
function paletteFor(i) {
  const p = storyboard?.scenes?.[i]?.palette;
  return p && p.bg ? p : PALETTES[i % PALETTES.length];
}

function drawScene(i, progress = 0.5, canvas = $("#stage")) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const scene = storyboard?.scenes?.[i];
  const pal = paletteFor(i);
  // gradient background
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, pal.bg);
  g.addColorStop(1, shade(pal.bg, 24));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Ken Burns glow that drifts with progress
  const cx = W * (0.3 + 0.4 * progress);
  const cy = H * (0.35 + 0.2 * progress);
  const glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, W * 0.9);
  glow.addColorStop(0, hexA(pal.accent, 0.35));
  glow.addColorStop(1, hexA(pal.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // accent bar
  ctx.fillStyle = pal.accent;
  ctx.fillRect(W * 0.12, H * 0.2, W * 0.16, 8);

  if (!scene) {
    ctx.fillStyle = hexA(pal.text, 0.5);
    ctx.font = `600 ${Math.round(W * 0.05)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("Generate a storyboard →", W / 2, H / 2);
    return;
  }

  // index label
  ctx.fillStyle = pal.accent;
  ctx.font = `700 ${Math.round(W * 0.045)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`SCENE ${i + 1}`, W * 0.12, H * 0.18);

  // caption (wrapped, big)
  ctx.fillStyle = pal.text;
  ctx.textAlign = "left";
  const size = Math.round(W * 0.085);
  ctx.font = `800 ${size}px sans-serif`;
  wrapText(ctx, scene.caption || "", W * 0.12, H * 0.34, W * 0.76, size * 1.15);

  // voiceover subtitle near bottom (with a soft pill for legibility)
  ctx.fillStyle = hexA(pal.text, 0.85);
  ctx.font = `500 ${Math.round(W * 0.04)}px sans-serif`;
  wrapText(ctx, scene.voiceover || "", W * 0.12, H * 0.78, W * 0.76, W * 0.05);

  // cinematic finish: film grain + vignette so exports feel produced, not flat.
  drawGrain(ctx, W, H, 0.04);
  drawVignette(ctx, W, H);

  // scene progress bar
  ctx.fillStyle = hexA(pal.text, 0.15);
  ctx.fillRect(W * 0.12, H * 0.9, W * 0.76, 5);
  ctx.fillStyle = pal.accent;
  ctx.fillRect(W * 0.12, H * 0.9, W * 0.76 * progress, 5);

  // brand handle (from Brand Kit) or free-tier watermark
  const handle = storyboard?.brand?.handle;
  if (handle) {
    ctx.fillStyle = hexA(pal.text, 0.7);
    ctx.font = `700 ${Math.round(W * 0.035)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(handle, W * 0.12, H * 0.955);
  }
  if (CONFIG.watermark) {
    ctx.fillStyle = hexA(pal.text, 0.55);
    ctx.font = `700 ${Math.round(W * 0.035)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("◉ Reelmint", W * 0.88, H * 0.955);
  }
}

// Lightweight procedural grain — sparse dots, cheap enough for 30fps export.
function drawGrain(ctx, W, H, alpha = 0.05) {
  const n = Math.round((W * H) / 1400);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < n; i++) {
    ctx.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
  }
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ---------- preview (with voiceover) ----------
let previewing = false;
function previewPlay() {
  if (!storyboard) return toast("Generate a storyboard first.");
  if (previewing) return;
  previewing = true;
  $("#playBtn").textContent = "■ Stop";
  const scenes = storyboard.scenes;
  let i = 0;
  const synth = window.speechSynthesis;
  if (synth) synth.cancel();

  const playOne = () => {
    if (!previewing || i >= scenes.length) return stopPreview();
    const start = performance.now();
    const dur = 2600;
    const anim = (now) => {
      if (!previewing) return;
      const p = Math.min(1, (now - start) / dur);
      drawScene(i, p);
      if (p < 1) requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    if (synth && scenes[i].voiceover) {
      const u = new SpeechSynthesisUtterance(scenes[i].voiceover);
      u.rate = 1.05;
      u.onend = () => { i++; playOne(); };
      synth.speak(u);
    } else {
      setTimeout(() => { i++; playOne(); }, dur);
    }
  };
  playOne();
}
function stopPreview() {
  previewing = false;
  $("#playBtn").textContent = "▶ Preview";
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ---------- export video (canvas + ambient audio → webm) ----------
async function exportVideo() {
  if (!storyboard) return toast("Generate a storyboard first.");
  const btn = $("#exportBtn");
  busy(btn, true, "Rendering…");
  stopPreview();
  try {
    const canvas = $("#stage");
    const fps = 30;
    const stream = canvas.captureStream(fps);

    // gentle ambient pad so the file has an audio track
    const AC = window.AudioContext || window.webkitAudioContext;
    let audioCtx, dest;
    if (AC) {
      audioCtx = new AC();
      dest = audioCtx.createMediaStreamDestination();
      const pal = paletteFor(0);
      [196, 261.6, 329.6].forEach((f, idx) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.value = 0.04;
        o.connect(g).connect(dest);
        o.start();
      });
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    // Higher bitrate = crisper text and gradients in the exported file.
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    rec.start();

    const scenes = storyboard.scenes;
    const perScene = 2200; // ms
    for (let i = 0; i < scenes.length; i++) {
      const start = performance.now();
      await new Promise((resolve) => {
        const anim = (now) => {
          const p = Math.min(1, (now - start) / perScene);
          drawScene(i, p);
          if (p < 1) requestAnimationFrame(anim);
          else resolve();
        };
        requestAnimationFrame(anim);
      });
    }
    rec.stop();
    await done;
    if (audioCtx) audioCtx.close();

    const blob = new Blob(chunks, { type: "video/webm" });
    downloadBlob(blob, "reelmint-video.webm");
    toast("Video exported 🎬 (.webm)");
  } catch (e) {
    toast("Export not supported in this browser.");
  } finally {
    busy(btn, false, "⬇ Export video");
  }
}

// ---------- AI editor ----------
function wireEditor() {
  $("#sendBtn").addEventListener("click", sendInstruction);
  $("#instruction").addEventListener("keydown", (e) => e.key === "Enter" && sendInstruction());

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#micBtn");
  if (!SR) {
    mic.title = "Voice not supported in this browser";
    mic.addEventListener("click", () => toast("Voice input needs Chrome/Edge."));
    return;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  let live = false;
  mic.addEventListener("click", () => {
    if (live) return rec.stop();
    rec.start();
  });
  rec.onstart = () => { live = true; mic.classList.add("live"); };
  rec.onend = () => { live = false; mic.classList.remove("live"); };
  rec.onresult = (e) => {
    $("#instruction").value = e.results[0][0].transcript;
    sendInstruction();
  };
}

async function sendInstruction() {
  const input = $("#instruction");
  const text = input.value.trim();
  if (!text) return;
  if (!storyboard) return toast("Generate a storyboard in Create first.");
  input.value = "";
  chatLog.push({ role: "user", text });
  renderChat();
  busy($("#sendBtn"), true, "…");
  try {
    const res = await api("/api/assistant", { instruction: text, storyboard });
    if (res.storyboard) {
      storyboard = res.storyboard;
      renderStoryboard();
      drawScene(0, 0.5);
    }
    chatLog.push({ role: "bot", text: res.reply || "Done." });
    renderChat();
  } catch {
    chatLog.push({ role: "bot", text: "Something went wrong — try again." });
    renderChat();
  } finally {
    busy($("#sendBtn"), false, "Send");
  }
}

function renderChat() {
  const el = $("#chat");
  el.innerHTML = chatLog
    .map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`)
    .join("");
  el.scrollTop = el.scrollHeight;
}

// ---------- campaign studio ----------
function wireCampaign() {
  const c = $("#campCount");
  if (c) c.addEventListener("input", () => ($("#campCountLabel").textContent = c.value));
  const btn = $("#campBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const theme = $("#campTheme").value.trim();
    if (!theme) return toast("Give your campaign a theme first.");
    if (!USER) return openAuth("signup");
    if (!USER.premium) {
      toast("Campaign Studio is a Creator+ feature — upgrade to unlock it.");
      location.hash = "#pricing";
      return;
    }
    busy(btn, true, "Building…");
    try {
      const res = await api("/api/campaign", {
        theme,
        count: Number($("#campCount").value),
        platform: $("#campPlatform").value,
      });
      if (res.error === "premium_required") { location.hash = "#pricing"; return toast("Upgrade to Creator to build campaigns."); }
      if (res.error === "out_of_credits") { syncUser(res.user); location.hash = "#pricing"; return toast("Out of credits — top up or upgrade."); }
      if (res.error) return toast("Couldn't build the campaign — try again.");
      syncUser(res.user);
      renderCampaign(res);
      toast(`Campaign minted 🗓 — ${res.posts.length} posts ready.`);
    } catch { toast("Campaign failed — try again."); }
    finally { busy(btn, false, "🗓 Build campaign"); }
  });
}

function renderCampaign(c) {
  const el = $("#campaignOut");
  if (!c || !Array.isArray(c.posts)) return (el.innerHTML = "");
  el.innerHTML = `
    <div class="camp-head">
      <div class="camp-name">${esc(c.name || "Your campaign")}</div>
      <div class="muted">${esc(c.bigIdea || "")}</div>
    </div>
    <div class="camp-grid">
      ${c.posts.map((p) => `
        <div class="camp-card">
          <div class="camp-day">DAY ${esc(p.day)}</div>
          <div class="camp-title">${esc(p.title || p.angle || "")}</div>
          <div class="camp-hook">“${esc(p.hook || "")}”</div>
          <div class="camp-meta">
            <span class="chip">${esc(p.format || "video")}</span>
            <span class="chip">🕒 ${esc(p.bestTime || "peak")}</span>
          </div>
          <div class="tagline">${(p.hashtags || []).map((h) => `<span class="tag">${esc(h)}</span>`).join("")}</div>
          <button class="btn btn-ghost btn-sm" onclick="reelmintLoadIdea(${jsAttr(p.title || p.angle)})">Send to Create →</button>
        </div>`).join("")}
    </div>`;
}
window.reelmintLoadIdea = (idea) => {
  $("#topic").value = idea;
  document.querySelector('.tab[data-tab="create"]').click();
  $("#topic").scrollIntoView({ behavior: "smooth", block: "center" });
  toast("Loaded into Create — hit Generate ✨");
};

// ---------- trend radar ----------
function wireTrends() {
  const btn = $("#trendBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const topic = $("#trendTopic").value.trim();
    if (!topic) return toast("Type a topic to analyze.");
    busy(btn, true, "Analyzing…");
    try {
      const res = await api("/api/trends", { topic, platform: $("#trendPlatform").value });
      if (res.error === "out_of_credits") { syncUser(res.user); location.hash = "#pricing"; return toast("Out of credits — top up or upgrade."); }
      if (res.error) return toast("Trend analysis failed — try again.");
      if (res.user) syncUser(res.user);
      renderTrends(res);
    } catch { toast("Trend analysis failed."); }
    finally { busy(btn, false, "🔥 Analyze trends"); }
  });
}

function renderTrends(t) {
  const el = $("#trendsOut");
  const tier = (name, arr) => `
    <div class="tier">
      <h4>${name}</h4>
      ${(arr || []).map((h) => `<div class="tier-row"><span class="tag">${esc(h.tag)}</span><span class="muted">${esc(h.reach)} · ${esc(h.note)}</span></div>`).join("")}
    </div>`;
  const score = t.hookScore || {};
  el.innerHTML = `
    <div class="score-card">
      <div class="score-ring" style="--pct:${Number(score.score) || 0}">
        <div class="score-num">${esc(score.score ?? "—")}<small>/100</small></div>
      </div>
      <div>
        <div class="score-grade">Hook grade: <b>${esc(score.grade || "—")}</b></div>
        <div class="muted">${esc(score.tip || "")}</div>
      </div>
    </div>
    <div class="trend-cols">
      <div class="trend-col">
        <h4>Best times to post</h4>
        ${(t.bestTimes || []).map((b) => `<div class="time-row"><b>${esc(b.window)}</b><span class="muted">${esc(b.why)}</span></div>`).join("")}
      </div>
      <div class="trend-col">
        <h4>Hook angles that pop</h4>
        <ul class="angle-list">${(t.hookAngles || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      </div>
    </div>
    <div class="tiers">
      ${tier("Broad reach", t.hashtags?.broad)}
      ${tier("Sweet spot", t.hashtags?.mid)}
      ${tier("Niche & rankable", t.hashtags?.niche)}
    </div>
    ${t.ridingTrend ? `<div class="riding">📈 ${esc(t.ridingTrend)}</div>` : ""}`;
}

// ---------- ad studio ----------
function wireAds() {
  const btn = $("#adBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const product = $("#adProduct").value.trim();
    if (!product) return toast("Tell me what you're advertising first.");
    if (!USER) return openAuth("signup");
    if (!USER.premium) { toast("Ad Studio is a Creator+ feature — upgrade to unlock it."); location.hash = "#pricing"; return; }
    busy(btn, true, "Writing…");
    try {
      const res = await api("/api/ads", {
        product, platform: $("#adPlatform").value, goal: $("#adGoal").value,
      });
      if (res.error === "premium_required") { location.hash = "#pricing"; return toast("Upgrade to Creator to use Ad Studio."); }
      if (res.error === "out_of_credits") { syncUser(res.user); location.hash = "#pricing"; return toast("Out of credits — top up or upgrade."); }
      if (res.error) return toast("Couldn't write the ads — try again.");
      syncUser(res.user);
      renderAds(res);
      toast(`Ad set minted 📣 — ${res.variations.length} variations ready.`);
    } catch { toast("Ad Studio failed — try again."); }
    finally { busy(btn, false, "📣 Write ad variations"); }
  });
}
function renderAds(a) {
  const el = $("#adsOut");
  if (!a || !Array.isArray(a.variations)) return (el.innerHTML = "");
  el.innerHTML = `
    ${a.audience ? `<div class="riding">🎯 <b>Audience:</b> ${esc(a.audience)}</div>` : ""}
    <div class="ads-grid">
      ${a.variations.map((v) => `
        <div class="ad-card">
          <span class="ad-angle">${esc(v.angle || "Angle")}</span>
          <div class="ad-primary">${esc(v.primaryText || "").replace(/\n/g, "<br>")}</div>
          <div class="ad-headline">${esc(v.headline || "")}</div>
          <div class="muted ad-desc">${esc(v.description || "")}</div>
          <button class="ad-cta">${esc(v.cta || "Learn More")}</button>
          <button class="btn btn-ghost btn-sm ad-copy" onclick="reelmintCopyText(${jsAttr(adText(v))})">⧉ Copy</button>
        </div>`).join("")}
    </div>
    ${a.tip ? `<div class="riding">💡 <b>Optimize:</b> ${esc(a.tip)}</div>` : ""}`;
}
function adText(v) {
  return `${v.primaryText || ""}\n\nHeadline: ${v.headline || ""}\n${v.description || ""}\nCTA: ${v.cta || ""}`;
}

// ---------- thumbnail lab ----------
function wireThumbnails() {
  const btn = $("#thumbBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const topic = $("#thumbTopic").value.trim();
    if (!topic) return toast("Type a video topic first.");
    busy(btn, true, "Testing…");
    try {
      const res = await api("/api/thumbnails", { topic, platform: $("#thumbPlatform").value });
      if (res.error === "out_of_credits") { syncUser(res.user); location.hash = "#pricing"; return toast("Out of credits — top up or upgrade."); }
      if (res.error) return toast("Thumbnail Lab failed — try again.");
      if (res.user) syncUser(res.user);
      renderThumbnails(res);
    } catch { toast("Thumbnail Lab failed."); }
    finally { busy(btn, false, "🖱 Generate concepts"); }
  });
}
function renderThumbnails(t) {
  const el = $("#thumbsOut");
  if (!t || !Array.isArray(t.concepts)) return (el.innerHTML = "");
  el.innerHTML = `<div class="thumbs-grid">
    ${t.concepts.map((c, i) => {
      const pal = PALETTES[i % PALETTES.length];
      const score = Number(c.clickScore) || 0;
      return `<div class="thumb-card ${i === (t.winner || 0) ? "winner" : ""}">
        ${i === (t.winner || 0) ? '<span class="thumb-badge">Predicted winner</span>' : ""}
        <div class="thumb-frame" style="background:linear-gradient(135deg, ${pal.bg}, ${pal.accent})">
          <span class="thumb-overlay">${esc(c.overlay || "")}</span>
          <span class="thumb-score">${score}</span>
        </div>
        <div class="thumb-title">${esc(c.title || "")}</div>
        <div class="thumb-meta"><span class="chip">${esc(c.emotion || "")}</span></div>
        <div class="muted thumb-visual">${esc(c.visual || "")}</div>
      </div>`;
    }).join("")}
  </div>`;
}

// ---------- carousel maker ----------
function wireCarousel() {
  const c = $("#carCount");
  if (c) c.addEventListener("input", () => ($("#carCountLabel").textContent = c.value));
  const btn = $("#carBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const topic = $("#carTopic").value.trim();
    if (!topic) return toast("Give your carousel a topic first.");
    busy(btn, true, "Building…");
    try {
      const res = await api("/api/carousel", {
        topic, platform: $("#carPlatform").value, slides: Number($("#carCount").value),
      });
      if (res.error === "out_of_credits") { syncUser(res.user); location.hash = "#pricing"; return toast("Out of credits — top up or upgrade."); }
      if (res.error) return toast("Carousel Maker failed — try again.");
      if (res.user) syncUser(res.user);
      renderCarousel(res);
      toast(`Carousel minted 🎠 — ${res.slides.length} slides ready.`);
    } catch { toast("Carousel Maker failed."); }
    finally { busy(btn, false, "🎠 Build carousel"); }
  });
}
function renderCarousel(c) {
  const el = $("#carouselOut");
  if (!c || !Array.isArray(c.slides)) return (el.innerHTML = "");
  el.innerHTML = `
    <div class="camp-head"><div class="camp-name">${esc(c.title || "Your carousel")}</div></div>
    <div class="slides-strip">
      ${c.slides.map((s, i) => {
        const pal = PALETTES[i % PALETTES.length];
        return `<div class="slide-card" style="background:linear-gradient(160deg, ${pal.bg}, ${shade(pal.bg, 22)})">
          <span class="slide-idx" style="color:${pal.accent}">${i + 1}/${c.slides.length}</span>
          <div class="slide-headline">${esc(s.headline || "")}</div>
          <div class="slide-body">${esc(s.body || "")}</div>
        </div>`;
      }).join("")}
    </div>
    ${c.caption ? `<div class="slide-caption"><b>Caption</b><pre>${esc(c.caption)}</pre></div>` : ""}
    <div class="tagline">${(c.hashtags || []).map((h) => `<span class="tag">${esc(h)}</span>`).join("")}</div>`;
}

// ---------- SEO writer ----------
function wireArticle() {
  const btn = $("#artBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const topic = $("#artTopic").value.trim();
    if (!topic) return toast("Type an article topic first.");
    if (!USER) return openAuth("signup");
    if (!USER.premium) { toast("The SEO Writer is a Creator+ feature — upgrade to unlock it."); location.hash = "#pricing"; return; }
    busy(btn, true, "Writing…");
    try {
      const res = await api("/api/article", { topic, keywords: $("#artKeywords").value.trim() });
      if (res.error === "premium_required") { location.hash = "#pricing"; return toast("Upgrade to Creator to use the SEO Writer."); }
      if (res.error === "out_of_credits") { syncUser(res.user); location.hash = "#pricing"; return toast("Out of credits — top up or upgrade."); }
      if (res.error) return toast("Couldn't write the article — try again.");
      syncUser(res.user);
      renderArticle(res);
      toast("Article minted 📰 — ready to publish.");
    } catch { toast("SEO Writer failed — try again."); }
    finally { busy(btn, false, "📰 Write article"); }
  });
}
function renderArticle(a) {
  const el = $("#articleOut");
  if (!a || !a.body) return (el.innerHTML = "");
  el.innerHTML = `
    <div class="serp">
      <div class="serp-title">${esc(a.metaTitle || "")}</div>
      <div class="serp-url">yoursite.com/${esc(a.slug || "post")}</div>
      <div class="serp-desc">${esc(a.metaDescription || "")}</div>
    </div>
    <div class="article-meta">
      <span class="chip">⏱ ${esc(a.readTime || "—")}</span>
      <span class="chip">${(a.headings || []).length} sections</span>
      <button class="btn btn-ghost btn-sm" onclick="reelmintCopyText(${jsAttr(a.body)})">⧉ Copy Markdown</button>
    </div>
    <div class="article-body">${mdToHtml(a.body)}</div>
    ${Array.isArray(a.faq) && a.faq.length ? `<div class="faq"><h4>FAQ</h4>${a.faq.map((f) => `<div class="faq-item"><b>${esc(f.q)}</b><p class="muted">${esc(f.a)}</p></div>`).join("")}</div>` : ""}`;
}

// Minimal, safe Markdown → HTML (headings, bold, lists, paragraphs). Escapes first.
function mdToHtml(md) {
  const lines = String(md).split("\n");
  let html = "", inList = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { const n = h[1].length; html += `<h${n}>${inline(h[2])}</h${n}>`; continue; }
    if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// Copy arbitrary text to clipboard (used by Ad Studio + SEO Writer).
window.reelmintCopyText = (text) => {
  navigator.clipboard?.writeText(String(text)).then(
    () => toast("Copied to clipboard ⧉"),
    () => toast("Copy failed — select the text manually.")
  );
};

// ---------- brand kit ----------
function wireBrand() {
  const save = $("#bkSave");
  if (!save) return;
  const fields = ["bkBg", "bkAccent", "bkText", "bkName", "bkHandle", "bkVoice"];
  fields.forEach((id) => $("#" + id)?.addEventListener("input", drawBrandPreview));
  drawBrandPreview();
  save.addEventListener("click", async () => {
    if (!USER) return openAuth("signup");
    if (!USER.premium) { toast("Brand Kit is a Creator+ feature."); location.hash = "#pricing"; return; }
    busy(save, true, "Saving…");
    try {
      const res = await api("/api/brandkit", {
        name: $("#bkName").value, handle: $("#bkHandle").value,
        bg: $("#bkBg").value, accent: $("#bkAccent").value, text: $("#bkText").value,
        voice: $("#bkVoice").value,
      });
      if (res.error) { $("#bkHint").textContent = res.error; return; }
      if (res.user) syncUser(res.user);
      $("#bkHint").textContent = "Saved — new videos, posters and captions now use your brand.";
      toast("Brand kit saved 🎨");
    } catch { toast("Save failed."); }
    finally { busy(save, false, "💾 Save brand kit"); }
  });
}

function loadBrandKit() {
  const k = USER?.brandKit;
  if (!k) return;
  const set = (id, v) => { const el = $("#" + id); if (el && v) el.value = v; };
  set("bkName", k.name); set("bkHandle", k.handle);
  set("bkBg", k.bg); set("bkAccent", k.accent); set("bkText", k.text); set("bkVoice", k.voice);
  drawBrandPreview();
}

function drawBrandPreview() {
  const c = $("#bkStage"); if (!c) return;
  const ctx = c.getContext("2d"), W = c.width, H = c.height;
  const bg = $("#bkBg")?.value || "#0E1116", accent = $("#bkAccent")?.value || "#5B8CFF", text = $("#bkText")?.value || "#F4F6FB";
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, bg); g.addColorStop(1, shade(bg, 26));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.7, H * 0.28, 10, W * 0.7, H * 0.28, W);
  glow.addColorStop(0, hexA(accent, 0.45)); glow.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent; ctx.fillRect(W * 0.1, H * 0.34, W * 0.16, 8);
  ctx.fillStyle = text; ctx.textAlign = "left";
  ctx.font = "800 52px sans-serif";
  wrapText(ctx, ($("#bkName")?.value || "Your Brand").slice(0, 24), W * 0.1, H * 0.46, W * 0.8, 58);
  ctx.fillStyle = hexA(text, 0.75); ctx.font = "500 26px sans-serif";
  ctx.fillText($("#bkHandle")?.value || "@yourbrand", W * 0.1, H * 0.6);
  ctx.fillStyle = accent; ctx.font = "700 24px sans-serif"; ctx.textAlign = "right";
  ctx.fillText("◉ " + (($("#bkName")?.value || "Reelmint").split(" ")[0]), W * 0.9, H * 0.92);
}

// ---------- image ----------
let lastDesign = null;
function wireImage() {
  $("#imgBtn").addEventListener("click", async () => {
    const prompt = $("#imgPrompt").value.trim();
    if (!prompt) return toast("Describe the image first.");
    busy($("#imgBtn"), true, "Designing…");
    try {
      const res = await api("/api/image", { prompt, style: $("#imgStyle").value });
      if (res.type === "image" && (res.url || res.b64)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = $("#imgStage"), ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
        };
        img.src = res.url || `data:image/png;base64,${res.b64}`;
      } else {
        lastDesign = res.design;
        drawDesign(res.design);
      }
      toast("Image ready 🖼");
    } catch {
      toast("Image generation failed.");
    } finally {
      busy($("#imgBtn"), false, "🖼 Generate image");
    }
  });
  $("#imgDownload").addEventListener("click", () => downloadCanvas($("#imgStage"), "reelmint-image.png"));
}

function drawDesign(d) {
  const c = $("#imgStage"), ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  const pal = d.palette || PALETTES[0];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, pal.bg);
  g.addColorStop(1, shade(pal.bg, 30));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.7, H * 0.3, 10, W * 0.7, H * 0.3, W);
  glow.addColorStop(0, hexA(pal.accent, 0.4));
  glow.addColorStop(1, hexA(pal.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const y = d.layout === "lower" ? H * 0.62 : d.layout === "split" ? H * 0.3 : H * 0.4;
  ctx.fillStyle = pal.accent;
  ctx.fillRect(W * 0.1, y - H * 0.08, W * 0.14, 8);
  ctx.fillStyle = pal.text;
  ctx.textAlign = "left";
  const size = Math.round(W * 0.085);
  ctx.font = `800 ${size}px sans-serif`;
  wrapText(ctx, d.headline || "", W * 0.1, y, W * 0.8, size * 1.1);
  ctx.fillStyle = hexA(pal.text, 0.75);
  ctx.font = `500 ${Math.round(W * 0.04)}px sans-serif`;
  wrapText(ctx, d.subline || "", W * 0.1, y + size * 2.2, W * 0.8, W * 0.05);
  if (CONFIG.watermark) {
    ctx.fillStyle = hexA(pal.text, 0.5);
    ctx.font = `700 ${Math.round(W * 0.035)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("◉ Reelmint", W * 0.9, H * 0.93);
  }
}

// ---------- scan ----------
function wireScan() {
  $("#scanBtn").addEventListener("click", async () => {
    const file = $("#scanFile").files[0];
    if (!file) return toast("Choose an image to scan.");
    busy($("#scanBtn"), true, "Reading…");
    try {
      const base64 = await fileToBase64(file);
      const res = await api("/api/scan", {
        base64,
        mediaType: file.type || "image/png",
        instruction: $("#scanInstruction").value.trim() || undefined,
      });
      $("#scanOut").textContent = res.text || res.error || "No result.";
    } catch {
      $("#scanOut").textContent = "Scan failed.";
    } finally {
      busy($("#scanBtn"), false, "📷 Scan & repurpose");
    }
  });
}

// ---------- repurpose ----------
function wireRepurpose() {
  $("#repBtn").addEventListener("click", async () => {
    const transcript = $("#transcript").value.trim();
    if (!transcript) return toast("Paste a transcript first.");
    busy($("#repBtn"), true, "Finding clips…");
    try {
      const res = await api("/api/repurpose", { transcript, count: 4 });
      $("#clips").innerHTML = (res.clips || [])
        .map(
          (c) => `<div class="clip">
            <h4>${esc(c.title || "")}</h4>
            <div class="muted">Hook: ${esc(c.hook || "")}</div>
            <blockquote>${esc(c.quote || "")}</blockquote>
            <div class="tagline">${(c.hashtags || []).map((h) => `<span class="tag">${esc(h)}</span>`).join("")}</div>
          </div>`
        )
        .join("");
    } catch {
      toast("Repurpose failed.");
    } finally {
      busy($("#repBtn"), false, "✂️ Find viral clips");
    }
  });
}

// ---------- features + pricing ----------
function renderFeatures() {
  const feats = [
    ["🎬", "Prompt → video", "One idea becomes a fully storyboarded, voiced video with cinematic grain, motion and captions."],
    ["🗓", "Campaign Studio", "Turn one theme into a full multi-day content calendar that builds an audience, then converts it."],
    ["🔥", "Trend & Hashtag Radar", "Tiered hashtags, best post times, high-performing hooks and a virality score for any idea."],
    ["🪄", "Voice & text editor", "Just say or type what to change. The AI rewrites your storyboard live."],
    ["🎨", "Brand Kit", "Save your colors, handle and brand voice once — every video, poster and caption stays on-brand."],
    ["📣", "Ad Studio", "One product → five ready-to-run paid ad variations with targeting and an optimization tip."],
    ["🖱", "Thumbnail & Title Lab", "Four title + thumbnail concepts, each scored for predicted click-through, so you post the winner."],
    ["🎠", "Carousel Maker", "Turn one idea into a swipeable, save-worthy carousel — the format that out-reaches video on feed."],
    ["📰", "SEO Blog & Newsletter", "One topic → a publish-ready, search-optimized article with meta tags, headings and an FAQ."],
    ["📷", "Scan anything", "Turn a screenshot, photo or doc into ready-to-post content with real vision AI."],
    ["✂️", "Repurpose long-form", "Drop a transcript, get the most clip-worthy viral moments, ranked by hook strength."],
    ["⬇", "Export in-browser", "Render and download real 8-Mbps video & PNG files — no installs, no render farm."],
  ];
  $("#featureGrid").innerHTML = feats
    .map(
      ([ico, h, p]) => `<div class="feature"><div class="ico">${ico}</div><h3>${h}</h3><p>${p}</p></div>`
    )
    .join("");
}

function renderPlans() {
  const plans = CONFIG.plans?.length ? CONFIG.plans : [];
  $("#plans").innerHTML = plans
    .map(
      (p) => `<div class="plan ${p.popular ? "popular" : ""}">
        ${p.popular ? '<span class="badge">Most popular</span>' : ""}
        <h3>${esc(p.name)}</h3>
        <div class="price">${esc(p.price)} <small>${esc(p.period)}</small></div>
        <div class="credits">${esc(p.credits)}</div>
        <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        <button class="btn ${p.popular ? "btn-primary" : "btn-ghost"}" onclick="reelmintCheckout('${p.id}')">${esc(p.cta)}</button>
      </div>`
    )
    .join("");
}
window.reelmintCheckout = async (id) => {
  if (id === "free") return USER ? toast("You're set — start minting 🎉") : openAuth("signup");
  if (!USER) return openAuth("signup");
  if (!CONFIG.stripe)
    return toast("Billing isn't configured on this server yet (set STRIPE keys).");
  try {
    const res = await api("/api/billing/checkout", { plan: id });
    if (res.url) window.location.href = res.url;
    else toast(res.error || "Couldn't start checkout.");
  } catch {
    toast("Checkout failed.");
  }
};

// ---------- credit packs (one-time revenue) ----------
function renderPacks() {
  const packs = CONFIG.creditPacks || [];
  const wrap = $("#packsWrap");
  if (!packs.length) return (wrap.hidden = true);
  wrap.hidden = false;
  $("#packs").innerHTML = packs
    .map(
      (p) => `<div class="pack ${p.best ? "best" : ""}">
        ${p.best ? '<span class="badge">Best value</span>' : ""}
        <div class="pack-credits">${esc(p.credits)}</div>
        <div class="muted">credits</div>
        <div class="pack-price">${esc(p.price)}</div>
        <button class="btn ${p.best ? "btn-primary" : "btn-ghost"} btn-block" onclick="reelmintBuyPack('${p.id}')">Buy pack</button>
      </div>`
    )
    .join("");
}
window.reelmintBuyPack = async (id) => {
  if (!USER) return openAuth("signup");
  if (!CONFIG.creditPacksEnabled)
    return toast("Credit packs aren't configured on this server yet.");
  try {
    const res = await api("/api/billing/credits", { pack: id });
    if (res.url) window.location.href = res.url;
    else toast(res.error || "Couldn't start checkout.");
  } catch {
    toast("Checkout failed.");
  }
};

// ---------- referral ----------
function renderReferral() {
  const card = $("#referralCard");
  if (!USER || !USER.referralCode) return (card.hidden = true);
  card.hidden = false;
  $("#referralLink").value = `${location.origin}/?ref=${USER.referralCode}`;
}
function wireReferral() {
  $("#referralCopy")?.addEventListener("click", () => {
    const el = $("#referralLink");
    el.select();
    navigator.clipboard?.writeText(el.value).then(
      () => toast("Referral link copied 🔗"),
      () => toast("Copy failed — select and copy manually.")
    );
  });
}

// Keep USER + all user-dependent UI in sync after any API call that returns it.
function syncUser(user) {
  if (!user) return;
  USER = user;
  renderAccount();
  renderReferral();
}

// ---------- accounts ----------
function renderAccount() {
  const btn = $("#accountBtn");
  if (USER) {
    const c = USER.creditsLeft === "unlimited" ? "∞" : USER.creditsLeft;
    btn.textContent = `${USER.plan.toUpperCase()} · ${c} left`;
    btn.title = `${USER.email} — click to sign out`;
  } else {
    btn.textContent = "Sign in";
    btn.title = "Sign in or create an account";
  }
}

let authMode = "login";
function wireAuth() {
  $("#accountBtn").addEventListener("click", () => (USER ? logout() : openAuth("login")));
  $("#authClose").addEventListener("click", closeAuth);
  $("#authModal").addEventListener("click", (e) => e.target.id === "authModal" && closeAuth());
  $("#authSwitch").addEventListener("click", (e) => {
    e.preventDefault();
    openAuth(authMode === "login" ? "signup" : "login");
  });
  $("#authSubmit").addEventListener("click", doAuth);
  $("#authPass").addEventListener("keydown", (e) => e.key === "Enter" && doAuth());
}

function openAuth(mode) {
  authMode = mode;
  $("#authTitle").textContent = mode === "login" ? "Sign in to Reelmint" : "Create your account";
  $("#authSubmit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("#authSwitchText").textContent = mode === "login" ? "New here?" : "Already have an account?";
  $("#authSwitch").textContent = mode === "login" ? "Create an account" : "Sign in";
  $("#authError").textContent = "";
  $("#authModal").hidden = false;
  $("#authEmail").focus();
}
function closeAuth() {
  $("#authModal").hidden = true;
}

async function doAuth() {
  const email = $("#authEmail").value.trim();
  const password = $("#authPass").value;
  if (!email || !password) return ($("#authError").textContent = "Enter email and password.");
  busy($("#authSubmit"), true, "…");
  try {
    const ref = authMode === "signup" ? localStorage.getItem("reelmint_ref") || undefined : undefined;
    const res = await api(`/api/auth/${authMode}`, { email, password, ref });
    if (res.error) {
      $("#authError").textContent = res.error;
      return;
    }
    TOKEN = res.token;
    localStorage.setItem("reelmint_token", TOKEN);
    if (ref) localStorage.removeItem("reelmint_ref");
    USER = res.user;
    renderAccount();
    renderReferral();
    loadBrandKit();
    closeAuth();
    const bonus = USER.bonusCredits ? ` — +${USER.bonusCredits} bonus credits!` : "";
    toast(`Welcome${authMode === "signup" ? "" : " back"}, ${USER.email.split("@")[0]} 👋${bonus}`);
  } catch {
    $("#authError").textContent = "Something went wrong.";
  } finally {
    busy($("#authSubmit"), false, authMode === "login" ? "Sign in" : "Create account");
  }
}

function logout() {
  TOKEN = "";
  USER = null;
  localStorage.removeItem("reelmint_token");
  renderAccount();
  renderReferral();
  toast("Signed out.");
}

async function refreshMe() {
  if (!TOKEN) return;
  try {
    const res = await fetch("/api/me", { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.json());
    syncUser(res.user);
    loadBrandKit();
  } catch {}
}

function handleReturnFromCheckout() {
  const q = new URLSearchParams(location.search);
  if (q.get("upgraded")) {
    refreshMe();
    toast(`Upgraded to ${q.get("upgraded").toUpperCase()} 🎉`);
    history.replaceState({}, "", location.pathname + "#pricing");
  } else if (q.get("credits")) {
    refreshMe();
    toast(`Added ${q.get("credits")} credits 🎉`);
    history.replaceState({}, "", location.pathname + "#pricing");
  } else if (q.get("canceled")) {
    toast("Checkout canceled.");
    history.replaceState({}, "", location.pathname);
  }
}

// ---------- hero animation ----------
function animateHero() {
  const screen = $("#heroScreen");
  let i = 0;
  setInterval(() => {
    const p = PALETTES[i % PALETTES.length];
    screen.style.background = `linear-gradient(160deg, ${p.bg}, ${p.accent})`;
    i++;
  }, 1400);
}

// ---------- utils ----------
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(" ");
  let line = "", yy = y;
  for (const w of words) {
    const test = line + w + " ";
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, yy);
      line = w + " ";
      yy += lh;
    } else line = test;
  }
  ctx.fillText(line.trim(), x, yy);
}
function shade(hex, amt) {
  const { r, g, b } = hexRGB(hex);
  const f = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function hexA(hex, a) {
  const { r, g, b } = hexRGB(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function hexRGB(hex) {
  let h = (hex || "#000").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// Safely embed a string as a single-quoted JS argument inside an HTML attribute.
function jsAttr(s) {
  return "'" + String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/</g, "\\x3C")
    .replace(/[\r\n]/g, " ") + "'";
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function downloadCanvas(canvas, name) {
  canvas.toBlob((b) => downloadBlob(b, name));
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = label;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
