// 互动后端地址（Cloudflare Worker）。留空 = 不显示互动功能。
// 本地开发（localhost）自动连 wrangler dev。
window.NEST_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8787" : "";
