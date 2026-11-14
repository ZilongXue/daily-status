// 小窝实时通道客户端（经典脚本，不是模块；没有依赖）。连接 Worker 的 /rt（Durable Object「Room」）。
//
// 用法：
//   NEST_RT.connect({ url: "wss://api.hizilo.com/rt", token: "<64 位十六进制>", who: "me" | "her" });
//   NEST_RT.on("pos", (m) => ...)       // 对方的小人走到 (m.x, m.z)：{ t, who, x, z }
//   NEST_RT.on("act", (m) => ...)       // 对方的临时动作：{ t, who, kind, item }
//   NEST_RT.on("ev", (m) => ...)        // 有新的写入：{ t, who, kind, id } → 马上拉一次 /events
//   NEST_RT.on("presence", (online) => ...)  // { me: bool, her: bool }，有人第一个连接上线 / 最后一个连接下线
//   NEST_RT.on("welcome", (m) => ...)   // 认证成功：{ t, online }
//   NEST_RT.on("open", () => ...)       // 已连上并认证（在 welcome 之后触发）。断线重连后也会触发，适合补拉一次 /events
//   NEST_RT.on("close", (info) => ...)  // 连接断了：{ code, reason, wasConnected, retryIn }（retryIn = 多少毫秒后重连，null = 不重连）
//   NEST_RT.sendPos(x, z)               // 我的小人走到某点；节流到每秒最多 8 次，总会把最新的点补发出去
//   NEST_RT.sendAct(kind, item)         // 临时动作，kind 是 [a-z_]{1,16}，item 最多 24 个字符（可省略）
//   NEST_RT.connected                   // 是否已连上并认证
//   NEST_RT.online                      // 最近一次知道的在线状态 { me, her }
//   NEST_RT.off(type, fn) / NEST_RT.disconnect()
//
// 令牌不进 URL：连上以后第一条消息发 {"t":"auth",...}，服务器 5 秒内收不到或校验失败会以 4001 关闭。
// 断线自动重连：1 秒起指数退避，最长 30 秒，带随机抖动；页面在后台（document.hidden）时暂停重连，
// 回到前台立刻重连。心跳：每 25 秒发一次 ping，10 秒内没收到 pong 就认为连接已死，重连。
// 这条通道只是"加速"：所有真正的数据仍然以 /events 轮询为准，通道断了页面照常工作。
(function () {
  "use strict";

  var PING_EVERY = 25000;     // 心跳间隔
  var PONG_WAIT = 10000;      // 等 pong 的时间
  var OPEN_WAIT = 10000;      // 从开始连接到收到 welcome 的最长时间
  var BACKOFF_MIN = 1000;
  var BACKOFF_MAX = 30000;
  var POS_GAP = 125;          // sendPos 最小间隔（每秒最多 8 次）
  var MAX_4001 = 5;           // 连续这么多次被 4001 拒绝（令牌错）就不再重连，等页面重新 connect()
  var PING = '{"t":"ping"}';  // 必须一字不差：服务器端由运行时自动回 pong，不唤醒 DO
  var KIND_RE = /^[a-z_]{1,16}$/;
  var TYPES = ["open", "close", "pos", "act", "ev", "presence", "welcome"];

  var opts = null;            // { url, token, who }
  var ws = null;              // 当前的 WebSocket（可能还在连接 / 认证中）
  var connected = false;      // 已认证
  var online = { me: false, her: false };
  var handlers = {};
  var attempt = 0;            // 连续失败次数（决定退避时长）
  var rejects = 0;            // 连续 4001 次数
  var stopped = true;         // disconnect() 之后不再重连
  var retryTimer = null, pingTimer = null, pongTimer = null, openTimer = null;
  var waitingVisible = false; // 因为页面在后台而暂停的重连
  var lastPos = null;         // 我最后一次的位置 {x, z}
  var posSentAt = 0, posTimer = null, posPending = false;

  TYPES.forEach(function (t) { handlers[t] = []; });

  function emit(type, arg) {
    var list = (handlers[type] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](arg); } catch (e) { console.error("[NEST_RT] " + type + " handler:", e); }
    }
  }

  function clearTimers() {
    clearTimeout(retryTimer); retryTimer = null;
    clearInterval(pingTimer); pingTimer = null;
    clearTimeout(pongTimer); pongTimer = null;
    clearTimeout(openTimer); openTimer = null;
  }

  function hidden() { return typeof document !== "undefined" && document.hidden; }

  function rawSend(s) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(s); return true; } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- 建立连接
  function open() {
    clearTimers();
    waitingVisible = false;
    if (stopped || !opts) return;
    if (hidden()) { waitingVisible = true; return; } // 后台不连，等 visibilitychange
    var sock;
    try { sock = new WebSocket(opts.url); } catch (e) { scheduleRetry(null, "", false); return; }
    ws = sock;
    // 连不上 / 迟迟没有 welcome：当作失败处理
    openTimer = setTimeout(function () { if (ws === sock && !connected) drop(sock, 4000, "open timeout"); }, OPEN_WAIT);

    var sockOpened = false;
    sock.onopen = function () {
      sockOpened = true;
      if (ws !== sock) return;
      // 第一条消息就是认证；令牌只走消息体，不进 URL
      try { sock.send(JSON.stringify({ t: "auth", token: opts.token, who: opts.who })); } catch (e) {}
    };
    sock.onmessage = function (e) {
      if (ws !== sock) return;
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || typeof m.t !== "string") return;
      onMessage(sock, m);
    };
    sock.onclose = function (e) {
      if (ws !== sock) return; // 已经被我们主动换掉的旧连接
      ended(e.code, e.reason || "");
    };
    // 浏览器在 error 之后一定会再发 close，正常在 onclose 里处理；但有的实现（比如 Node 的 undici）
    // 握手失败时只发 error 不发 close
    // （undici 甚至一直停在 CONNECTING），所以：还没 open 就出错 = 连接失败；或者已经 CLOSED 了，都直接走断线流程。
    sock.onerror = function () {
      setTimeout(function () { if (ws === sock && (!sockOpened || sock.readyState === 3)) ended(1006, "error"); }, 0);
    };
  }

  function onMessage(sock, m) {
    switch (m.t) {
      case "welcome":
        clearTimeout(openTimer); openTimer = null;
        connected = true;
        attempt = 0; rejects = 0;
        if (m.online) online = normOnline(m.online);
        startHeartbeat(sock);
        emit("welcome", m);
        emit("open");
        if (lastPos) queuePos(); // 重连后把我当前的位置再告诉对方
        break;
      case "pong":
        clearTimeout(pongTimer); pongTimer = null;
        break;
      case "presence": {
        var prev = online;
        online = normOnline(m.online);
        emit("presence", online);
        // 对方刚上线：把我最后的位置补发一次，对方一进来就能看到我站在哪
        var other = opts && opts.who === "me" ? "her" : "me";
        if (!prev[other] && online[other] && lastPos) queuePos();
        break;
      }
      case "pos":
        if (typeof m.x === "number" && typeof m.z === "number") emit("pos", m);
        break;
      case "act":
      case "ev":
        emit(m.t, m);
        break;
    }
  }

  function normOnline(o) { return { me: !!(o && o.me), her: !!(o && o.her) }; }

  // ---------------------------------------------------------------- 心跳
  function startHeartbeat(sock) {
    clearInterval(pingTimer);
    pingTimer = setInterval(function () { ping(sock); }, PING_EVERY);
  }
  function ping(sock) {
    if (ws !== sock || pongTimer) return; // 上一个 ping 还在等，不重复发
    if (!rawSend(PING)) return;
    pongTimer = setTimeout(function () {
      pongTimer = null;
      if (ws === sock) drop(sock, 4000, "pong timeout"); // 半死的连接（常见于手机切后台 / 换网络）
    }, PONG_WAIT);
  }

  // 主动丢弃一个连接并按断线流程处理（不等关闭握手，它可能永远不来）
  function drop(sock, code, reason) {
    try { sock.close(); } catch (e) {}
    if (ws === sock) ended(code, reason);
  }

  // ---------------------------------------------------------------- 断线 + 重连
  function ended(code, reason) {
    var was = connected;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; }
    ws = null;
    connected = false;
    clearTimers();
    if (code === 4001) rejects++; else if (was) rejects = 0;
    scheduleRetry(code, reason, was);
  }

  function scheduleRetry(code, reason, was) {
    var retryIn = null;
    if (!stopped && rejects < MAX_4001) {
      // 4001 = 令牌错或认证超时：直接用最长的等待，别狂敲服务器
      var base = code === 4001 ? BACKOFF_MAX : Math.min(BACKOFF_MAX, BACKOFF_MIN * Math.pow(2, attempt));
      retryIn = Math.round(Math.min(BACKOFF_MAX, base * (1 + Math.random() * 0.3))); // 抖动 0–30%，两个人的标签页不会同时撞上来
      attempt++;
      if (hidden()) waitingVisible = true; // 后台：不排定时器，回到前台再连
      else retryTimer = setTimeout(open, retryIn);
    }
    emit("close", { code: code, reason: reason, wasConnected: was, retryIn: hidden() ? null : retryIn });
  }

  // 回到前台：断着的话立刻重连（重置退避）；连着的话马上 ping 一次确认它还活着
  function onVisible() {
    if (hidden() || stopped || !opts) return;
    if (ws && ws.readyState === 1 && connected) { ping(ws); return; }
    if (ws) return; // 正在连接中
    if (waitingVisible || retryTimer) { attempt = 0; open(); }
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  // 网络恢复也立刻试一次
  if (typeof window !== "undefined") window.addEventListener("online", function () { if (!ws && !stopped && opts) { attempt = 0; open(); } });

  // ---------------------------------------------------------------- 位置（节流 + 补发最后一个点）
  function queuePos() {
    posPending = true;
    if (posTimer) return; // 已经排了一次补发
    var wait = posSentAt + POS_GAP - Date.now();
    if (wait <= 0) flushPos();
    else posTimer = setTimeout(function () { posTimer = null; flushPos(); }, wait);
  }
  function flushPos() {
    if (!posPending || !lastPos) return;
    if (!connected) return; // 没连上就不发；重连 welcome 时会再补发 lastPos
    if (rawSend(JSON.stringify({ t: "pos", x: lastPos.x, z: lastPos.z }))) { posPending = false; posSentAt = Date.now(); }
  }
  function clampCoord(v) { return Math.max(-9.999, Math.min(9.999, Math.round(v * 1000) / 1000)); }

  // ---------------------------------------------------------------- 对外接口
  var api = {
    connect: function (o) {
      if (!o || typeof o.url !== "string" || !/^[0-9a-f]{64}$/.test(o.token || "") || (o.who !== "me" && o.who !== "her"))
        throw new Error("NEST_RT.connect: need { url, token (64 hex), who: 'me'|'her' }");
      var same = opts && opts.url === o.url && opts.token === o.token && opts.who === o.who;
      opts = { url: o.url, token: o.token, who: o.who };
      stopped = false;
      rejects = 0;
      if (same && ws) return api; // 已经在连 / 已连上，同样的参数不重复连
      if (ws) { var old = ws; ws = null; connected = false; old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(1000, "reconnect"); } catch (e) {} }
      attempt = 0;
      open();
      return api;
    },
    disconnect: function () {
      stopped = true;
      clearTimers();
      clearTimeout(posTimer); posTimer = null;
      waitingVisible = false;
      if (ws) {
        var old = ws, was = connected;
        ws = null; connected = false;
        old.onopen = old.onmessage = old.onclose = old.onerror = null;
        try { old.close(1000, "bye"); } catch (e) {}
        emit("close", { code: 1000, reason: "disconnect", wasConnected: was, retryIn: null });
      }
    },
    // 返回一个取消订阅的函数
    on: function (type, fn) {
      if (!handlers[type]) throw new Error("NEST_RT.on: unknown type " + type);
      if (typeof fn === "function") handlers[type].push(fn);
      return function () { api.off(type, fn); };
    },
    off: function (type, fn) {
      var l = handlers[type];
      if (!l) return;
      var i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    sendPos: function (x, z) {
      if (typeof x !== "number" || typeof z !== "number" || !isFinite(x) || !isFinite(z)) return false;
      lastPos = { x: clampCoord(x), z: clampCoord(z) }; // 服务器要求 |x|,|z| < 10
      queuePos();
      return connected;
    },
    sendAct: function (kind, item) {
      if (typeof kind !== "string" || !KIND_RE.test(kind)) return false;
      if (item != null && (typeof item !== "string" || item.length > 24)) return false;
      if (!connected) return false;
      var m = { t: "act", kind: kind };
      if (item != null) m.item = item;
      return rawSend(JSON.stringify(m));
    },
  };
  Object.defineProperty(api, "connected", { get: function () { return connected; }, enumerable: true });
  Object.defineProperty(api, "online", { get: function () { return { me: online.me, her: online.her }; }, enumerable: true });

  window.NEST_RT = api;
})();
