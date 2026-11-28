// 收线小游戏（v17 钓鱼大赛）：右边一根竖条，鱼在里面上下游；按住（屏幕任意处 / 空格）绿条往上，松开往下掉。
// 鱼在绿条里，右边的进度就涨；涨满鱼就上来了，掉到 0 鱼就跑了。故意做得宽松（绿条宽、鱼慢、进度涨得快）。
// window.NEST_REEL.play({ diff, sweet, quick, n, king }) → Promise<{ ok, q, perfect }>
//   q：鱼待在绿条里的时间比例（0..1），后端拿它定鱼的大小；perfect：开头 0.6 秒以后一次都没出过绿条
(() => {
  const R = {
    common: { speed: 0.35, jump: 1.6 }, rare: { speed: 0.5, jump: 1.25 }, epic: { speed: 0.65, jump: 1.0 }, legend: { speed: 0.8, jump: 0.85 }, king: { speed: 0.9, jump: 0.75 },
    zone: 0.34, sweetZone: 0.09, start: 0.3, quickStart: 0.15, fill: 0.36, drain: 0.2, maxSec: 14,
  };
  const LABEL = { common: "普通", rare: "稀有", epic: "史诗", legend: "传说", king: "鱼王" };
  const COLOR = { common: "#8d99a6", rare: "#2f8fd8", epic: "#9b59d0", legend: "#e0a000", king: "#e0452d" };
  let running = false;

  function play(o = {}) {
    if (running) return Promise.resolve({ ok: false, q: 0, perfect: false });
    running = true;
    const P = R[o.diff] || R.common;
    const zone = R.zone + (o.sweet ? R.sweetZone : 0) - (o.king ? 0.04 : 0);
    const el = document.createElement("div");
    el.className = "reel" + (o.king ? " king" : "");
    el.innerHTML = `<div class="reel-box">
      <p class="reel-t"><b style="color:${COLOR[o.diff] || "#888"}">${LABEL[o.diff] || ""}${o.n > 1 ? " ×2" : ""}</b> 按住收线！</p>
      <div class="reel-row"><div class="reel-track"><i class="reel-zone"></i><span class="reel-fish">${o.king ? "👑" : "🐟"}</span></div>
      <div class="reel-prog"><i></i></div></div>
      <p class="reel-h">按住任意处 ↑ · 松开 ↓</p></div>`;
    document.body.appendChild(el);
    const zEl = el.querySelector(".reel-zone"), fEl = el.querySelector(".reel-fish"), pEl = el.querySelector(".reel-prog i"), box = el.querySelector(".reel-box");
    zEl.style.height = zone * 100 + "%";
    let hold = false;
    const down = (e) => { hold = true; e.preventDefault(); }, up = () => { hold = false; };
    const kd = (e) => { if (e.code === "Space") { hold = true; e.preventDefault(); } }, ku = (e) => { if (e.code === "Space") hold = false; };
    el.addEventListener("pointerdown", down); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    addEventListener("keydown", kd); addEventListener("keyup", ku);

    let zp = 0.05, zv = 0, fp = 0.5, ft = 0.5, fv = 0, nextJump = 0.4, prog = R.start + (o.quick ? R.quickStart : 0);
    let t = 0, tin = 0, outAfterGrace = 0, last = performance.now(), wasIn = true;
    return new Promise((resolve) => {
      function end(ok) {
        running = false;
        removeEventListener("pointerup", up); removeEventListener("pointercancel", up); removeEventListener("keydown", kd); removeEventListener("keyup", ku);
        box.classList.add(ok ? "won" : "lost");
        setTimeout(() => el.remove(), ok ? 380 : 650);
        resolve({ ok, q: Math.max(0, Math.min(1, t ? tin / t : 0)), perfect: ok && outAfterGrace < 0.15 });
      }
      function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
        // 绿条：按住加速往上，松开往下掉，撞到两头就停
        zv += (hold ? 2.3 : -2.0) * dt; zv = Math.max(-1.3, Math.min(1.3, zv));
        zp += zv * dt;
        if (zp < 0) { zp = 0; zv = Math.max(0, zv); } if (zp > 1 - zone) { zp = 1 - zone; zv = Math.min(0, zv); }
        // 鱼：隔一会儿换个目标位置，平滑地游过去
        nextJump -= dt;
        if (nextJump <= 0) { ft = 0.06 + Math.random() * 0.88; nextJump = P.jump * (0.6 + Math.random() * 0.8); }
        const want = Math.max(-P.speed, Math.min(P.speed, (ft - fp) * 3));
        fv += (want - fv) * Math.min(1, dt * 5);
        fp = Math.max(0.03, Math.min(0.97, fp + fv * dt));
        const inZ = fp >= zp && fp <= zp + zone;
        if (inZ) tin += dt; else if (t > 0.6) outAfterGrace += dt;
        prog += (inZ ? R.fill : -R.drain) * dt;
        if (inZ !== wasIn) { box.classList.toggle("out", !inZ); wasIn = inZ; }
        zEl.style.bottom = zp * 100 + "%";
        fEl.style.bottom = `calc(${fp * 100}% - 12px)`;
        pEl.style.height = Math.max(0, Math.min(1, prog)) * 100 + "%";
        pEl.style.background = prog > 0.66 ? "#5cc96b" : prog > 0.33 ? "#f2c14e" : "#ef6b5b";
        if (prog >= 1) return end(true);
        if (prog <= 0) return end(false);
        if (t >= R.maxSec) return end(prog >= 0.5);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame((n) => { last = n; frame(n); });
    });
  }
  window.NEST_REEL = { play, active: () => running };
})();
