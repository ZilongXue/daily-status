// 沉浸模式（v16）：小岛铺满屏幕。竖屏时下面的面板变成可以上下拉的抽屉（平时只露出一排操作 + 标签），
// 横屏时面板放到右边一栏。选择记在这台设备上，下次打开直接是沉浸模式；手机上进入时顺便请求系统全屏（安卓 Chrome 能藏掉地址栏）。
(() => {
  const KEY = "nest.view";
  const $ = (q) => document.querySelector(q);
  const body = document.body, scene = $("#scene"), social = $("#social"), main = $("#social-main");
  if (!scene || !social || !main) return;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const land = matchMedia("(orientation: landscape)");

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "view-btn"; btn.id = "view-btn";
  scene.appendChild(btn);
  const handle = document.createElement("div");
  handle.className = "sheet-handle"; handle.innerHTML = "<i></i><span></span>";
  main.prepend(handle);

  let manual = null, raf = 0;
  const on = () => body.classList.contains("immersive");
  // 有面板 / 表情托盘 / 写纸条打开时抽屉自动拉起来；用户自己拉过就听用户的，直到面板开关又变了
  const wantOpen = () => (manual ? manual === "open" : !!main.querySelector(".panel:not([hidden]), #tray:not([hidden]), #note-form:not([hidden])") || ($("#who-pick") && !$("#who-pick").hidden));
  function layout() {
    raf = 0;
    if (!on()) return;
    if (land.matches) { body.classList.remove("sheet-peek"); body.style.removeProperty("--sheet"); return; }
    const open = wantOpen();
    body.classList.toggle("sheet-peek", !open);
    let h;
    if (open) h = Math.round(innerHeight * 0.58);
    else {
      social.scrollTop = 0;
      const tabs = $("#tabs");
      h = tabs.offsetTop + tabs.offsetHeight + parseFloat(getComputedStyle(social).paddingBottom || 0) + 4;
    }
    handle.querySelector("span").textContent = open ? "收起 ▾" : "展开 ▴";
    body.style.setProperty("--sheet", Math.max(90, Math.min(h, innerHeight - 160)) + "px");
  }
  const relayout = () => { if (!raf) raf = requestAnimationFrame(layout); };

  function setMode(want, user) {
    body.classList.toggle("immersive", want);
    store.set(KEY, want ? "1" : "0");
    btn.textContent = want ? "⤡" : "⛶";
    btn.title = want ? "退出全屏" : "全屏看小岛";
    if (want) {
      manual = null;
      scrollTo(0, 0);
      layout();
      const de = document.documentElement;
      if (user && de.requestFullscreen && !document.fullscreenElement && matchMedia("(pointer: coarse)").matches) de.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    } else {
      body.classList.remove("sheet-peek");
      body.style.removeProperty("--sheet");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (user) scene.scrollIntoView({ block: "start" });
    }
    dispatchEvent(new CustomEvent("nest:view", { detail: { immersive: want } }));
  }
  btn.addEventListener("click", () => setMode(!on(), true));

  // 抽屉：点一下把手切换；往上 / 往下划也行
  let downY = null;
  handle.addEventListener("pointerdown", (e) => { downY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointerup", (e) => {
    if (downY == null) return;
    const dy = e.clientY - downY; downY = null;
    const open = wantOpen();
    manual = dy > 24 ? "peek" : dy < -24 ? "open" : open ? "peek" : "open";
    layout();
  });

  new MutationObserver((recs) => {
    if (recs.some((r) => r.type === "attributes" && r.target.matches(".panel, #tray, #note-form, #who-pick"))) manual = null;
    relayout();
  }).observe(social, { attributes: true, attributeFilter: ["hidden"], subtree: true, childList: true });
  addEventListener("resize", relayout);
  land.addEventListener("change", relayout);

  window.NEST_VIEW = { set: (v) => setMode(!!v, true), immersive: on, layout: relayout };
  setMode(store.get(KEY) === "1", false);
})();
