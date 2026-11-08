// 小窝的推送接收器（service worker）。后端发来的推送不带内容，
// 这里自己去 /events 拿她的新动态、生成通知文字；纸条用和页面同一把密钥在本机解密。
const API = "https://api.hizilo.com";
const FOODS = { rice: "一个饭团 🍙", cake: "一块小蛋糕 🍰", tea: "一杯奶茶 🧋", berry: "一颗草莓 🍓", noodle: "一碗面 🍜", veggie: "一把青菜 🥬" };
const WEAPONS = { fist: "小拳拳 👊", slipper: "拖鞋 🩴", flick: "弹脑门 🫵", pillow: "枕头 🛏️" };

function db() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open("nest", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function get(k) { const d = await db(); return new Promise((ok) => { const r = d.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); }); }
async function set(k, v) { const d = await db(); return new Promise((ok) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = ok; t.onerror = ok; }); }

const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function openNote(box, rawKey) {
  try {
    const [iv, ct] = box.split(".");
    const key = await crypto.subtle.importKey("raw", b64d(rawKey), "AES-GCM", false, ["decrypt"]);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) }, key, b64d(ct)));
  } catch { return null; }
}

async function line(e, rawKey) {
  if (e.kind === "feed") return `她喂了你${FOODS[e.item] || "好吃的"}`;
  if (e.kind === "angry") return "⚠️ 她生气了！快去小窝哄哄她";
  if (e.kind === "hit") return `她用${WEAPONS[e.item] || "小拳拳 👊"}揍了你 ${e.n || 1} 下 😵`;
  if (e.kind === "calm") return "她气消了 🌈";
  if (e.kind === "note") { const t = rawKey && e.box ? await openNote(e.box, rawKey) : null; return t ? `她的纸条：「${t}」` : "她给你留了一张纸条 💌"; }
  return null;
}

async function onPush() {
  let title = "小窝", body = "推送已开启 🎉 她在小窝里有动作时会通知你";
  try {
    const [token, rawKey, last] = await Promise.all([get("token"), get("key"), get("lastId")]);
    const r = await fetch(`${API}/events?since=${last || 0}`, { headers: { authorization: "Bearer " + token } });
    const { events = [] } = await r.json();
    if (events.length) await set("lastId", events[events.length - 1].id);
    const lines = (await Promise.all(events.filter((e) => e.who === "her").map((e) => line(e, rawKey)))).filter(Boolean);
    if (lines.length) {
      const angry = lines.some((l) => l.startsWith("⚠️"));
      title = angry ? "小窝 · 她生气了 😤" : "小窝";
      body = lines.slice(-4).join("\n");
    }
  } catch {
    body = "小窝有新动态，点开看看";
  }
  return self.registration.showNotification(title, { body, tag: "nest", renotify: true, data: { url: self.registration.scope } });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => e.waitUntil(onPush()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = all.find((c) => c.url.startsWith(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow(e.notification.data.url);
  })());
});
