// 互动后端地址（Cloudflare Worker）。留空 = 不显示互动功能。
// 本地开发（localhost）自动连 wrangler dev。
window.NEST_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8787" : "https://api.hizilo.com";
// 网页推送的 VAPID 公钥（公开的，私钥只在 Worker 里）。
window.NEST_VAPID = "BEwUcq46SjCXij40o5vxV5bVg6lkc6dnu9-PYeo1M2-4o-ufNaCAlPe4hv7c1dtLnw1wGZt9x_F5jfUVB0MaNHQ";
