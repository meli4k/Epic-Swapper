let view = "swap";
let latest = {
  session: { signedIn: false, name: "", accountId: "", lasting: false },
  sessionLogin: { active: false, phase: "idle", code: "", url: "", message: "", error: "" },
  swap: {
    phase: "idle",
    code: "",
    url: "",
    message: "",
    sourceName: "",
    targetName: "",
    sourceId: "",
    targetId: "",
    error: "",
    result: null,
  },
};
let clientError = "";
let lookupProfile = null;
let lookupError = "";
let lookupBusy = false;
let lookupQuery = "";
let swapKey = "";
let accountKey = "";

const SVG_NS = "http://www.w3.org/2000/svg";
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
const mouse = { x: -9999, y: -9999 };

const panel = document.getElementById("panel");
const statusButton = document.getElementById("status");
const statusText = document.getElementById("status-text");
const indicator = document.getElementById("rail-indicator");
const toasts = document.getElementById("toasts");
const offline = document.getElementById("offline");

const ICONS = {
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  swap: ["M4 8h13l-3-3", "M20 16H7l3 3"],
  search: ["M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M20 20l-4.2-4.2"],
  copy: ["M9 9h10v10H9z", "M5 15V5h10"],
  external: ["M14 5h5v5", "M19 5l-8 8", "M17 14v5H5V7h5"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  alert: ["M12 7v6", "M12 16.5v.5"],
  x: ["M7 7l10 10", "M17 7L7 17"],
  key: ["M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.5V20h3v-2h2v-2h2l1-1A5.5 5.5 0 0 1 14.5 4z", "M16 8.5h.01"],
  shield: ["M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z", "M9 12l2 2 4-4"],
  folder: ["M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"],
  user: ["M12 4.7a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z", "M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"],
  logout: ["M10 5H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 19h4", "M15 8l4 4-4 4", "M19 12H9.5"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
};

/* DOM helpers */

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "style") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function svg(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const kid of kids) node.append(kid);
  return node;
}

function icon(name, pathLength) {
  return svg("svg", { class: "icon", viewBox: "0 0 24 24", "aria-hidden": "true" },
    ...ICONS[name].map((d) => svg("path", pathLength ? { d, pathLength } : { d })));
}

function delay(ms) {
  return { animationDelay: `${ms}ms` };
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function initials(text) {
  const clean = String(text || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return (clean || "?").slice(0, 2).toUpperCase();
}

function hue(text) {
  let n = 0;
  for (const char of String(text || "")) n = (n * 31 + char.codePointAt(0)) % 360;
  return n;
}

function avatar(name, small = false) {
  const base = hue(name);
  return h("div", {
    class: `avatar${small ? " small" : ""}`,
    text: initials(name),
    style: { background: `linear-gradient(135deg, hsl(${base} 8% 62%), hsl(${base} 6% 18%))` },
  });
}

/* Interaction effects */

function ripple(el) {
  el.addEventListener("pointerdown", (event) => {
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const dot = h("span", {
      class: "ripple",
      style: {
        left: `${event.clientX - rect.left - size / 2}px`,
        top: `${event.clientY - rect.top - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
      },
    });
    el.append(dot);
    dot.animate(
      [{ transform: "scale(0)", opacity: 0.35 }, { transform: "scale(1)", opacity: 0 }],
      { duration: 650, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    ).onfinish = () => dot.remove();
  });
}

function magnetic(el) {
  el.addEventListener("pointermove", (event) => {
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    el.style.transform = `translate(${dx * 0.16}px, ${dy * 0.28}px)`;
  });
  el.addEventListener("pointerleave", () => {
    el.style.transform = "";
  });
}

function button(label, { kind = "", iconName, trailing, onClick, href, magnet = false, type = "button" } = {}) {
  const kids = [
    iconName ? icon(iconName) : null,
    label ? h("span", { text: label }) : null,
    trailing ? icon(trailing) : null,
  ];
  const el = href
    ? h("a", { class: `btn ${kind}`, href, target: "_blank", rel: "noopener noreferrer" }, kids)
    : h("button", { class: `btn ${kind}`, type, onclick: onClick }, kids);
  ripple(el);
  if (magnet) magnetic(el);
  return el;
}

function holdButton(label, onDone) {
  const fill = h("span", { class: "hold-fill" });
  const text = h("span", { text: label });
  const el = h("button", { class: "btn hold", type: "button" }, fill, icon("swap"), text);
  let done = false;
  const start = () => {
    if (done) return;
    el.classList.add("holding");
    text.textContent = "Keep holding";
  };
  const stop = () => {
    if (done) return;
    el.classList.remove("holding");
    text.textContent = label;
  };
  fill.addEventListener("transitionend", () => {
    if (!el.classList.contains("holding") || done) return;
    done = true;
    text.textContent = "Starting";
    onDone();
  });
  el.addEventListener("pointerdown", (event) => {
    el.setPointerCapture?.(event.pointerId);
    start();
  });
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      start();
    }
  });
  el.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") stop();
  });
  el.addEventListener("blur", stop);
  return el;
}

function scramble(el, text, { duration = 650, wait = 0, glyphs = GLYPHS } = {}) {
  const target = String(text ?? "");
  let start = null;
  const step = (now) => {
    if (start !== null && !el.isConnected) return;
    if (start === null) start = now + wait;
    const t = (now - start) / duration;
    if (t < 0) {
      requestAnimationFrame(step);
      return;
    }
    let out = "";
    for (let i = 0; i < target.length; i += 1) {
      const at = i / Math.max(target.length, 1);
      if (t >= at + 0.2 || target[i] === " ") out += target[i];
      else out += glyphs[Math.floor(Math.random() * glyphs.length)];
    }
    el.textContent = out;
    if (t < 1.2) requestAnimationFrame(step);
    else el.textContent = target;
  };
  requestAnimationFrame(step);
  return el;
}

function toast(message, tone = "ok") {
  const el = h("div", { class: `toast ${tone}` }, icon(tone === "ok" ? "check" : "alert"), h("span", { text: message }));
  toasts.append(el);
  setTimeout(() => {
    el.classList.add("leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 2600);
}

async function copyText(value, what = "Copied") {
  try {
    if (window.desktop?.copy) await window.desktop.copy(value);
    else await navigator.clipboard.writeText(value);
    toast(what);
  } catch {
    toast("Could not copy that.", "bad");
  }
}

/* Cursor follower */

const LOCK_TARGETS = "button, a, .status";

function startCursor() {
  const dot = document.getElementById("cursor-dot");
  const ring = document.getElementById("cursor-ring");
  const root = document.documentElement;
  const light = { x: -999, y: -999 };
  const r = { x: -100, y: -100, w: 34, h: 34, radius: 17 };
  let target = null;
  let pressed = false;
  let overInput = false;

  window.addEventListener("pointermove", (event) => {
    if (mouse.x < -1000) {
      r.x = event.clientX;
      r.y = event.clientY;
      light.x = event.clientX;
      light.y = event.clientY;
    }
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    const el = event.target instanceof Element ? event.target : null;
    overInput = Boolean(el?.closest("input"));
    target = overInput ? null : el?.closest(LOCK_TARGETS) || null;
    document.body.classList.toggle("cursor-on", !overInput && mouse.y > 44);
  });
  window.addEventListener("pointerdown", () => { pressed = true; });
  window.addEventListener("pointerup", () => { pressed = false; });
  document.addEventListener("pointerleave", () => {
    document.body.classList.remove("cursor-on");
  });
  window.addEventListener("blur", () => document.body.classList.remove("cursor-on"));

  const frame = () => {
    let goal;
    if (target && target.isConnected) {
      const rect = target.getBoundingClientRect();
      const pad = 6;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 10;
      goal = {
        x: cx + (mouse.x - cx) * 0.12,
        y: cy + (mouse.y - cy) * 0.12,
        w: rect.width + pad * 2,
        h: rect.height + pad * 2,
        radius: Math.min(radius + pad, (rect.height + pad * 2) / 2),
      };
    } else {
      target = null;
      goal = { x: mouse.x, y: mouse.y, w: 34, h: 34, radius: 17 };
    }
    if (pressed) {
      goal.w *= 0.92;
      goal.h *= 0.92;
    }
    const k = target ? 0.22 : 0.18;
    r.x += (goal.x - r.x) * k;
    r.y += (goal.y - r.y) * k;
    r.w += (goal.w - r.w) * 0.2;
    r.h += (goal.h - r.h) * 0.2;
    r.radius += (goal.radius - r.radius) * 0.2;

    const speed = target ? 0 : Math.min(Math.hypot(goal.x - r.x, goal.y - r.y) / 60, 0.35);
    const angle = Math.atan2(goal.y - r.y, goal.x - r.x);
    ring.style.width = `${r.w}px`;
    ring.style.height = `${r.h}px`;
    ring.style.borderRadius = `${r.radius}px`;
    ring.style.transform = `translate(${r.x - r.w / 2}px, ${r.y - r.h / 2}px) rotate(${angle}rad) scale(${1 + speed}, ${1 - speed * 0.6}) rotate(${-angle}rad)`;
    ring.classList.toggle("locked", Boolean(target));
    ring.classList.toggle("pressed", pressed);

    dot.style.transform = `translate(${mouse.x}px, ${mouse.y}px) scale(${target ? 0 : pressed ? 0.6 : 1})`;

    light.x += (mouse.x - light.x) * 0.1;
    light.y += (mouse.y - light.y) * 0.1;
    root.style.setProperty("--mx", `${light.x}px`);
    root.style.setProperty("--my", `${light.y}px`);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* Desktop bridge */

async function api(path, body) {
  if (!window.desktop) throw new Error("Open Epic Swapper.exe. This screen does not run in a browser.");
  let data;
  try {
    if (path === "/api/state") data = await window.desktop.state();
    else if (path === "/api/swap/start") data = await window.desktop.swapStart();
    else if (path === "/api/swap/double") data = await window.desktop.swapDouble();
    else if (path === "/api/swap/cancel") data = await window.desktop.swapCancel();
    else if (path === "/api/swap/confirm") data = await window.desktop.swapConfirm();
    else if (path === "/api/session/start") data = await window.desktop.sessionStart(Boolean(body?.force));
    else if (path === "/api/session/cancel") data = await window.desktop.sessionCancel();
    else if (path === "/api/session/logout") data = await window.desktop.sessionLogout();
    else if (path === "/api/lookup") data = await window.desktop.lookup(body?.name || "");
    else throw new Error("Request failed.");
  } catch (error) {
    throw new Error(error?.message || "This window lost contact with the app.");
  }
  if (data?.error && data.swap == null && data.profile == null && data.session == null) {
    throw new Error(data.error);
  }
  return data;
}

function transition(run) {
  if (document.startViewTransition) document.startViewTransition(run);
  else run();
}

function apply(data) {
  const phaseChanged = data.swap?.phase !== latest.swap?.phase
    || data.sessionLogin?.phase !== latest.sessionLogin?.phase;
  latest = data;
  if (phaseChanged) clientError = "";
  offline.hidden = true;
  if (phaseChanged) transition(paint);
  else paint();
}

function paint() {
  paintStatus();
  if (view === "swap") paintSwap();
  else if (view === "account") paintAccount();
  else paintLookupNotice();
}

function paintStatus() {
  const session = latest.session;
  statusText.textContent = session.signedIn
    ? `Lookup as ${session.name || session.accountId || "saved account"}`
    : "No lookup account";
  statusButton.classList.toggle("on", session.signedIn);
}

function moveIndicator() {
  const active = document.querySelector(`.rail-btn[data-view="${view}"]`);
  if (!active) return;
  indicator.style.transform = `translateY(${active.offsetTop}px)`;
  indicator.style.height = `${active.offsetHeight}px`;
}

function setView(next) {
  if (next === view) return;
  view = next;
  for (const btn of document.querySelectorAll(".rail-btn")) {
    btn.classList.toggle("active", btn.dataset.view === next);
  }
  moveIndicator();
  transition(() => {
    swapKey = "";
    accountKey = "";
    panel.scrollTop = 0;
    panel.replaceChildren();
    paint();
  });
}

function notice(text) {
  return text ? h("div", { class: "notice rise" }, icon("alert"), h("span", { text })) : null;
}

function head(title, text) {
  return h("div", { class: "view-head rise" }, h("h1", {}, title), h("p", { text }));
}

/* Swap: stage */

function slot(label, state, name, id) {
  const nameEl = h("strong", { class: "slot-name" });
  if (state === "empty") nameEl.textContent = "Not signed in";
  else if (state === "waiting") nameEl.textContent = "Waiting for sign-in";
  else nameEl.textContent = name || "Unknown";
  return h("div", { class: `slot ${state}` },
    h("span", { class: "label", text: label }),
    nameEl,
    h("span", { class: "slot-id", text: state === "filled" ? id || "" : "" })
  );
}

function bridge(tag) {
  const d = "M0 70 C 50 4, 150 4, 200 70";
  return h("div", { class: "bridge", "aria-hidden": "true" },
    svg("svg", { viewBox: "0 0 200 80", preserveAspectRatio: "none" },
      svg("defs", {},
        svg("linearGradient", { id: "bridge-grad", x1: "0", y1: "0", x2: "1", y2: "0" },
          svg("stop", { offset: "0", "stop-color": "#ffffff" }),
          svg("stop", { offset: "1", "stop-color": "#6f737c" })
        )
      ),
      svg("path", { class: "track", d }),
      svg("path", { class: "flow", d })
    ),
    h("span", { class: "bridge-tag label", text: tag })
  );
}

function buildStage(swap) {
  const phase = swap.phase;
  const done = phase === "done" || phase === "error";
  const double = swap.mode === "double";
  if (double) {
    const states = {
      source: ["waiting", "empty", "empty"],
      target: ["filled", "waiting", "empty"],
      third: ["filled", "filled", "waiting"],
      review: ["filled", "filled", "filled"],
      confirm: ["filled", "filled", "filled"],
      swapping: ["filled", "filled", "filled"],
    }[phase] || (swap.sourceName ? ["filled", "filled", swap.thirdName ? "filled" : "empty"] : ["empty", "empty", "empty"]);
    const before = swap.result?.accounts;
    const a = slot("Has the name", states[0], before?.first.before || swap.sourceName, swap.sourceId);
    const b = slot("Receives it", states[1], before?.second.before || swap.targetName, swap.targetId);
    const c = slot("Keeps the other name", states[2], before?.third?.before || swap.thirdName, swap.thirdId);
    const tags = {
      source: "step 1 of 5",
      target: "step 2 of 5",
      third: "step 3 of 5",
      review: "step 4 of 5",
      confirm: "step 5 of 5",
      swapping: "swapping",
      done: "done",
      error: "stopped",
    };
    const el = h("section", { class: "card stage double rise", "data-phase": done ? "done" : phase, style: delay(60) },
      a, bridge(tags[phase] || ""), b, bridge("then"), c);
    return { el, a, b, c };
  }
  const states = {
    idle: ["empty", "empty"],
    source: ["waiting", "empty"],
    target: ["filled", "waiting"],
    confirm: ["filled", "filled"],
    swapping: ["filled", "filled"],
  }[phase] || (swap.sourceName ? ["filled", swap.targetName ? "filled" : "empty"] : ["empty", "empty"]);
  const before = swap.result?.accounts;
  const a = slot("From · has the name", states[0], before?.first.before || swap.sourceName, swap.sourceId);
  const b = slot("To · receives it", states[1], before?.second.before || swap.targetName, swap.targetId);
  const tags = { idle: "ready", source: "step 1 of 3", target: "step 2 of 3", confirm: "step 3 of 3", swapping: "swapping", done: "done", error: "stopped" };
  const el = h("section", { class: "card stage rise", "data-phase": done ? "done" : phase, style: delay(60) },
    a, bridge(tags[phase] || ""), b);
  return { el, a, b };
}

function arcFrames(stageEl, from, to, lift = 70) {
  const s = stageEl.getBoundingClientRect();
  const ra = from.getBoundingClientRect();
  const rb = to.getBoundingClientRect();
  return (tokenEl) => {
    const tw = tokenEl.offsetWidth;
    const th = tokenEl.offsetHeight;
    const ax = ra.left - s.left + ra.width / 2 - tw / 2;
    const ay = ra.top - s.top + ra.height / 2 - th / 2;
    const bx = rb.left - s.left + rb.width / 2 - tw / 2;
    const by = rb.top - s.top + rb.height / 2 - th / 2;
    const cx = (ax + bx) / 2;
    const cy = Math.min(ay, by) - lift;
    const frames = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
      const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
      const scale = 0.85 + Math.sin(t * Math.PI) * 0.2;
      const opacity = t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1;
      frames.push({ transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity, offset: t });
    }
    return frames;
  };
}

function flyToken(stageEl, from, to, label, { loop = false, duration = 1500 } = {}) {
  const framesFor = arcFrames(stageEl, from, to);
  const tokens = [0.18, 0.4, 1].map((strength, i) => {
    const el = h("div", { class: `token${strength < 1 ? " ghost" : ""}`, text: label });
    stageEl.append(el);
    const anim = el.animate(framesFor(el).map((f) => ({ ...f, opacity: f.opacity * strength })), {
      duration,
      delay: (2 - i) * 70,
      iterations: loop ? Infinity : 1,
      easing: "cubic-bezier(0.65, 0, 0.35, 1)",
      fill: "both",
    });
    if (!loop) anim.onfinish = () => el.remove();
    return anim;
  });
  return tokens[2].finished.catch(() => {});
}

function burst(stageEl, target) {
  const s = stageEl.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const cx = r.left - s.left + r.width / 2;
  const cy = r.top - s.top + r.height / 2;
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 90;
    const spark = h("span", {
      class: "spark",
      style: { left: `${cx}px`, top: `${cy}px`, background: i % 2 ? "#ffffff" : "#8e9299" },
    });
    stageEl.append(spark);
    spark.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0)`, opacity: 0 },
    ], { duration: 700 + Math.random() * 500, easing: "cubic-bezier(0.1, 0.7, 0.3, 1)" }).onfinish = () => spark.remove();
  }
}

function stageEffects(swap, stage) {
  if (swap.phase === "swapping") {
    flyToken(stage.el, stage.a, stage.b, swap.sourceName || "name", { loop: true, duration: 1400 });
    if (stage.c) flyToken(stage.el, stage.b, stage.c, swap.targetName || "name", { loop: true, duration: 1700 });
    return;
  }
  const result = swap.result;
  if (swap.phase !== "done" || !result?.accounts) return;
  const nameA = stage.a.querySelector(".slot-name");
  const nameB = stage.b.querySelector(".slot-name");
  const nameC = stage.c?.querySelector(".slot-name");
  if (result.tone === "bad") return;
  flyToken(stage.el, stage.a, stage.b, result.accounts.first.before, { duration: 1300 }).then(() => {
    if (!stage.el.isConnected) return;
    if (result.tone === "ok") {
      burst(stage.el, stage.b);
      scramble(nameB, result.accounts.second.after, { duration: 600 });
    }
  });
  if (stage.c && result.accounts.third && result.tone === "ok") {
    flyToken(stage.el, stage.b, stage.c, result.accounts.second.before, { duration: 1500 }).then(() => {
      if (!stage.el.isConnected) return;
      burst(stage.el, stage.c);
      scramble(nameC, result.accounts.third.after, { duration: 600 });
    });
  }
  scramble(nameA, result.accounts.first.after, { duration: 900, wait: 250 });
}

/* Swap: deck */

function idleDeck() {
  return h("section", { class: "card deck rise", style: delay(140) },
    h("h2", { text: "Move a display name" }),
    h("p", { class: "lede", text: "A swap moves one name onto a second account. A double swap does that and also keeps the second account's name by placing it on a third account." }),
    h("div", { class: "steps" },
      [
        ["01", "Swap: sign in to the account that has the name, then the account that should receive it."],
        ["02", "Double swap: also sign in to the account that should receive the second account's current name."],
        ["03", "Check the order, confirm the process, then hold to run it."],
      ].map(([n, text], i) => h("div", { class: "step rise", style: delay(220 + i * 80) },
        h("span", { class: "step-n", text: n }),
        h("p", { text })
      ))
    ),
    h("div", { class: "actions" },
      button("Start swap", { kind: "primary", trailing: "arrow", onClick: startSwap, magnet: true }),
      button("Double swap", { trailing: "arrow", onClick: startDouble, magnet: true })
    ),
    h("p", { class: "fine", text: "Epic allows a display name change about once every two weeks, so every account in the swap needs to be eligible. In a double swap, the third account's current name is replaced. Sign-ins used for a swap are not saved." })
  );
}

function codeDeck({ title, message, code, url, onCancel }) {
  const href = safeUrl(url);
  return h("section", { class: "card deck rise", style: delay(140) },
    h("div", { class: "waiting-line" }, h("span", { class: "eq" }, h("span"), h("span"), h("span")), code ? "Waiting for you to approve on Epic" : "Asking Epic for a code"),
    h("h2", { style: { marginTop: "10px" }, text: title }),
    h("p", { class: "lede", text: message || "Approve this code on Epic's site." }),
    code
      ? h("div", { class: "code" }, [...code].map((char, i) => h("span", {
        class: "tile",
        text: char,
        style: { animationDelay: `${i * 60}ms, ${900 + i * 90}ms` },
      })))
      : h("div", { class: "code-pending" }, Array.from({ length: 8 }, (_, i) => h("span", { class: "tile blank", style: delay(i * 90) }))),
    h("div", { class: "actions" },
      href ? button("Open Epic", { kind: "primary", iconName: "external", href, magnet: true }) : null,
      code ? button("Copy code", { iconName: "copy", onClick: () => copyText(code, "Code copied") }) : null,
      button("Cancel", { kind: "ghost", onClick: onCancel })
    ),
    h("p", { class: "fine", text: "Approve the code on Epic's site. This app never asks for your password." })
  );
}

function reviewDeck(swap) {
  return h("section", { class: "card deck rise", style: delay(140) },
    h("h2", { text: "Check the order" }),
    h("p", { class: "lede", text: `Target: ${swap.sourceName} → Destination: ${swap.targetName}. Second user: ${swap.targetName} → Destination: ${swap.thirdName}.` }),
    h("p", { class: "lede", text: "Check that these are the accounts you signed in to, and that this order is right. Nothing changes on this step." }),
    h("div", { class: "actions" },
      holdButton("Hold to confirm order", () => act("/api/swap/confirm")),
      button("Cancel", { kind: "ghost", onClick: () => act("/api/swap/cancel") })
    )
  );
}

function confirmDeck(swap) {
  if (swap.mode === "double") {
    return h("section", { class: "card deck rise", style: delay(140) },
      h("h2", {}, "Move ", h("span", { class: "grad-text", text: swap.sourceName }), ` to ${swap.targetName}, then ${swap.targetName} to ${swap.thirdName}?`),
      h("p", { class: "lede", text: `${swap.sourceName} changes to a random name. ${swap.targetName} takes ${swap.sourceName}, which frees ${swap.targetName}. ${swap.thirdName} takes that freed name, and ${swap.thirdName} is replaced. Nothing changes until you hold the button.` }),
      h("p", { class: "lede", text: "Use this at your own risk. We are not responsible for lost names. Hold the button only if you want to do this." }),
      h("div", { class: "actions" },
        holdButton("Hold to confirm", () => act("/api/swap/confirm")),
        button("Cancel", { kind: "ghost", onClick: () => act("/api/swap/cancel") })
      ),
      h("p", { class: "fine", text: "All three accounts need to be eligible. Epic allows a display name change about once every two weeks. The third account's current name is replaced." })
    );
  }
  return h("section", { class: "card deck rise", style: delay(140) },
    h("h2", {}, "Move ", h("span", { class: "grad-text", text: swap.sourceName }), ` to ${swap.targetName || "the second account"}?`),
    h("p", { class: "lede", text: `${swap.sourceName} will be changed to a random 16-character name, then ${swap.targetName || "the second account"} takes ${swap.sourceName}. Nothing changes until you hold the button.` }),
    h("div", { class: "actions" },
      holdButton("Hold to swap names", () => act("/api/swap/confirm")),
      button("Cancel", { kind: "ghost", onClick: () => act("/api/swap/cancel") })
    ),
    h("p", { class: "fine", text: "Epic allows a display name change about once every two weeks. Both accounts need to be eligible." })
  );
}

function swappingDeck(swap) {
  const double = swap?.mode === "double";
  return h("section", { class: "card deck rise", style: delay(140) },
    h("h2", { text: double ? "Double swapping" : "Swapping names" }),
    h("p", { class: "lede", text: double
      ? "Releasing the first name, moving it onto the second account, then placing the freed name on the third. Leave this window open."
      : "Releasing the name from the first account and claiming it on the second. This takes a few seconds, so leave this window open." }),
    h("div", { class: "progress" })
  );
}

function resultIcon(tone) {
  const paths = { ok: ["M5 12.5l4.5 4.5L19 7.5"], warn: ["M12 6v8", "M12 18v.5"], bad: ["M7 7l10 10", "M17 7L7 17"] }[tone];
  return h("div", { class: `badge-icon ${tone}` },
    svg("svg", { viewBox: "0 0 24 24" }, ...paths.map((d) => svg("path", { d, pathLength: "1" }))));
}

function resultDeck(result, fallbackError) {
  const tone = result?.tone || "bad";
  const lines = result?.lines || [fallbackError || "Something went wrong."];
  const timing = result?.gap ? h("strong", {}) : null;
  if (timing) scramble(timing, result.gap, { duration: 900, wait: 300, glyphs: "0123456789" });
  return h("section", { class: "card deck rise", style: delay(140) },
    h("div", { class: "result-head" },
      resultIcon(tone),
      h("div", {},
        h("h2", { text: result?.title || "Swap stopped" }),
        h("p", { class: "lede", style: { marginTop: "2px" }, text: tone === "ok"
          ? (result?.accounts?.third ? "The three accounts were updated." : "Both accounts were updated.")
          : "Read the details below before trying again." })
      ),
      timing ? h("div", { class: "timing" }, h("span", { class: "label", text: "Between changes" }), timing) : null
    ),
    h("ul", { class: "lines" }, lines.map((line, i) => h("li", { class: "rise", text: line, style: delay(300 + i * 90) }))),
    h("div", { class: "actions" },
      result?.accounts?.third
        ? button("Start another double swap", { kind: "primary", trailing: "arrow", onClick: startDouble, magnet: true })
        : button(result ? "Start another swap" : "Start again", { kind: "primary", trailing: "arrow", onClick: startSwap, magnet: true }),
      result?.accounts?.third ? button("Single swap", { kind: "ghost", onClick: startSwap }) : null
    )
  );
}

function paintSwap() {
  const swap = latest.swap;
  const key = JSON.stringify(swap) + clientError;
  if (key === swapKey) return;
  swapKey = key;

  const stage = buildStage(swap);
  let deck;
  if (swap.phase === "source" || swap.phase === "target" || swap.phase === "third") {
    const titles = {
      source: "Sign in to the account that has the name",
      target: "Sign in to the account that receives it",
      third: "Sign in to the account that keeps the other name",
    };
    deck = codeDeck({
      title: titles[swap.phase],
      message: swap.message,
      code: swap.code,
      url: swap.url,
      onCancel: () => act("/api/swap/cancel"),
    });
  } else if (swap.phase === "review") deck = reviewDeck(swap);
  else if (swap.phase === "confirm") deck = confirmDeck(swap);
  else if (swap.phase === "swapping") deck = swappingDeck(swap);
  else if (swap.phase === "done" && swap.result) deck = resultDeck(swap.result);
  else if (swap.phase === "error") deck = resultDeck(null, swap.error);
  else deck = idleDeck();

  const double = swap.mode === "double" && swap.phase !== "idle";
  panel.replaceChildren(h("div", { class: "view" },
    head(
      double
        ? h("span", {}, "Double ", h("span", { class: "grad-text", text: "swap" }))
        : h("span", {}, "Swap ", h("span", { class: "grad-text", text: "names" })),
      double
        ? "Three sign-ins. The first name moves to the second account, and that account's name moves to the third."
        : "Two sign-ins, one confirmation, and the name moves across."
    ),
    notice(clientError),
    stage.el,
    deck
  ));
  requestAnimationFrame(() => stageEffects(swap, stage));
}

function paintAccount() {
  const login = latest.sessionLogin;
  const session = latest.session;
  const key = JSON.stringify({ login, session, clientError });
  if (key === accountKey) return;
  accountKey = key;
  const waiting = login.active || login.phase === "waiting";

  const nodes = [
    head("Account", "The Lookup tab uses one Epic account saved on this computer. Swap sign-ins are separate and never saved."),
    notice(clientError),
    notice(login.error),
  ];
  if (login.message && !waiting) nodes.push(h("div", { class: "notice info rise" }, icon("check"), h("span", { text: login.message })));
  if (waiting) {
    nodes.push(codeDeck({
      title: "Sign in to your lookup account",
      message: login.message,
      code: login.code,
      url: login.url,
      onCancel: () => act("/api/session/cancel"),
    }));
  } else {
    nodes.push(accountCard(session));
    nodes.push(h("div", { class: "notes" },
      [
        ["shield", "No passwords", "You approve a code on Epic's site. The app never sees your password."],
        ["folder", "Stays on this computer", "The sign-in lives in the data folder next to the app. Do not share that folder."],
        ["logout", "Sign out any time", "Signing out also removes the saved device sign-in from Epic."],
      ].map(([name, title, text], i) => h("div", { class: "note rise", style: delay(160 + i * 80) },
        icon(name),
        h("strong", { text: title }),
        h("p", { text })
      ))
    ));
    nodes.push(h("p", { class: "fine", text: "Replacing a sign-in removes the saved one before the new code appears." }));
  }
  panel.replaceChildren(h("div", { class: "view" }, ...nodes));
}

/* Lookup */

function paintLookupNotice() {
  const slot = document.getElementById("lookup-notice");
  if (!slot) {
    paintLookup();
    return;
  }
  const session = latest.session;
  const key = String(session.signedIn);
  if (slot.dataset.key === key) return;
  slot.dataset.key = key;
  slot.replaceChildren(...(session.signedIn ? [] : [
    h("div", { class: "notice info rise" },
      icon("user"),
      h("span", { text: "Sign in on the Account tab first. Lookup searches with that saved account." }),
      button("Open Account", { kind: "small", onClick: () => setView("account") })
    ),
  ]));
}

function paintLookup() {
  const input = h("input", {
    id: "name-input",
    maxlength: "36",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "Display name or account id",
    "aria-label": "Display name or account id",
    oninput: (event) => {
      lookupQuery = event.currentTarget.value;
    },
  });
  input.value = lookupQuery;
  panel.replaceChildren(h("div", { class: "view" },
    head("Lookup", "See the public profile behind a display name or account id, including every linked account Epic returns."),
    h("div", { id: "lookup-notice" }),
    h("form", { class: "search rise", style: delay(80), onsubmit: search },
      h("div", { class: "search-inner" },
        icon("search"),
        input,
        button("Search", { kind: "primary", type: "submit", trailing: "arrow" })
      )
    ),
    h("div", { id: "lookup-result", class: "results" })
  ));
  paintLookupNotice();
  paintLookupResult();
  input.focus();
}

function linkedRow(entry, i) {
  const bits = [];
  if (entry.name) bits.push(entry.name);
  for (const item of entry.ids || []) {
    if (item?.id) bits.push(!item.type || item.type === "id" ? item.id : `${item.type}: ${item.id}`);
  }
  if (entry.region) bits.push(entry.region);
  const when = formatWhen(entry.linkedAt);
  return h("div", { class: "list-row rise", style: delay(200 + i * 50) },
    h("div", { class: "platform", text: initials(entry.platform) }),
    h("div", { class: "row-main" },
      h("strong", { text: entry.platform || "Linked account" }),
      bits.length ? h("span", { text: bits.join(" · ") }) : null
    ),
    when ? h("span", { class: "row-side", text: `Linked ${when}` }) : null
  );
}

function linkRow(entry, i) {
  const href = safeUrl(entry.url);
  const kids = [
    h("div", { class: "platform" }, icon("link")),
    h("div", { class: "row-main" },
      h("strong", { text: entry.label || "Link" }),
      h("span", { text: [entry.name, href].filter(Boolean).join(" · ") })
    ),
    href ? h("span", { class: "row-side" }, icon("external")) : null,
  ];
  return href
    ? h("a", { class: "list-row rise", href, target: "_blank", rel: "noopener noreferrer", style: delay(200 + i * 50) }, kids)
    : h("div", { class: "list-row rise", style: delay(200 + i * 50) }, kids);
}

function paintLookupResult() {
  const slot = document.getElementById("lookup-result");
  if (!slot) return;
  if (lookupBusy) {
    slot.replaceChildren(h("div", { class: "card profile" },
      h("div", { class: "avatar", style: { background: "var(--surface-2)" } }),
      h("div", { class: "profile-main" },
        h("div", { class: "skeleton", style: { width: "40%", height: "22px", marginTop: "0" } }),
        h("div", { class: "skeleton", style: { width: "65%" } })
      )
    ));
    return;
  }
  if (lookupError) {
    slot.replaceChildren(notice(lookupError));
    return;
  }
  const info = lookupProfile;
  if (!info) {
    slot.replaceChildren(h("div", { class: "card empty-state rise", style: delay(140) },
      icon("search"),
      h("strong", { text: "Search for a display name or account id" }),
      h("p", { text: "Results show the account id, when the profile started, name changes, and linked platforms." })
    ));
    return;
  }
  if (!info.found) {
    slot.replaceChildren(h("div", { class: "card empty-state rise" },
      icon("x"),
      h("strong", { text: `No profile for ${info.name || "that name"}` }),
      h("p", { text: info.error || "No Epic profile uses that display name." })
    ));
    return;
  }

  const name = info.publicName || info.name || "Profile";
  const facts = [];
  const started = formatWhen(info.created);
  if (started) facts.push(["Started", started]);
  const changed = formatWhen(info.lastDisplayNameChange);
  if (changed) facts.push(["Last name change", changed]);
  if (info.displayNameChanges != null) facts.push(["Name changes", String(info.displayNameChanges)]);
  if (info.country) facts.push(["Country", info.country]);
  if (info.language) facts.push(["Language", info.language]);

  const linked = info.linked || [];
  const links = info.links || [];
  const nameEl = scramble(h("h2", { class: "profile-name" }), name, { duration: 700 });

  slot.replaceChildren(h("div", {},
    h("section", { class: "card profile rise" },
      avatar(name),
      h("div", { class: "profile-main" },
        nameEl,
        info.accountId ? h("div", { class: "id-row" },
          h("span", { text: info.accountId }),
          button("", { kind: "ghost small icon-only", iconName: "copy", onClick: () => copyText(info.accountId, "Account id copied") })
        ) : null
      )
    ),
    facts.length ? h("div", { class: "facts" }, facts.map(([label, value], i) => {
      const valueEl = h("strong", {});
      scramble(valueEl, value, { duration: 600, wait: 120 + i * 80 });
      return h("div", { class: "fact rise", style: delay(100 + i * 60) }, h("span", { class: "label", text: label }), valueEl);
    })) : null,
    h("div", { class: "section-title rise", style: delay(160) },
      h("span", { class: "label", text: "Linked accounts" }),
      h("span", { class: "count-pill", text: String(linked.length) })
    ),
    linked.length
      ? h("div", { class: "card list" }, linked.map((entry, i) => linkedRow(entry, i)))
      : h("p", { class: "muted", text: "Epic did not list any linked accounts for this profile." }),
    links.length ? h("div", { class: "section-title rise" }, h("span", { class: "label", text: "Links" })) : null,
    links.length ? h("div", { class: "card list" }, links.map((entry, i) => linkRow(entry, i))) : null
  ));
}

/* Actions */

async function act(path, body) {
  clientError = "";
  try {
    apply(await api(path, body || {}));
  } catch (error) {
    clientError = error.message || "Request failed.";
    toast(clientError, "bad");
    swapKey = "";
    accountKey = "";
    paint();
  }
}

async function startSwap() {
  clientError = "";
  try {
    if (view !== "swap") setView("swap");
    apply(await api("/api/swap/start", {}));
  } catch (error) {
    clientError = error.message || "Could not start the swap.";
    swapKey = "";
    paint();
  }
}

async function startDouble() {
  clientError = "";
  try {
    if (view !== "swap") setView("swap");
    apply(await api("/api/swap/double", {}));
  } catch (error) {
    clientError = error.message || "Could not start the double swap.";
    swapKey = "";
    paint();
  }
}

async function startSession(force) {
  clientError = "";
  try {
    apply(await api("/api/session/start", { force }));
  } catch (error) {
    clientError = error.message || "Could not start sign-in.";
    accountKey = "";
    paint();
  }
}

async function search(event) {
  event.preventDefault();
  const name = document.getElementById("name-input")?.value.trim() || "";
  lookupError = "";
  lookupProfile = null;
  lookupBusy = true;
  paintLookupResult();
  try {
    const data = await api("/api/lookup", { name });
    lookupProfile = data.profile;
  } catch (error) {
    lookupError = error.message || "Could not load that profile.";
  } finally {
    lookupBusy = false;
    paintLookupResult();
  }
}

async function poll() {
  try {
    apply(await api("/api/state"));
  } catch {
    offline.hidden = false;
  }
}

/* Start animation */

function playIntro() {
  const intro = document.getElementById("intro");
  const word = document.getElementById("intro-word");
  const letters = [..."Epic Swapper"];
  letters.forEach((char, i) => {
    const t = i / (letters.length - 1);
    const shade = Math.round(255 - t * 110);
    word.append(h("span", {
      text: char === " " ? "\u00a0" : char,
      style: { animationDelay: `${650 + i * 45}ms`, color: `rgb(${shade} ${shade} ${Math.min(255, shade + 8)})` },
    }));
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    intro.classList.add("leaving");
    document.body.classList.remove("booting");
    swapKey = "";
    accountKey = "";
    panel.replaceChildren();
    paint();
    setTimeout(() => intro.remove(), 1300);
  };
  const timer = setTimeout(finish, 2600);
  intro.addEventListener("pointerdown", finish);
  window.addEventListener("keydown", finish, { once: true });
}

/* Start */

window.addEventListener("resize", moveIndicator);

for (const btn of document.querySelectorAll(".rail-btn")) {
  btn.addEventListener("click", () => setView(btn.dataset.view));
  ripple(btn);
}
statusButton.addEventListener("click", () => setView("account"));

startCursor();
playIntro();
moveIndicator();

if (!window.desktop) {
  offline.hidden = false;
  offline.textContent = "Open Epic Swapper.exe. This screen does not run in a browser.";
} else {
  paint();
  poll();
  setInterval(poll, 1000);
}
