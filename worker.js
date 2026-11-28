var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var SUPABASE_URL = "https://wnfibznjxihilgfedfij.supabase.co";
var DRIVER_EMAILS = {
  zain: "nasegypt9@gmail.com",
  zain2: "moomaro990@gmail.com"
};
var MASTER_USERNAME = "zezo";
var MASTER_EMAIL = "marwanadel333@gmail.com";
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Excel-Sync-Secret",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}
__name(json, "json");
function dubaiDateKey(date) {
  const value = date instanceof Date ? date : /* @__PURE__ */ new Date();
  return new Date(value.getTime() + 4 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
__name(dubaiDateKey, "dubaiDateKey");
function isFutureDeliveryDate(value, todayKey) {
  const dateKey = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey > todayKey;
}
__name(isFutureDeliveryDate, "isFutureDeliveryDate");
function rejectFutureDelivery(order, todayKey) {
  return isFutureDeliveryDate(order && order.delivery_date, todayKey) ? json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u062C\u062F\u0648\u0644\u0629 \u0644\u064A\u0648\u0645 \u0642\u0627\u062F\u0645 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0646\u0641\u064A\u0630 \u0623\u064A \u0625\u062C\u0631\u0627\u0621 \u0639\u0644\u064A\u0647\u0627 \u0642\u0628\u0644 \u064A\u0648\u0645 \u0627\u0644\u062A\u0648\u0635\u064A\u0644", code: "FUTURE_DELIVERY_LOCKED" }, 409) : null;
}
__name(rejectFutureDelivery, "rejectFutureDelivery");
function checkSecrets(env) {
  if (!env.SUPABASE_ANON_KEY) {
    return "SUPABASE_ANON_KEY";
  }
  if (!env.EXCEL_SYNC_SECRET) {
    return "EXCEL_SYNC_SECRET";
  }
  return null;
}
__name(checkSecrets, "checkSecrets");
function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7).trim();
}
__name(getBearerToken, "getBearerToken");
async function makeSharedInvoiceKey(row) {
  const created = row && row.created_at ? new Date(row.created_at).getTime() : 0;
  const canonical = [
    String(row && row.order_number || "").trim().toUpperCase(),
    String(Number.isFinite(created) ? created : 0),
    String(row && row.customer_name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(),
    String(Number(row && row.total || 0).toFixed(2))
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map(function(byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}
__name(makeSharedInvoiceKey, "makeSharedInvoiceKey");
async function supabaseRequest(path, options) {
  const opts = options || {};
  return fetch(SUPABASE_URL + path, {
    method: opts.method || "GET",
    headers: opts.headers || {},
    body: opts.body
  });
}
__name(supabaseRequest, "supabaseRequest");
var FARUJ_MAP_HOSTS = /* @__PURE__ */ new Set(["maps.app.goo.gl", "goo.gl", "google.com", "www.google.com", "maps.google.com", "maps.google.ae", "www.google.ae"]);
function farujCanonicalCoord(n) {
  const v = Math.round(Number(n) * 1e6) / 1e6;
  return Object.is(v, -0) ? 0 : v;
}
__name(farujCanonicalCoord, "farujCanonicalCoord");
function farujCoordKey(lat, lng) {
  return farujCanonicalCoord(lat).toFixed(6) + "," + farujCanonicalCoord(lng).toFixed(6);
}
__name(farujCoordKey, "farujCoordKey");
function farujDmsToDecimal(deg, min, sec, hem) {
  let v = Math.abs(Number(deg)) + Number(min) / 60 + Number(sec) / 3600;
  if (/[SW]/i.test(hem)) v = -v;
  return farujCanonicalCoord(v);
}
__name(farujDmsToDecimal, "farujDmsToDecimal");
function farujExtractCoords(text) {
  const s = String(text || "");
  let m;
  m = s.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) m = s.match(/[?&](?:q|query|destination|ll|center)=(-?\d{1,2}(?:\.\d+)?)(?:%2C|,|%252C)(-?\d{1,3}(?:\.\d+)?)/i);
  if (!m) m = s.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (m) {
    const lat = farujCanonicalCoord(m[1]), lng = farujCanonicalCoord(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  const dms = /(-?\d{1,2})\s*°\s*(\d{1,2})\s*[′'’]\s*(\d{1,2}(?:\.\d+)?)\s*[″"”]?\s*([NS])[^\d-]{0,20}(-?\d{1,3})\s*°\s*(\d{1,2})\s*[′'’]\s*(\d{1,2}(?:\.\d+)?)\s*[″"”]?\s*([EW])/i;
  m = s.match(dms);
  if (m) {
    const lat = farujDmsToDecimal(m[1], m[2], m[3], m[4]), lng = farujDmsToDecimal(m[5], m[6], m[7], m[8]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
__name(farujExtractCoords, "farujExtractCoords");
async function farujResolveGoogleMap(raw) {
  let u;
  try {
    u = new URL(String(raw || ""));
  } catch (_) {
    throw new Error("\u0631\u0627\u0628\u0637 \u062E\u0631\u0627\u0626\u0637 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D");
  }
  if (u.protocol !== "https:" || !FARUJ_MAP_HOSTS.has(u.hostname.toLowerCase())) throw new Error("\u064A\u0633\u0645\u062D \u0641\u0642\u0637 \u0628\u0631\u0648\u0627\u0628\u0637 Google Maps \u0627\u0644\u0645\u0648\u062B\u0648\u0642\u0629 \u0639\u0628\u0631 HTTPS");
  let current = u.toString();
  for (let hop = 0; hop <= 6; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !FARUJ_MAP_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0631\u0627\u0628\u0637 \u0625\u0644\u0649 \u0646\u0637\u0627\u0642 \u063A\u064A\u0631 \u0645\u0648\u062B\u0648\u0642");
    let coords = farujExtractCoords(current);
    if (coords) return { ...coords, key: farujCoordKey(coords.lat, coords.lng), resolved_url: current };
    if (hop === 6) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6e3);
    let resp;
    try {
      resp = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    } catch (e) {
      const err = new Error(e && e.name === "AbortError" ? "\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0641\u0643 \u0631\u0627\u0628\u0637 \u0627\u0644\u062E\u0631\u064A\u0637\u0629" : "\u062A\u0639\u0630\u0631 \u0641\u0643 \u0631\u0627\u0628\u0637 \u0627\u0644\u062E\u0631\u064A\u0637\u0629");
      err.code = e && e.name === "AbortError" ? "MAP_TIMEOUT" : "MAP_FETCH_FAILED";
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (resp.status === 429) {
      const rawRetry = String(resp.headers.get("Retry-After") || "").trim();
      let retryAfterSec = Number(rawRetry);
      if (!Number.isFinite(retryAfterSec) || retryAfterSec <= 0) {
        const retryDate = Date.parse(rawRetry);
        retryAfterSec = Number.isFinite(retryDate) ? Math.max(1, Math.ceil((retryDate - Date.now()) / 1e3)) : 60;
      }
      retryAfterSec = Math.max(5, Math.min(900, Math.ceil(retryAfterSec)));
      const err = new Error("Google Maps (HTTP 429): \u062A\u0645 \u062A\u062D\u062F\u064A\u062F \u0645\u0639\u062F\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A\u061B \u0627\u0646\u062A\u0638\u0631 " + retryAfterSec + " \u062B\u0627\u0646\u064A\u0629 \u062B\u0645 \u0623\u0639\u062F \u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u062D\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u0624\u0642\u062A\u0629 \u0641\u0642\u0637");
      err.code = "MAP_RATE_LIMITED";
      err.retryAfterSec = retryAfterSec;
      throw err;
    }
    if (!resp.ok && ![301, 302, 303, 307, 308].includes(resp.status)) {
      const err = new Error("Google Maps (HTTP " + resp.status + ")");
      err.code = "MAP_HTTP_ERROR";
      throw err;
    }
    const loc = resp.headers.get("location");
    if (!loc) {
      const body = await resp.text().catch(() => "");
      coords = farujExtractCoords(body);
      if (coords) return { ...coords, key: farujCoordKey(coords.lat, coords.lng), resolved_url: current };
      break;
    }
    current = new URL(loc, current).toString();
  }
  throw new Error("\u062A\u0639\u0630\u0631 \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A \u0645\u0624\u0643\u062F\u0629 \u0645\u0646 \u0627\u0644\u0631\u0627\u0628\u0637\u061B \u0644\u0645 \u064A\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0645\u0648\u0642\u0639");
}
__name(farujResolveGoogleMap, "farujResolveGoogleMap");
async function farujServiceHeaders(env) {
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) throw new Error("\u0645\u0641\u062A\u0627\u062D Supabase \u0627\u0644\u062E\u062F\u0645\u064A \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A Worker");
  const h = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) h.Authorization = "Bearer " + key;
  return h;
}
__name(farujServiceHeaders, "farujServiceHeaders");
async function farujRpc(env, name, args) {
  const h = await farujServiceHeaders(env);
  const r = await supabaseRequest("/rest/v1/rpc/" + name, { method: "POST", headers: h, body: JSON.stringify(args) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d && (d.message || d.details || d.hint) || "Supabase RPC failed: " + r.status);
  return d;
}
__name(farujRpc, "farujRpc");
async function farujReadSharedStateChunked(env) {
  const headers = await farujServiceHeaders(env);
  const chunkSize = 5e5;
  let offset = 0, totalChars = null, updatedAt = null, sourceDevice = null, fullText = "";
  for (let page = 0; page < 100; page++) {
    const response = await supabaseRequest("/rest/v1/rpc/faruj_desktop_shared_state_read_chunk", {
      method: "POST",
      headers,
      body: JSON.stringify({ p_offset: offset, p_limit: chunkSize })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== "object") {
      const detail = result && (result.message || result.details || result.hint || result.error);
      throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062C\u0632\u0621 \u0645\u0646 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643 (HTTP " + response.status + ")" + (detail ? ": " + String(detail).slice(0, 220) : ""));
    }
    if (!result.exists) return null;
    if (totalChars === null) {
      totalChars = Number(result.total_chars);
      updatedAt = result.updated_at;
      sourceDevice = result.source_device || null;
    } else if (result.updated_at !== updatedAt || Number(result.total_chars) !== totalChars) {
      throw new Error("\u062A\u063A\u064A\u0631\u062A \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u0623\u062B\u0646\u0627\u0621 \u0642\u0631\u0627\u0621\u062A\u0647\u0627\u061B \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u062B\u0648\u0627\u0646\u064D");
    }
    const piece = String(result.chunk_text || "");
    if (!piece && offset < totalChars) throw new Error("\u062A\u0639\u0630\u0631 \u0625\u0643\u0645\u0627\u0644 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u0639\u0646\u062F \u0627\u0644\u0645\u0648\u0636\u0639 " + offset);
    fullText += piece;
    offset += Array.from(piece).length;
    if (offset >= totalChars) break;
  }
  if (totalChars === null) return null;
  if (Array.from(fullText).length !== totalChars) throw new Error("\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629\u061B \u0644\u0645 \u064A\u062A\u0645 \u062A\u0637\u0628\u064A\u0642 \u0623\u064A \u0628\u064A\u0627\u0646\u0627\u062A");
  let payload;
  try {
    payload = JSON.parse(fullText);
  } catch (_) {
    throw new Error("\u062A\u0639\u0630\u0631 \u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u0628\u0639\u062F \u062A\u062C\u0645\u064A\u0639 \u0623\u062C\u0632\u0627\u0626\u0647\u0627");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("\u0633\u062C\u0644 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643 \u0644\u0627 \u064A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 payload \u0635\u0627\u0644\u062D");
  return { payload, updated_at: updatedAt, source_device: sourceDevice };
}
__name(farujReadSharedStateChunked, "farujReadSharedStateChunked");
async function farujSharedPayload(env) {
  const row = await farujReadSharedStateChunked(env);
  if (!row) throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643: \u0627\u0644\u0633\u062C\u0644 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F");
  return row.payload;
}
__name(farujSharedPayload, "farujSharedPayload");
async function farujReadSharedStateVersion(env) {
  const row = await farujReadSharedStateChunked(env);
  if (!row) throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u0644\u0625\u062C\u0631\u0627\u0621 \u0627\u0644\u0639\u0645\u064A\u0644: \u0627\u0644\u0633\u062C\u0644 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F");
  return row;
}
__name(farujReadSharedStateVersion, "farujReadSharedStateVersion");
function farujStableJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "[" + value.map(farujStableJson).join(",") + "]";
  if (typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + farujStableJson(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
__name(farujStableJson, "farujStableJson");
async function farujMigrationState(env) {
  const h = await farujServiceHeaders(env);
  const r = await supabaseRequest("/rest/v1/faruj_customer_location_migration_v4?id=eq.1&select=*", { headers: h });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d) || !d.length) throw new Error("\u062C\u062F\u0648\u0644 \u062A\u0647\u064A\u0626\u0629 \u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u063A\u064A\u0631 \u062C\u0627\u0647\u0632\u061B \u0634\u063A\u0651\u0644 \u0645\u0644\u0641 SQL v4 \u0623\u0648\u0644\u064B\u0627");
  return d[0];
}
__name(farujMigrationState, "farujMigrationState");
async function farujMigrationPage(env, offset, limit) {
  const d = await farujRpc(env, "faruj_customer_location_migration_page_v1", {
    p_offset: Math.max(0, Number(offset) || 0),
    p_limit: Math.max(0, Math.min(1, Number(limit) || 0))
  });
  if (!d || typeof d !== "object" || !Array.isArray(d.customers) || !d.snapshot_token)
    throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0635\u0641\u062D\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0627\u0644\u0635\u063A\u064A\u0631\u0629 \u0644\u0644\u062A\u0647\u064A\u0626\u0629\u061B \u062A\u0623\u0643\u062F \u0645\u0646 \u062A\u062B\u0628\u064A\u062A \u062F\u0627\u0644\u0629 v47 \u0641\u064A Supabase");
  return { customers: d.customers, total_customers: Number(d.total_customers) || 0, snapshot_token: String(d.snapshot_token) };
}
__name(farujMigrationPage, "farujMigrationPage");
async function farujMigrationCustomer(env, customerCode) {
  const d = await farujRpc(env, "faruj_customer_location_migration_customer_v1", { p_customer_code: String(customerCode || "").trim() });
  if (!d || typeof d !== "object" || !d.snapshot_token)
    throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629\u061B \u062A\u0623\u0643\u062F \u0645\u0646 \u062A\u062B\u0628\u064A\u062A \u062F\u0627\u0644\u0629 v47 \u0641\u064A Supabase");
  return { customer: d.customer && typeof d.customer === "object" ? d.customer : null, snapshot_token: String(d.snapshot_token) };
}
__name(farujMigrationCustomer, "farujMigrationCustomer");
async function farujRegisteredLocationCodes(env, customerCodes) {
  const codes = Array.from(new Set((Array.isArray(customerCodes) ? customerCodes : []).map((x) => String(x || "").trim()).filter(Boolean)));
  const out = /* @__PURE__ */ new Map();
  if (!codes.length) return out;
  const h = await farujServiceHeaders(env);
  for (const code of codes) {
    const r = await supabaseRequest("/rest/v1/faruj_customer_location_registry_v4?customer_code=eq." + encodeURIComponent(code) + "&select=customer_code,original_url&limit=1", { headers: h });
    const d = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(d)) throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0633\u062C\u0644 \u0627\u0644\u0645\u0648\u0642\u0639 \u0644\u0644\u0639\u0645\u064A\u0644 " + code + "\u061B \u0623\u0648\u0642\u0641\u0646\u0627 \u0627\u0644\u0627\u0633\u062A\u0643\u0645\u0627\u0644 \u062F\u0648\u0646 \u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0631\u0648\u0627\u0628\u0637");
    if (d.length) out.set(String(d[0].customer_code || "").trim(), String(d[0].original_url || "").trim());
  }
  return out;
}
__name(farujRegisteredLocationCodes, "farujRegisteredLocationCodes");
async function farujWriteMigrationCAS(env, patch, expectedUpdatedAt) {
  const h = await farujServiceHeaders(env);
  const q = "/rest/v1/faruj_customer_location_migration_v4?id=eq.1&updated_at=eq." + encodeURIComponent(String(expectedUpdatedAt || ""));
  const r = await supabaseRequest(q, { method: "PATCH", headers: Object.assign({}, h, { Prefer: "return=representation" }), body: JSON.stringify(Object.assign({}, patch, { updated_at: (/* @__PURE__ */ new Date()).toISOString() })) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d) || !d.length) throw new Error("\u062A\u063A\u064A\u0631 \u0633\u062C\u0644 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0646 \u0637\u0644\u0628 \u0622\u062E\u0631\u061B \u0644\u0645 \u0646\u0639\u062A\u0645\u062F \u0646\u062A\u064A\u062C\u0629 \u0645\u062A\u0639\u0627\u0631\u0636\u0629. \u0623\u0639\u062F \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062D\u0627\u0644\u0629.");
  return d[0];
}
__name(farujWriteMigrationCAS, "farujWriteMigrationCAS");
async function broadcastOrdersChanged(env, source) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return false;
  try {
    const response = await supabaseRequest("/realtime/v1/api/broadcast", {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [{
          topic: "fa-orders-live",
          event: "orders-changed",
          payload: {
            source: String(source || "system"),
            emitted_at: (/* @__PURE__ */ new Date()).toISOString()
          }
        }]
      })
    });
    if (!response.ok) {
      try {
        console.error("Realtime broadcast failed:", response.status, await response.text());
      } catch (_) {
      }
      return false;
    }
    return true;
  } catch (error) {
    try {
      console.error("Realtime broadcast exception:", error && error.message || error);
    } catch (_) {
    }
    return false;
  }
}
__name(broadcastOrdersChanged, "broadcastOrdersChanged");
async function getUser(token, anonKey) {
  if (!token || !anonKey) {
    return null;
  }
  const response = await supabaseRequest("/auth/v1/user", {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + token
    }
  });
  if (!response.ok) {
    return null;
  }
  return await response.json().catch(function() {
    return null;
  });
}
__name(getUser, "getUser");
async function getDriverInfo(token, anonKey, userId) {
  if (!token || !anonKey || !userId) {
    return null;
  }
  const path = "/rest/v1/mandoub_users?user_id=eq." + encodeURIComponent(userId) + "&select=mandoub_name,sheet_name";
  const response = await supabaseRequest(path, {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + token
    }
  });
  if (!response.ok) {
    return null;
  }
  const rows = await response.json().catch(function() {
    return [];
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return {
    mandoub_name: rows[0].mandoub_name || "",
    sheet_name: rows[0].sheet_name || ""
  };
}
__name(getDriverInfo, "getDriverInfo");
async function requireDriver(request, env) {
  const token = getBearerToken(request);
  if (!token) {
    return {
      error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D",
      status: 401
    };
  }
  const user = await getUser(
    token,
    env.SUPABASE_ANON_KEY
  );
  if (!user || !user.id) {
    return {
      error: "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062C\u0644\u0633\u0629",
      status: 401
    };
  }
  const driver = await getDriverInfo(
    token,
    env.SUPABASE_ANON_KEY,
    user.id
  );
  if (!driver) {
    return {
      error: "\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644",
      status: 403
    };
  }
  return {
    token,
    user,
    driver
  };
}
__name(requireDriver, "requireDriver");
async function requireMaster(request, env) {
  const token = getBearerToken(request);
  if (!token) {
    return {
      error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D",
      status: 401
    };
  }
  const user = await getUser(
    token,
    env.SUPABASE_ANON_KEY
  );
  if (!user || !user.id) {
    return {
      error: "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062C\u0644\u0633\u0629",
      status: 401
    };
  }
  const path = "/rest/v1/master_admins?user_id=eq." + encodeURIComponent(user.id) + "&select=id,user_id,email";
  const response = await supabaseRequest(path, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: "Bearer " + token
    }
  });
  if (!response.ok) {
    return {
      error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0627\u0644\u0645\u0627\u0633\u062A\u0631",
      status: 500
    };
  }
  const rows = await response.json().catch(function() {
    return [];
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D",
      status: 403
    };
  }
  return {
    token,
    user,
    master: rows[0]
  };
}
__name(requireMaster, "requireMaster");
function invoiceDigits(value) {
  return String(value == null ? "" : value).replace(/[^0-9]/g, "");
}
__name(invoiceDigits, "invoiceDigits");
function invoiceNorm(value) {
  return String(value == null ? "" : value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
__name(invoiceNorm, "invoiceNorm");
function matchInvoiceRows(rows, identity) {
  const orderNumber = String(identity.order_number || "").trim();
  let candidates = (Array.isArray(rows) ? rows : []).filter(function(row) {
    return String(row.order_number || "").trim() === orderNumber;
  });
  if (!candidates.length) return { rows: [], ambiguous: false };
  const phone = invoiceDigits(identity.phone);
  const customer = invoiceNorm(identity.customer_name);
  const sheet = String(identity.sheet_name || "").trim();
  const date = String(identity.delivery_date || "").slice(0, 10);
  const allSheets = !sheet || sheet.toUpperCase() === "ALL";
  if (!allSheets) {
    candidates = candidates.filter(function(row) {
      return String(row.sheet_name || "").trim() === sheet;
    });
    if (!candidates.length) return { rows: [], ambiguous: false };
  }
  if (date) {
    const exactDate = candidates.filter(function(row) {
      return String(row.delivery_date || "").slice(0, 10) === date;
    });
    if (exactDate.length) {
      candidates = exactDate;
    } else {
      const unknownDate = candidates.filter(function(row) {
        return !String(row.delivery_date || "").trim();
      });
      if (!allSheets && unknownDate.length === 1) candidates = unknownDate;
      else return { rows: [], ambiguous: unknownDate.length > 1 };
    }
  }
  let nameMatched = candidates;
  if (customer) {
    nameMatched = candidates.filter(function(row) {
      const saved = invoiceNorm(row.customer_name);
      return !saved || saved === customer;
    });
    if (!nameMatched.length) return { rows: [], ambiguous: false };
  }
  if (phone) {
    const phoneMatched = nameMatched.filter(function(row) {
      const saved = invoiceDigits(row.phone);
      return !saved || saved === phone;
    });
    if (phoneMatched.length) {
      candidates = phoneMatched;
    } else if (customer && date) {
      candidates = nameMatched;
    } else {
      return { rows: [], ambiguous: false };
    }
  } else {
    candidates = nameMatched;
  }
  if (!allSheets && candidates.length > 1) return { rows: [], ambiguous: true };
  if (allSheets && !date && candidates.length > 1) return { rows: [], ambiguous: true };
  return { rows: candidates, ambiguous: false };
}
__name(matchInvoiceRows, "matchInvoiceRows");
function invoiceIdFilter(rows) {
  const ids = (Array.isArray(rows) ? rows : []).map(function(row) {
    return Number(row.id);
  }).filter(function(id) {
    return Number.isInteger(id) && id > 0;
  });
  return ids.length ? "id=in.(" + ids.join(",") + ")" : "";
}
__name(invoiceIdFilter, "invoiceIdFilter");
function stripEmojiText(value) {
  return String(value == null ? "" : value).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/gu, "").replace(/\s{2,}/g, " ").trim();
}
__name(stripEmojiText, "stripEmojiText");
function normalizePayment(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "cash" || v === "\u0643\u0627\u0634" || v === "\u0646\u0642\u062F\u064A" || v === "\u062F\u0641\u0639 \u0643\u0627\u0634") {
    return "cash";
  }
  if (v === "bank_transfer" || v === "bank transfer" || v === "bank" || v === "transfer" || v === "\u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A" || v === "\u062A\u062D\u0648\u064A\u0644") {
    return "bank_transfer";
  }
  return null;
}
__name(normalizePayment, "normalizePayment");
function paymentLabel(value) {
  if (value === "cash") {
    return "\u062F\u0641\u0639 \u0643\u0627\u0634";
  }
  if (value === "bank_transfer") {
    return "\u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A";
  }
  return "";
}
__name(paymentLabel, "paymentLabel");
async function clearGatePhotosForInvoice(invoiceNumber, env) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) {
    throw new Error("\u0625\u0639\u062F\u0627\u062F \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: SUPABASE_SERVICE_ROLE_KEY");
  }
  const headers = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey
  };
  const encodedInvoice = encodeURIComponent(invoiceNumber);
  const rowsResponse = await supabaseRequest(
    "/rest/v1/orders?order_number=eq." + encodedInvoice + "&select=id,order_number,gate_photo_url,gate_photo_urls",
    { headers }
  );
  const rows = await rowsResponse.json().catch(function() {
    return null;
  });
  if (!rowsResponse.ok || !Array.isArray(rows)) {
    throw new Error(rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0635\u0648\u0631 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629");
  }
  const bucketName = "gate-photos 3";
  const bucketMarker = "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/";
  const paths = [];
  const addPath = /* @__PURE__ */ __name(function(value) {
    const photoUrl = String(value || "").trim();
    const at = photoUrl.indexOf(bucketMarker);
    if (at < 0) return;
    const rawPath = photoUrl.slice(at + bucketMarker.length).split("?")[0];
    let decoded;
    try {
      decoded = rawPath.split("/").map(function(part) {
        return decodeURIComponent(part);
      }).join("/");
    } catch (_) {
      return;
    }
    if (decoded.startsWith("invoices/") && !decoded.includes("..") && !paths.includes(decoded)) {
      paths.push(decoded);
    }
  }, "addPath");
  for (const row of rows) {
    addPath(row.gate_photo_url);
    let photos = row.gate_photo_urls;
    if (typeof photos === "string") {
      try {
        photos = JSON.parse(photos);
      } catch (_) {
        photos = [];
      }
    }
    if (Array.isArray(photos)) {
      for (const photo of photos) {
        addPath(typeof photo === "string" ? photo : photo && (photo.url || photo.gate_photo_url) || "");
      }
    }
  }
  if (paths.length) {
    const storageResponse = await supabaseRequest(
      "/storage/v1/object/" + encodeURIComponent(bucketName),
      {
        method: "DELETE",
        headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: paths })
      }
    );
    const storageData = await storageResponse.json().catch(function() {
      return null;
    });
    if (!storageResponse.ok) {
      throw new Error(storageData && (storageData.message || storageData.error) || "\u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u0645\u0646 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A");
    }
  }
  const clearBody = JSON.stringify({ gate_photo_url: null, gate_photo_urls: [] });
  const ordersPatch = await supabaseRequest(
    "/rest/v1/orders?order_number=eq." + encodedInvoice,
    { method: "PATCH", headers: Object.assign({}, headers, { "Content-Type": "application/json", Prefer: "return=minimal" }), body: clearBody }
  );
  if (!ordersPatch.ok) throw new Error("\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u0645\u0646 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u0645\u0633\u062D \u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0637\u0644\u0628\u0627\u062A");
  const archivePatch = await supabaseRequest(
    "/rest/v1/master_orders_archive?order_number=eq." + encodedInvoice,
    { method: "PATCH", headers: Object.assign({}, headers, { "Content-Type": "application/json", Prefer: "return=minimal" }), body: clearBody }
  );
  if (!archivePatch.ok && archivePatch.status !== 404) {
    throw new Error("\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u0645\u0633\u062D \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631 \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631");
  }
  return paths.length;
}
__name(clearGatePhotosForInvoice, "clearGatePhotosForInvoice");
async function farujClearCustomerMigrationIssue(env, customerCode) {
  const code = String(customerCode || "").trim();
  if (!code) return false;
  try {
    const state = await farujMigrationState(env);
    const issues = Array.isArray(state.issues) ? state.issues : [];
    const kept = issues.filter((x) => String(x && x.customer_code || "").trim() !== code);
    if (kept.length === issues.length) return true;
    const nextStatus = state.status === "running" ? "running" : kept.length ? "needs_review" : "complete";
    await farujWriteMigrationCAS(env, { issues: kept, status: nextStatus }, state.updated_at);
    return true;
  } catch (e) {
    try {
      console.error("Customer saved but migration issue cleanup was deferred:", code, e && e.message || e);
    } catch (_) {
    }
    return false;
  }
}
__name(farujClearCustomerMigrationIssue, "farujClearCustomerMigrationIssue");
var worker_default = {
  async fetch(request, env) {
    const missingSecret = checkSecrets(env);
    if (missingSecret) {
      return json(
        {
          error: "Server configuration error"
        },
        500
      );
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Excel-Sync-Secret",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
        }
      });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path.startsWith("/api/customer-location/")) {
        try {
          const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
          if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ ok: false, error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
          if (path === "/api/customer-location/check" && request.method === "POST") {
            const body = await request.json().catch(() => null);
            if (!body) return json({ ok: false, error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0637\u0644\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629" }, 400);
            const code = String(body.customer_code || "").trim();
            if (!code) return json({ ok: false, error: "\u0643\u0648\u062F \u0627\u0644\u0639\u0645\u064A\u0644 \u0645\u0637\u0644\u0648\u0628" }, 400);
            const migration = await farujMigrationState(env);
            const legacyIssues = Array.isArray(migration.issues) ? migration.issues : [];
            const existingEdit = body.allow_existing_customer_edit === true;
            if (migration.status === "running") return json({ ok: false, error: "\u0647\u0646\u0627\u0643 \u062F\u0641\u0639\u0629 \u062A\u0647\u064A\u0626\u0629 \u062A\u0639\u0645\u0644 \u0627\u0644\u0622\u0646. \u0627\u0646\u062A\u0638\u0631 \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u062F\u0641\u0639\u0629 \u0642\u0628\u0644 \u062A\u063A\u064A\u064A\u0631 \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0648\u0642\u0639 \u062D\u062A\u0649 \u0644\u0627 \u062A\u062A\u062F\u0627\u062E\u0644 \u0639\u0645\u0644\u064A\u062A\u0627 \u0627\u0644\u0641\u062D\u0635 \u0648\u0627\u0644\u062D\u062C\u0632.", code: "MIGRATION_RUNNING" }, 409);
            if (migration.status !== "complete" && !existingEdit) return json({ ok: false, error: "\u0625\u0636\u0627\u0641\u0629 \u0631\u0627\u0628\u0637 \u0645\u0648\u0642\u0639 \u0644\u0639\u0645\u064A\u0644 \u062C\u062F\u064A\u062F \u062A\u062A\u0637\u0644\u0628 \u0627\u0643\u062A\u0645\u0627\u0644 \u062A\u0647\u064A\u0626\u0629 \u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0642\u062F\u064A\u0645\u0629 \u0623\u0648\u0644\u064B\u0627. \u064A\u0645\u0643\u0646 \u062A\u0639\u062F\u064A\u0644 \u0631\u0627\u0628\u0637 \u0639\u0645\u064A\u0644 \u0645\u0648\u062C\u0648\u062F \u0645\u0646 \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u062A\u0639\u062F\u064A\u0644.", code: "MIGRATION_REQUIRED" }, 409);
            if (existingEdit) {
              const payload = await farujSharedPayload(env);
              const customers = Array.isArray(payload.fa_custs) ? payload.fa_custs : [];
              const matches = customers.filter((c) => String(c && c.code || "").trim() === code);
              if (!matches.length) return json({ ok: false, error: "\u0627\u0644\u0639\u0645\u064A\u0644 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A\u061B \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0633\u0627\u0631 \u062A\u0639\u062F\u064A\u0644 \u0645\u0648\u0642\u0639 \u0639\u0645\u064A\u0644 \u0645\u0648\u062C\u0648\u062F", code: "CUSTOMER_NOT_FOUND" }, 409);
              if (matches.length > 1) {
                const expected = body.expected_customer;
                const expectedValid = expected && typeof expected === "object" && !Array.isArray(expected) && String(expected.code || "").trim() === code;
                const firstJson = farujStableJson(matches[0]);
                const allExactCopies = matches.every((item) => farujStableJson(item) === firstJson);
                const matchesOpenedRecord = expectedValid && firstJson === farujStableJson(expected);
                if (!allExactCopies || !matchesOpenedRecord) {
                  return json({ ok: false, error: "\u064A\u0648\u062C\u062F \u0623\u0643\u062B\u0631 \u0645\u0646 \u0633\u062C\u0644 \u0644\u0644\u0639\u0645\u064A\u0644 " + code + " \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A\u060C \u0644\u0643\u0646 \u0627\u0644\u0646\u0633\u062E \u0644\u064A\u0633\u062A \u0645\u062A\u0637\u0627\u0628\u0642\u0629 \u062A\u0645\u0627\u0645\u064B\u0627 \u0623\u0648 \u0644\u0627 \u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u0645\u0641\u062A\u0648\u062D. \u0644\u0645 \u0646\u063A\u064A\u0651\u0631 \u0623\u064A \u0633\u062C\u0644\u061B \u062D\u062F\u0651\u062B \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0648\u0631\u0627\u062C\u0639 \u0627\u0644\u0633\u062C\u0644\u0627\u062A \u0623\u0648\u0644\u064B\u0627.", code: "CUSTOMER_CODE_DUPLICATE_CONFLICT", customer_code: code, duplicate_count: matches.length }, 409);
                }
              }
            }
            let resolved;
            try {
              resolved = await farujResolveGoogleMap(body.url);
            } catch (e) {
              return json({ ok: false, error: e.message, code: "LOCATION_RESOLVE_FAILED" }, 422);
            }
            const rows = await farujRpc(env, "faruj_check_customer_location_v4", { p_customer_code: code, p_latitude: resolved.lat, p_longitude: resolved.lng });
            const row = Array.isArray(rows) ? rows[0] : rows;
            if (!row || row.available !== true) return json({ ok: false, code: "CUSTOMER_LOCATION_DUPLICATE", other_customer_code: row && row.other_customer_code || null, location_key: resolved.key, error: "\u0627\u0644\u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A \u0645\u062A\u0637\u0627\u0628\u0642\u0629 \u0645\u0639 \u0645\u0648\u0642\u0639 \u0639\u0645\u064A\u0644 \u0645\u0633\u062C\u0644" }, 409);
            const otherIssues = legacyIssues.filter((x) => String(x && x.customer_code || "").trim() !== code);
            const unresolvedOther = otherIssues.filter((x) => String(x && x.issue_type || "") === "unresolved").length;
            return json({ ok: true, coords: [resolved.lat, resolved.lng], location_key: resolved.key, precision: 6, match_mode: "exact", migration_pending: migration.status === "running" || otherIssues.length > 0, remaining_legacy_issues: otherIssues.length, unverified_legacy_customers: unresolvedOther, checked_against_registered_locations: true });
          }
          if (path === "/api/customer-location/migration/status" && request.method === "GET") {
            const state = await farujMigrationState(env);
            return json({ ok: true, state, issues: Array.isArray(state.issues) ? state.issues : [] });
          }
          if (path === "/api/customer-location/migration/start" && request.method === "POST") {
            const state = await farujMigrationState(env);
            if (state.status === "running" && /^[a-f0-9]{32}$/i.test(String(state.customer_fingerprint || ""))) {
              return json({ ok: true, status: state.status, total_customers: Number(state.total_customers) || 0, customer_fingerprint: String(state.customer_fingerprint), next_offset: Number(state.next_offset) || 0, issues_count: Array.isArray(state.issues) ? state.issues.length : 0, resumed: true, already_running: true });
            }
            const meta = await farujMigrationPage(env, 0, 0);
            const fingerprint = meta.snapshot_token;
            const oldFingerprint = String(state.customer_fingerprint || "");
            if ((state.status === "running" || state.status === "complete") && oldFingerprint === fingerprint) {
              return json({ ok: true, status: state.status, total_customers: Number(state.total_customers) || meta.total_customers, customer_fingerprint: fingerprint, next_offset: Number(state.next_offset) || 0, issues_count: Array.isArray(state.issues) ? state.issues.length : 0, resumed: state.status === "running" });
            }
            if (state.status === "needs_review" && oldFingerprint === fingerprint) {
              const saved2 = await farujWriteMigrationCAS(env, {
                status: "running",
                customer_fingerprint: fingerprint,
                total_customers: meta.total_customers,
                next_offset: 0,
                issues: Array.isArray(state.issues) ? state.issues : []
              }, state.updated_at);
              return json({ ok: true, status: saved2.status, total_customers: meta.total_customers, customer_fingerprint: fingerprint, next_offset: 0, issues_count: Array.isArray(saved2.issues) ? saved2.issues.length : Array.isArray(state.issues) ? state.issues.length : 0, recheck: true });
            }
            const keptIssues = Array.isArray(state.issues) ? state.issues : [];
            const patch = {
              status: meta.total_customers ? "running" : keptIssues.length ? "needs_review" : "complete",
              customer_fingerprint: fingerprint,
              total_customers: meta.total_customers,
              next_offset: 0,
              issues: keptIssues
            };
            let saved;
            try {
              saved = await farujWriteMigrationCAS(env, patch, state.updated_at);
            } catch (startConflict) {
              const current = await farujMigrationState(env);
              return json({ ok: true, status: current.status, total_customers: Number(current.total_customers) || meta.total_customers, customer_fingerprint: String(current.customer_fingerprint || fingerprint), next_offset: Number(current.next_offset) || 0, issues_count: Array.isArray(current.issues) ? current.issues.length : 0, resumed: true, concurrent_start: true });
            }
            return json({ ok: true, status: saved.status, total_customers: meta.total_customers, customer_fingerprint: fingerprint, next_offset: Number(saved.next_offset) || 0, issues_count: keptIssues.length, rebased: !!oldFingerprint });
          }
          if (path === "/api/customer-location/migration/batch" && request.method === "POST") {
            const body = await request.json().catch(() => null);
            if (!body) return json({ ok: false, error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062F\u0641\u0639\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629" }, 400);
            const state = await farujMigrationState(env);
            if (state.status !== "running") return json({ ok: false, error: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0645\u0644\u064A\u0629 \u062A\u0647\u064A\u0626\u0629 \u062C\u0627\u0631\u064A\u0629" }, 409);
            if (String(body.customer_fingerprint || "") !== String(state.customer_fingerprint || "")) return json({ ok: false, error: "\u0628\u0635\u0645\u0629 \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642\u0629\u061B \u0644\u0645 \u0646\u063A\u064A\u0651\u0631 \u0623\u064A \u0633\u062C\u0644", code: "CUSTOMER_FINGERPRINT_CHANGED" }, 409);
            const offset = Number(body.offset);
            if (!Number.isInteger(offset) || offset !== Number(state.next_offset)) return json({ ok: false, error: "\u0645\u0624\u0634\u0631 \u0627\u0644\u062F\u0641\u0639\u0629 \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642 \u0644\u0644\u062D\u0627\u0644\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629" }, 409);
            const page = await farujMigrationPage(env, offset, 1);
            if (page.snapshot_token !== String(state.customer_fingerprint || "") || page.total_customers !== Number(state.total_customers)) {
              return json({ ok: false, error: "\u062A\u063A\u064A\u0631\u062A \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062A\u0647\u064A\u0626\u0629\u061B \u0623\u0648\u0642\u0641\u0646\u0627 \u0627\u0644\u062F\u0641\u0639\u0629 \u062F\u0648\u0646 \u062A\u0639\u062F\u064A\u0644 \u0623\u064A \u0631\u0627\u0628\u0637. \u0627\u0628\u062F\u0623 \u0627\u0644\u062A\u0647\u064A\u0626\u0629 \u0644\u0645\u0648\u0627\u0621\u0645\u0629 \u0627\u0644\u0645\u0624\u0634\u0631.", code: "CUSTOMER_FINGERPRINT_CHANGED" }, 409);
            }
            const batch = page.customers;
            if (offset < page.total_customers && !batch.length) return json({ ok: false, error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u062A\u0627\u0644\u064A \u0645\u0646 \u0635\u0641\u062D\u0629 \u0627\u0644\u062A\u0647\u064A\u0626\u0629\u061B \u0644\u0645 \u064A\u062A\u0645 \u062A\u062D\u0631\u064A\u0643 \u0627\u0644\u0645\u0624\u0634\u0631" }, 503);
            const issues = Array.isArray(state.issues) ? state.issues.slice() : [];
            const registered = await farujRegisteredLocationCodes(env, batch.map((c) => c && c.code));
            for (const c of batch) {
              const code = String(c && c.code || "").trim(), map = String(c && c.map || "").trim();
              if (!code) {
                if (map && !issues.some((x) => !String(x && x.customer_code || "").trim() && String(x && x.issue_type || "") === "missing_code")) issues.push({ customer_code: "", customer_name: String(c && c.name || ""), issue_type: "missing_code", details: "\u0639\u0645\u064A\u0644 \u0644\u062F\u064A\u0647 \u0631\u0627\u0628\u0637 \u0645\u0648\u0642\u0639 \u062F\u0648\u0646 \u0643\u0648\u062F \u0639\u0645\u064A\u0644" });
                continue;
              }
              const oldIssueIndex = issues.findIndex((x) => String(x && x.customer_code || "").trim() === code);
              const oldIssue = oldIssueIndex >= 0 ? issues[oldIssueIndex] : null;
              if (!map) {
                try {
                  await farujRpc(env, "faruj_release_customer_location_v4", { p_customer_code: code });
                  if (oldIssueIndex >= 0) issues.splice(oldIssueIndex, 1);
                } catch (e) {
                  const item = { customer_code: code, customer_name: String(c.name || ""), issue_type: "release_failed", details: String(e.message || e).slice(0, 300) };
                  if (oldIssueIndex >= 0) issues[oldIssueIndex] = item;
                  else issues.push(item);
                }
                continue;
              }
              if (registered.get(code) === map) {
                if (oldIssue && oldIssue.issue_type === "duplicate") issues.splice(oldIssueIndex, 1);
                continue;
              }
              if (oldIssue && oldIssue.issue_type !== "duplicate") continue;
              if (oldIssueIndex >= 0) issues.splice(oldIssueIndex, 1);
              try {
                const resolved = await farujResolveGoogleMap(map);
                const claim = await farujRpc(env, "faruj_claim_customer_location_v4", { p_customer_code: code, p_latitude: resolved.lat, p_longitude: resolved.lng, p_original_url: map });
                const row = Array.isArray(claim) ? claim[0] : claim;
                if (!row || row.success !== true) issues.push({ customer_code: code, customer_name: String(c.name || ""), issue_type: "duplicate", details: "\u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0644\u0639\u0645\u064A\u0644 " + (row && row.other_customer_code || "\u0622\u062E\u0631") });
              } catch (e) {
                issues.push({ customer_code: code, customer_name: String(c.name || ""), issue_type: "unresolved", details: String(e.message || e).slice(0, 300) });
              }
            }
            const next = Math.min(page.total_customers, offset + batch.length);
            const done = next >= page.total_customers;
            const finalStatus = done ? issues.length ? "needs_review" : "complete" : "running";
            let nextState;
            try {
              nextState = await farujWriteMigrationCAS(env, { next_offset: next, issues, status: finalStatus }, state.updated_at);
            } catch (commitConflict) {
              const latest = await farujMigrationState(env);
              if (Number(latest.next_offset) > offset) {
                return json({ ok: true, processed: 0, next_offset: Number(latest.next_offset), total_customers: Number(latest.total_customers) || page.total_customers, status: latest.status, issues_count: Array.isArray(latest.issues) ? latest.issues.length : 0, duplicate_request: true });
              }
              throw commitConflict;
            }
            return json({ ok: true, processed: batch.length, next_offset: next, total_customers: page.total_customers, status: nextState.status, issues_count: issues.length });
          }
          if (path === "/api/customer-location/migration/retry-rate-limited" && request.method === "POST") {
            const state = await farujMigrationState(env);
            if (state.status !== "needs_review") return json({ ok: false, error: "\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0627\u0644\u0627\u062A \u0645\u0643\u062A\u0645\u0644\u0629 \u062A\u0646\u062A\u0638\u0631 \u0625\u0639\u0627\u062F\u0629 \u0645\u062D\u0627\u0648\u0644\u0629 \u0631\u0648\u0627\u0628\u0637 Google \u0627\u0644\u0645\u0624\u0642\u062A\u0629", code: "NO_RETRY_REVIEW" }, 409);
            const body = await request.json().catch(() => ({}));
            if (String(body && body.customer_fingerprint || "") !== String(state.customer_fingerprint || "")) return json({ ok: false, error: "\u0628\u0635\u0645\u0629 \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642\u0629\u061B \u0644\u0645 \u0646\u063A\u064A\u0651\u0631 \u0623\u064A \u0633\u062C\u0644", code: "CUSTOMER_FINGERPRINT_CHANGED" }, 409);
            const issues = Array.isArray(state.issues) ? state.issues.slice() : [];
            const retryIndexes = [];
            let cooldownSeconds = 0;
            const nowMs = Date.now();
            for (let i = 0; i < issues.length; i++) {
              const it = issues[i] || {};
              if (String(it.issue_type || "") !== "unresolved" || !/HTTP\\s*429|rate.?limit|معدل الطلبات/i.test(String(it.details || ""))) continue;
              const lastRetry = Date.parse(String(it.last_retry_at || ""));
              const requiredWait = Math.max(5, Math.min(900, Number(it.retry_after_seconds) || 60));
              if (Number.isFinite(lastRetry) && nowMs < lastRetry + requiredWait * 1e3) {
                cooldownSeconds = Math.max(cooldownSeconds, Math.ceil((lastRetry + requiredWait * 1e3 - nowMs) / 1e3));
                break;
              }
              retryIndexes.push(i);
              if (retryIndexes.length >= 1) break;
            }
            const retryableCount = issues.filter((x) => String(x.issue_type || "") === "unresolved" && /HTTP\\s*429|rate.?limit|معدل الطلبات/i.test(String(x.details || ""))).length;
            if (cooldownSeconds > 0) return json({ ok: true, retried: 0, rate_limited: true, retry_after_seconds: cooldownSeconds, retryable_remaining: retryableCount, issues_count: issues.length, status: state.status, message: "\u064A\u062C\u0628 \u0627\u062D\u062A\u0631\u0627\u0645 \u0645\u0647\u0644\u0629 Google \u0642\u0628\u0644 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629." });
            if (!retryIndexes.length) return json({ ok: true, retried: 0, retryable_remaining: 0, issues_count: issues.length, status: state.status, message: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u062E\u0637\u0627\u0621 HTTP 429 \u0642\u0627\u0628\u0644\u0629 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u064B\u0627\u061B \u0628\u0627\u0642\u064A \u0627\u0644\u062D\u0627\u0644\u0627\u062A \u062A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629 \u064A\u062F\u0648\u064A\u0629." });
            let retried = 0, resolvedCount = 0, duplicateCount = 0, rateLimited = false, retryAfterSec = 0;
            for (const idx of retryIndexes) {
              const oldIssue = issues[idx] || {};
              const code = String(oldIssue.customer_code || "").trim();
              const snapshot = await farujMigrationCustomer(env, code);
              if (snapshot.snapshot_token !== String(state.customer_fingerprint || "")) return json({ ok: false, error: "\u062A\u063A\u064A\u0631 \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0627\u0644\u0623\u0635\u0644\u064A\u061B \u0623\u0648\u0642\u0641\u0646\u0627 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0644\u062D\u0645\u0627\u064A\u0629 \u0627\u0644\u0631\u0648\u0627\u0628\u0637", code: "CUSTOMER_FINGERPRINT_CHANGED" }, 409);
              const customer = snapshot.customer;
              if (!code || !customer || !String(customer.map || "").trim()) {
                issues[idx] = Object.assign({}, oldIssue, { details: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0639\u0645\u064A\u0644 \u0623\u0648 \u0631\u0627\u0628\u0637\u0647 \u0627\u0644\u0623\u0635\u0644\u064A \u0641\u064A \u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u062D\u0627\u0644\u064A\u061B \u0644\u0645 \u064A\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0631\u0627\u0628\u0637." });
                continue;
              }
              retried++;
              try {
                const map = String(customer.map).trim();
                const resolved = await farujResolveGoogleMap(map);
                const claim = await farujRpc(env, "faruj_claim_customer_location_v4", { p_customer_code: code, p_latitude: resolved.lat, p_longitude: resolved.lng, p_original_url: map });
                const row = Array.isArray(claim) ? claim[0] : claim;
                if (row && row.success === true) {
                  issues[idx] = null;
                  resolvedCount++;
                } else {
                  issues[idx] = Object.assign({}, oldIssue, { issue_type: "duplicate", details: "\u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0644\u0639\u0645\u064A\u0644 " + String(row && row.other_customer_code || "\u0622\u062E\u0631") });
                  duplicateCount++;
                }
              } catch (e) {
                issues[idx] = Object.assign({}, oldIssue, { details: String(e && e.message || e).slice(0, 300), retry_attempts: (Number(oldIssue.retry_attempts) || 0) + 1, last_retry_at: (/* @__PURE__ */ new Date()).toISOString(), retry_after_seconds: e && e.code === "MAP_RATE_LIMITED" ? Number(e.retryAfterSec) || 60 : void 0 });
                if (e && e.code === "MAP_RATE_LIMITED") {
                  rateLimited = true;
                  retryAfterSec = Math.max(retryAfterSec, Number(e.retryAfterSec) || 60);
                  break;
                }
              }
            }
            const finalIssues = issues.filter(Boolean);
            const stillRetryable = finalIssues.filter((x) => String(x.issue_type || "") === "unresolved" && /HTTP\\s*429|rate.?limit|معدل الطلبات/i.test(String(x.details || ""))).length;
            const saved = await farujWriteMigrationCAS(env, { issues: finalIssues, status: finalIssues.length ? "needs_review" : "complete" }, state.updated_at);
            return json({ ok: true, retried, resolved: resolvedCount, duplicates: duplicateCount, rate_limited: rateLimited, retry_after_seconds: retryAfterSec, retryable_remaining: stillRetryable, issues_count: finalIssues.length, status: saved.status, next_offset: Number(saved.next_offset) || 0, total_customers: Number(saved.total_customers) || 0 });
          }
          return json({ ok: false, error: "\u0645\u0633\u0627\u0631 \u062D\u0645\u0627\u064A\u0629 \u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641" }, 404);
        } catch (locationError) {
          const diagnostic = String(locationError && locationError.message || locationError || "unknown").slice(0, 350);
          try {
            console.error("Faruj customer-location route failed:", path, diagnostic);
          } catch (_) {
          }
          return json({
            ok: false,
            code: "CUSTOMER_LOCATION_INTERNAL",
            error: "\u062A\u0639\u0630\u0631 \u062A\u0646\u0641\u064A\u0630 \u0641\u062D\u0635 \u0645\u0648\u0642\u0639 \u0627\u0644\u0639\u0645\u064A\u0644: " + diagnostic
          }, 500);
        }
      }
      if (path === "/api/desktop-customers/commit" && request.method === "POST") {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ ok: false, error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const declaredLength = Number(request.headers.get("Content-Length") || 0);
        if (declaredLength > 2 * 1024 * 1024) return json({ ok: false, error: "\u062D\u062C\u0645 \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0645\u0633\u0645\u0648\u062D" }, 413);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "\u0628\u064A\u0627\u0646\u0627\u062A \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629" }, 400);
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 2 * 1024 * 1024) return json({ ok: false, error: "\u062D\u062C\u0645 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0645\u0633\u0645\u0648\u062D (2 \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A)" }, 413);
        const action = String(body.action || "").trim();
        const code = String(body.customer_code || "").trim();
        if (!["create", "update", "delete"].includes(action) || !/^[A-Za-z0-9_-]{1,80}$/.test(code)) {
          return json({ ok: false, error: "\u0646\u0648\u0639 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0623\u0648 \u0643\u0648\u062F \u0627\u0644\u0639\u0645\u064A\u0644 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
        }
        const proposed = body.customer;
        const expected = body.expected_customer;
        if (action === "create" || action === "update") {
          if (!proposed || typeof proposed !== "object" || Array.isArray(proposed) || String(proposed.code || "").trim() !== code || !String(proposed.name || "").trim()) {
            return json({ ok: false, error: "\u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u062C\u062F\u064A\u062F \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0643\u0648\u062F\u0647 \u0644\u0627 \u064A\u0637\u0627\u0628\u0642 \u0627\u0644\u0637\u0644\u0628" }, 400);
          }
        }
        if (action === "update" || action === "delete") {
          if (!expected || typeof expected !== "object" || Array.isArray(expected) || String(expected.code || "").trim() !== code) {
            return json({ ok: false, error: "\u0646\u0633\u062E\u0629 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u0623\u0635\u0644\u064A\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0644\u0644\u062A\u062D\u0642\u0642 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629" }, 400);
          }
        }
        let lastConflict = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          let shared;
          try {
            shared = await farujReadSharedStateVersion(env);
          } catch (e) {
            return json({ ok: false, code: "CUSTOMER_CLOUD_READ_FAILED", error: String(e && e.message || e).slice(0, 350) }, 502);
          }
          const payload = JSON.parse(JSON.stringify(shared.payload));
          if (!Array.isArray(payload.fa_custs)) return json({ ok: false, code: "CUSTOMER_LIST_INVALID", error: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A \u0644\u064A\u0633\u062A \u0642\u0627\u0626\u0645\u0629 \u0635\u0627\u0644\u062D\u0629\u061B \u0644\u0645 \u064A\u062A\u0645 \u062A\u063A\u064A\u064A\u0631\u0647\u0627" }, 409);
          const customers = payload.fa_custs;
          let matches = [];
          for (let i = 0; i < customers.length; i++) {
            if (String(customers[i] && customers[i].code || "").trim() === code) matches.push(i);
          }
          const proposedJson = action === "create" || action === "update" ? farujStableJson(proposed) : null;
          const expectedJson = expected ? farujStableJson(expected) : null;
          let current = matches.length ? customers[matches[0]] : null;
          let currentJson = current ? farujStableJson(current) : null;
          let duplicateCopiesCollapsed = 0;
          if (matches.length > 1) {
            if (action === "update" || action === "delete") {
              const matchedJson = matches.map((index) => farujStableJson(customers[index]));
              const allExactCopies = matchedJson.every((value) => value === matchedJson[0]);
              const matchesOpenedRecord = !!expectedJson && matchedJson[0] === expectedJson;
              if (!allExactCopies || !matchesOpenedRecord) {
                return json({
                  ok: false,
                  code: "CUSTOMER_CODE_DUPLICATE_CONFLICT",
                  customer_code: code,
                  duplicate_count: matches.length,
                  error: "\u064A\u0648\u062C\u062F \u0623\u0643\u062B\u0631 \u0645\u0646 \u0633\u062C\u0644 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A \u0628\u0646\u0641\u0633 \u0643\u0648\u062F \u0627\u0644\u0639\u0645\u064A\u0644 " + code + "\u060C \u0644\u0643\u0646 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0633\u062C\u0644\u0627\u062A \u0644\u064A\u0633\u062A \u0646\u0633\u062E\u064B\u0627 \u0645\u062A\u0637\u0627\u0628\u0642\u0629 \u062A\u0645\u0627\u0645\u064B\u0627 \u0623\u0648 \u0644\u0627 \u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0641\u062A\u0648\u062D\u0629. \u0644\u0645 \u0646\u063A\u064A\u0651\u0631 \u0623\u0648 \u0646\u062D\u0630\u0641 \u0623\u064A \u0633\u062C\u0644 \u062D\u062A\u0649 \u0644\u0627 \u0646\u0641\u0642\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0639\u0645\u064A\u0644 \u0622\u062E\u0631. \u064A\u0644\u0632\u0645 \u0645\u0631\u0627\u062C\u0639\u0629 \u0633\u062C\u0644\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0623\u0648\u0644\u064B\u0627."
                }, 409);
              }
              for (let i = matches.length - 1; i >= 1; i--) customers.splice(matches[i], 1);
              duplicateCopiesCollapsed = matches.length - 1;
              matches = [matches[0]];
              current = customers[matches[0]];
              currentJson = farujStableJson(current);
            } else {
              return json({ ok: false, code: "CUSTOMER_CODE_DUPLICATE", customer_code: code, duplicate_count: matches.length, error: "\u0643\u0648\u062F \u0627\u0644\u0639\u0645\u064A\u0644 \u0645\u0648\u062C\u0648\u062F \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A\u061B \u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0646\u0634\u0627\u0621 \u0639\u0645\u064A\u0644 \u062C\u062F\u064A\u062F \u0628\u0646\u0641\u0633 \u0627\u0644\u0643\u0648\u062F" }, 409);
            }
          }
          if (action === "create") {
            if (current) {
              if (currentJson === proposedJson) return json({ ok: true, action, customer_code: code, already_applied: true, updated_at: shared.updated_at });
              return json({ ok: false, code: "CUSTOMER_CODE_DUPLICATE", error: "\u0643\u0648\u062F \u0627\u0644\u0639\u0645\u064A\u0644 \u0645\u0648\u062C\u0648\u062F \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A \u0628\u0633\u062C\u0644 \u0645\u062E\u062A\u0644\u0641\u061B \u0644\u0645 \u0646\u062F\u0645\u062C \u0627\u0644\u0633\u062C\u0644\u064A\u0646" }, 409);
            }
            customers.push(proposed);
          } else if (action === "update") {
            if (!current) return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "\u0644\u0645 \u064A\u0639\u062F \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u0645\u0648\u062C\u0648\u062F\u064B\u0627 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A\u061B \u0644\u0645 \u0646\u0639\u062A\u0645\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644" }, 409);
            if (currentJson === proposedJson && duplicateCopiesCollapsed === 0) return json({ ok: true, action, customer_code: code, already_applied: true, updated_at: shared.updated_at });
            if (currentJson !== expectedJson) return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0639\u0645\u064A\u0644 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632 \u0622\u062E\u0631 \u0645\u0646\u0630 \u0641\u062A\u062D \u0627\u0644\u0633\u062C\u0644\u061B \u0644\u0645 \u0646\u0633\u062A\u0628\u062F\u0644 \u0623\u064A \u0628\u064A\u0627\u0646\u0627\u062A" }, 409);
            customers[matches[0]] = proposed;
          } else {
            if (!current) return json({ ok: true, action, customer_code: code, already_applied: true, updated_at: shared.updated_at });
            if (currentJson !== expectedJson) return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "\u062A\u063A\u064A\u0631 \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632 \u0622\u062E\u0631\u061B \u0644\u0645 \u0646\u0646\u0641\u0630 \u0627\u0644\u062D\u0630\u0641 \u062D\u062A\u0649 \u0644\u0627 \u0646\u0641\u0642\u062F \u062A\u0639\u062F\u064A\u0644\u064B\u0627 \u0623\u062D\u062F\u062B" }, 409);
            customers.splice(matches[0], 1);
          }
          const targetCodeCount = customers.reduce((count, item) => count + (String(item && item.code || "").trim() === code ? 1 : 0), 0);
          if (action === "delete" ? targetCodeCount !== 0 : targetCodeCount !== 1) {
            return json({
              ok: false,
              code: "CUSTOMER_TARGET_CODE_INVALID",
              customer_code: code,
              target_count: targetCodeCount,
              error: "\u062A\u0639\u0630\u0631 \u0627\u0639\u062A\u0645\u0627\u062F \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0639\u0645\u064A\u0644 " + code + " \u0644\u0623\u0646 \u0639\u062F\u062F \u0633\u062C\u0644\u0627\u062A \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0628\u0639\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644 \u0644\u064A\u0633 \u0633\u062C\u0644\u064B\u0627 \u0648\u0627\u062D\u062F\u064B\u0627. \u0644\u0645 \u0646\u063A\u064A\u0651\u0631 \u0623\u064A \u0633\u062C\u0644."
            }, 409);
          }
          const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
          if (payloadBytes > 20 * 1024 * 1024) return json({ ok: false, error: "\u062D\u062C\u0645 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643 \u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u062D\u062F \u0627\u0644\u0645\u0633\u0645\u0648\u062D" }, 413);
          let rpcResult;
          try {
            rpcResult = await farujRpc(env, "faruj_desktop_shared_state_cas_update", {
              p_expected_updated_at: shared.updated_at,
              p_payload: payload,
              p_source_device: String(body.source_device || "desktop-customer").slice(0, 80)
            });
          } catch (e) {
            const message = String(e && e.message || e).slice(0, 350);
            const duplicate = /CUSTOMER_LOCATION_DUPLICATE|إحداثيات مطابقة/i.test(message);
            return json({ ok: false, code: duplicate ? "CUSTOMER_LOCATION_DUPLICATE" : "CUSTOMER_CLOUD_COMMIT_FAILED", error: "\u0631\u0641\u0636 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A \u0627\u0639\u062A\u0645\u0627\u062F \u0633\u062C\u0644 \u0627\u0644\u0639\u0645\u064A\u0644: " + message }, duplicate ? 409 : 502);
          }
          const saved = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
          if (saved && saved.success === true && saved.conflict !== true && saved.updated_at) {
            const mapChanged = action === "update" && String(expected && expected.map || "").trim() !== String(proposed && proposed.map || "").trim();
            let migrationIssueCleared = null;
            let locationRegistryReleased = null;
            if (action === "delete") {
              try {
                await farujRpc(env, "faruj_release_customer_location_v4", { p_customer_code: code });
                locationRegistryReleased = true;
              } catch (releaseError) {
                locationRegistryReleased = false;
                try {
                  console.error("Customer deleted; location registry cleanup deferred:", String(releaseError && releaseError.message || releaseError));
                } catch (_) {
                }
              }
            }
            if (action === "delete" || mapChanged) {
              try {
                migrationIssueCleared = await farujClearCustomerMigrationIssue(env, code);
              } catch (migrationError) {
                try {
                  console.error("Customer saved; migration issue cleanup deferred:", String(migrationError && migrationError.message || migrationError));
                } catch (_) {
                }
                migrationIssueCleared = false;
              }
            }
            return json({ ok: true, action, customer_code: code, already_applied: false, updated_at: saved.updated_at, source_device: saved.source_device || body.source_device || "desktop-customer", migration_issue_cleared: migrationIssueCleared, location_registry_released: locationRegistryReleased, duplicate_copies_collapsed: duplicateCopiesCollapsed });
          }
          lastConflict = saved || null;
          if (!(saved && saved.conflict === true) || attempt === 3) break;
        }
        return json({ ok: false, code: "CUSTOMER_RECORD_CONFLICT", error: "\u062A\u063A\u064A\u0631 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643 \u0623\u062B\u0646\u0627\u0621 \u062D\u0641\u0638 \u0627\u0644\u0639\u0645\u064A\u0644 \u0648\u0644\u0645 \u064A\u0645\u0643\u0646 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0628\u0639\u062F 4 \u0645\u062D\u0627\u0648\u0644\u0627\u062A\u061B \u0644\u0645 \u0646\u0639\u062A\u0645\u062F \u0646\u062C\u0627\u062D\u064B\u0627 \u063A\u064A\u0631 \u0645\u0624\u0643\u062F", updated_at: lastConflict && lastConflict.updated_at || null }, 409);
      }
      if (path === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          worker: "delivery-driver-app",
          configuration: "ready"
        });
      }
      if (path === "/api/desktop-users" && (request.method === "GET" || request.method === "POST")) {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        }
        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0631\u0643\u0632\u064A \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637: \u0623\u0636\u0641 SUPABASE_SECRET_KEY \u0623\u0648 SUPABASE_SERVICE_ROLE_KEY \u0625\u0644\u0649 \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const serviceHeaders = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.Authorization = "Bearer " + serviceKey;
        if (request.method === "GET") {
          const response2 = await supabaseRequest(
            "/rest/v1/faruj_desktop_shared_users?id=eq.1&select=users,deleted_names,updated_at",
            { headers: serviceHeaders }
          );
          const rows = await response2.json().catch(function() {
            return null;
          });
          if (!response2.ok || !Array.isArray(rows)) {
            return json({
              error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0645\u0646 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0631\u0643\u0632\u064A",
              detail: rows,
              supabase_status: response2.status
            }, 502);
          }
          return json({
            users: rows.length && Array.isArray(rows[0].users) ? rows[0].users : [],
            deleted_names: rows.length && Array.isArray(rows[0].deleted_names) ? rows[0].deleted_names : [],
            updated_at: rows.length ? rows[0].updated_at : null
          });
        }
        const body = await request.json().catch(function() {
          return null;
        });
        if (!body || !Array.isArray(body.users) || body.users.length > 200) {
          return json({ error: "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629" }, 400);
        }
        const deletedNames = Array.isArray(body.deleted_names) ? body.deleted_names.filter(function(name) {
          return typeof name === "string" && name.trim();
        }).slice(0, 200) : [];
        const restoreNames = Array.isArray(body.restore_names) ? body.restore_names.filter(function(name) {
          return typeof name === "string" && name.trim();
        }).slice(0, 200) : [];
        const valid = body.users.every(function(u) {
          return u && typeof u.name === "string" && u.name.trim() && typeof u.pass === "string" && typeof u.role === "string";
        });
        if (!valid) return json({ error: "\u064A\u0648\u062C\u062F \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629" }, 400);
        const response = await supabaseRequest("/rest/v1/rpc/faruj_sync_desktop_users", {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify({ p_users: body.users, p_deleted_names: deletedNames, p_restore_names: restoreNames })
        });
        const result = await response.json().catch(function() {
          return null;
        });
        if (!response.ok) {
          return json({
            error: "\u062A\u0639\u0630\u0631 \u062F\u0645\u062C \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0631\u0643\u0632\u064A",
            detail: result,
            supabase_status: response.status
          }, 502);
        }
        const syncedUsers = result && Array.isArray(result.users) ? result.users : body.users;
        const syncedDeletedNames = result && Array.isArray(result.deleted_names) ? result.deleted_names : deletedNames;
        return json({ success: true, users: syncedUsers, deleted_names: syncedDeletedNames });
      }
      if (path === "/api/desktop-state" && (request.method === "GET" || request.method === "POST")) {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0631\u0643\u0632\u064A \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const headers = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;
        if (request.method === "GET") {
          try {
            const row = await farujReadSharedStateChunked(env);
            if (!row) return json({ success: true, payload: null, updated_at: null, source_device: null });
            return json({ success: true, payload: row.payload, updated_at: row.updated_at, source_device: row.source_device });
          } catch (error) {
            return json({ error: "\u062A\u0639\u0630\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629", detail: String(error && error.message || error) }, 502);
          }
        }
        const declaredLength = Number(request.headers.get("Content-Length") || 0);
        if (declaredLength > 20 * 1024 * 1024) return json({ error: "\u062D\u062C\u0645 \u0627\u0644\u0646\u0633\u062E\u0629 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0645\u0633\u0645\u0648\u062D (20 \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A)" }, 413);
        const body = await request.json().catch(function() {
          return null;
        });
        if (!body || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return json({ error: "\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0646\u0633\u062E\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
        const keys = Object.keys(body.payload);
        if (!keys.length || keys.length > 100) return json({ error: "\u0639\u062F\u062F \u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0646\u0633\u062E\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
        for (const key of keys) {
          if (!/^fa_[a-zA-Z0-9_-]+$/.test(key) || ["fa_set", "fa_users", "fa_users_deleted", "fa_users_pending_delete", "fa_users_restore", "fa_theme", "fa_owner_pass_2010_migrated"].includes(key)) {
            return json({ error: "\u0627\u0644\u0646\u0633\u062E\u0629 \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0645\u0641\u062A\u0627\u062D \u0645\u062D\u0638\u0648\u0631: " + key }, 400);
          }
        }
        const payloadText = JSON.stringify(body.payload);
        if (new TextEncoder().encode(payloadText).byteLength > 20 * 1024 * 1024) return json({ error: "\u062D\u062C\u0645 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0646\u0633\u062E\u0629 \u0623\u0643\u0628\u0631 \u0645\u0646 20 \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A" }, 413);
        const response = await supabaseRequest("/rest/v1/faruj_desktop_shared_state?on_conflict=id", {
          method: "POST",
          headers: Object.assign({}, headers, { Prefer: "resolution=ignore-duplicates,return=representation" }),
          body: JSON.stringify({ id: 1, payload: body.payload, source_device: String(body.source_device || "desktop-primary").slice(0, 80), updated_at: (/* @__PURE__ */ new Date()).toISOString() })
        });
        const rows = await response.json().catch(function() {
          return null;
        });
        if (!response.ok) return json({ error: "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629", detail: rows, supabase_status: response.status }, 502);
        if (!Array.isArray(rows) || !rows.length) return json({ error: "\u062A\u0648\u062C\u062F \u0646\u0633\u062E\u0629 \u0645\u0634\u062A\u0631\u0643\u0629 \u0628\u0627\u0644\u0641\u0639\u0644\u061B \u0644\u0645 \u0646\u0633\u062A\u0628\u062F\u0644\u0647\u0627 \u062D\u0645\u0627\u064A\u0629\u064B \u0644\u0628\u064A\u0627\u0646\u0627\u062A\u0643. \u0627\u0633\u062A\u062E\u062F\u0645 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0639\u0644\u0649 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0622\u062E\u0631." }, 409);
        return json({ success: true, saved_keys: keys.length, updated_at: rows[0].updated_at || (/* @__PURE__ */ new Date()).toISOString(), message: "\u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0623\u0648\u0644\u064A\u0629 \u062F\u0648\u0646 \u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u0646\u0633\u062E\u0629 \u0633\u0627\u0628\u0642\u0629" });
      }
      if (path === "/api/desktop-state/sync" && (request.method === "GET" || request.method === "POST")) {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0631\u0643\u0632\u064A \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const headers = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;
        if (request.method === "GET") {
          const metadataOnly = url.searchParams.get("meta") === "1";
          if (metadataOnly) {
            const response2 = await supabaseRequest(
              "/rest/v1/faruj_desktop_shared_state?id=eq.1&select=id,updated_at,source_device",
              { headers }
            );
            const rows2 = await response2.json().catch(function() {
              return null;
            });
            if (!response2.ok || !Array.isArray(rows2)) return json({ error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643", detail: rows2, supabase_status: response2.status }, 502);
            if (!rows2.length) return json({ success: true, exists: false, updated_at: null, source_device: null });
            return json({ success: true, exists: true, updated_at: rows2[0].updated_at, source_device: rows2[0].source_device });
          }
          try {
            const row = await farujReadSharedStateChunked(env);
            if (!row) return json({ success: true, exists: false, payload: null, updated_at: null, source_device: null });
            return json({ success: true, exists: true, payload: row.payload, updated_at: row.updated_at, source_device: row.source_device });
          } catch (error) {
            return json({ error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643", detail: String(error && error.message || error) }, 502);
          }
        }
        const body = await request.json().catch(function() {
          return null;
        });
        if (!body || typeof body.expected_updated_at !== "string" || !body.expected_updated_at.trim()) {
          return json({ error: "\u0631\u0642\u0645 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" }, 400);
        }
        if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
          return json({ error: "\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0646\u0633\u062E\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
        }
        const keys = Object.keys(body.payload);
        if (!keys.length || keys.length > 100) return json({ error: "\u0639\u062F\u062F \u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0646\u0633\u062E\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
        const forbidden = ["fa_set", "fa_users", "fa_users_deleted", "fa_users_pending_delete", "fa_users_restore", "fa_theme", "fa_owner_pass_2010_migrated"];
        for (const key of keys) {
          if (!/^fa_[a-zA-Z0-9_-]+$/.test(key) || forbidden.includes(key)) {
            return json({ error: "\u0627\u0644\u0646\u0633\u062E\u0629 \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0645\u0641\u062A\u0627\u062D \u0645\u062D\u0638\u0648\u0631: " + key }, 400);
          }
        }
        const payloadText = JSON.stringify(body.payload);
        const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
        if (payloadBytes > 20 * 1024 * 1024) return json({ error: "\u062D\u062C\u0645 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0646\u0633\u062E\u0629 \u0623\u0643\u0628\u0631 \u0645\u0646 20 \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A" }, 413);
        const expectedMillis = Date.parse(body.expected_updated_at.trim());
        if (!Number.isFinite(expectedMillis)) return json({ error: "\u0631\u0642\u0645 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
        const response = await supabaseRequest(
          "/rest/v1/rpc/faruj_desktop_shared_state_cas_update",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              p_expected_updated_at: body.expected_updated_at.trim(),
              p_payload: body.payload,
              p_source_device: String(body.source_device || "desktop-device").slice(0, 80)
            })
          }
        );
        const rows = await response.json().catch(function() {
          return null;
        });
        if (!response.ok || !Array.isArray(rows) || !rows.length) {
          return json({
            error: "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643",
            detail: rows,
            supabase_status: response.status,
            hint: rows && rows.code === "57014" ? "\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 PostgreSQL \u062D\u062A\u0649 \u0628\u0639\u062F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0633\u0627\u0631 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u0648\u0633\u0639\u061B \u0644\u0645 \u0646\u0624\u0643\u062F \u0646\u062C\u0627\u062D \u0627\u0644\u062D\u0641\u0638" : void 0
          }, 502);
        }
        const saved = rows[0];
        if (saved.success !== true || saved.conflict === true) {
          return json({
            success: false,
            conflict: true,
            code: "STATE_REVISION_CONFLICT",
            error: "\u062A\u063A\u064A\u0631\u062A \u0627\u0644\u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632 \u0622\u062E\u0631\u061B \u0623\u0639\u062F \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0648\u062F\u0645\u062C\u0647 \u0642\u0628\u0644 \u0627\u0644\u062D\u0641\u0638",
            updated_at: saved.updated_at || null,
            source_device: saved.source_device || null
          }, 409);
        }
        return json({
          success: true,
          updated_at: saved.updated_at,
          source_device: saved.source_device,
          saved_keys: keys.length,
          payload_bytes: payloadBytes
        });
      }
      if (path === "/api/login" && request.method === "POST") {
        const body = await request.json().catch(function() {
          return {};
        });
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!username || !password) {
          return json(
            {
              error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0648\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631"
            },
            400
          );
        }
        const email = DRIVER_EMAILS[username];
        if (!email) {
          return json(
            {
              error: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"
            },
            401
          );
        }
        const authResponse = await supabaseRequest(
          "/auth/v1/token?grant_type=password",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email,
              password
            })
          }
        );
        const authData = await authResponse.json().catch(function() {
          return {};
        });
        if (!authResponse.ok || !authData.access_token) {
          return json(
            {
              error: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"
            },
            401
          );
        }
        const driver = await getDriverInfo(
          authData.access_token,
          env.SUPABASE_ANON_KEY,
          authData.user && authData.user.id
        );
        if (!driver) {
          return json(
            {
              error: "\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645"
            },
            403
          );
        }
        return json({
          access_token: authData.access_token,
          refresh_token: authData.refresh_token,
          expires_in: authData.expires_in,
          username,
          mandoub_name: driver.mandoub_name,
          sheet_name: driver.sheet_name,
          can_call: username === "zain2"
        });
      }
      if (path === "/api/master-login" && request.method === "POST") {
        const body = await request.json().catch(function() {
          return {};
        });
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (username !== MASTER_USERNAME) {
          return json(
            {
              error: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"
            },
            401
          );
        }
        if (!password) {
          return json(
            {
              error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631"
            },
            400
          );
        }
        const authResponse = await supabaseRequest(
          "/auth/v1/token?grant_type=password",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email: MASTER_EMAIL,
              password
            })
          }
        );
        const authData = await authResponse.json().catch(function() {
          return {};
        });
        if (!authResponse.ok || !authData.access_token) {
          return json(
            {
              error: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"
            },
            401
          );
        }
        const user = await getUser(
          authData.access_token,
          env.SUPABASE_ANON_KEY
        );
        if (!user || !user.id) {
          return json(
            {
              error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0627\u0633\u062A\u0631"
            },
            401
          );
        }
        const masterPath = "/rest/v1/master_admins?user_id=eq." + encodeURIComponent(user.id) + "&select=id,user_id,email";
        const masterResponse = await supabaseRequest(
          masterPath,
          {
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + authData.access_token
            }
          }
        );
        const masterRows = await masterResponse.json().catch(function() {
          return [];
        });
        if (!masterResponse.ok || !Array.isArray(masterRows) || masterRows.length === 0) {
          return json(
            {
              error: "\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u064A\u0633 \u062D\u0633\u0627\u0628 \u0645\u0627\u0633\u062A\u0631"
            },
            403
          );
        }
        return json({
          access_token: authData.access_token,
          refresh_token: authData.refresh_token,
          expires_in: authData.expires_in,
          username: MASTER_USERNAME,
          email: MASTER_EMAIL,
          role: "master_admin"
        });
      }
      if (path === "/api/refresh" && request.method === "POST") {
        const body = await request.json().catch(function() {
          return {};
        });
        const refreshToken = String(
          body.refresh_token || ""
        ).trim();
        if (!refreshToken) {
          return json(
            {
              error: "\u0644\u0627 \u064A\u0648\u062C\u062F refresh token"
            },
            401
          );
        }
        const authResponse = await supabaseRequest(
          "/auth/v1/token?grant_type=refresh_token",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              refresh_token: refreshToken
            })
          }
        );
        const authData = await authResponse.json().catch(function() {
          return {};
        });
        if (!authResponse.ok || !authData.access_token) {
          return json(
            {
              error: "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062C\u0644\u0633\u0629"
            },
            401
          );
        }
        const driver = await getDriverInfo(
          authData.access_token,
          env.SUPABASE_ANON_KEY,
          authData.user && authData.user.id
        );
        if (!driver) {
          return json(
            {
              error: "\u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644"
            },
            403
          );
        }
        const username = authData.user && authData.user.email === DRIVER_EMAILS.zain2 ? "zain2" : "zain";
        return json({
          access_token: authData.access_token,
          refresh_token: authData.refresh_token,
          expires_in: authData.expires_in,
          username,
          mandoub_name: driver.mandoub_name,
          sheet_name: driver.sheet_name,
          can_call: username === "zain2"
        });
      }
      if (path === "/api/driver/order/reorder" && request.method === "POST") {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0625\u0639\u062F\u0627\u062F \u062D\u0641\u0638 \u062A\u0631\u062A\u064A\u0628 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: \u0623\u0636\u0641 SUPABASE_SERVICE_ROLE_KEY \u0625\u0644\u0649 \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderIds = Array.isArray(body.order_ids) ? body.order_ids.map(function(value) {
          return String(value == null ? "" : value).trim();
        }) : [];
        const validOrderId = /* @__PURE__ */ __name(function(value) {
          return /^[0-9]+$/.test(value);
        }, "validOrderId");
        if (!orderIds.length || orderIds.some(function(id) {
          return !validOrderId(id);
        }) || new Set(orderIds).size !== orderIds.length) {
          return json({ error: "\u0642\u0627\u0626\u0645\u0629 \u0645\u0639\u0631\u0641\u0627\u062A \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        }
        const sheet = auth.driver.sheet_name;
        const ordersResponse = await supabaseRequest(
          "/rest/v1/orders?select=id,order_number,created_at,customer_name,total,delivery_date&sheet_name=eq." + encodeURIComponent(sheet) + "&id=in.(" + orderIds.join(",") + ")",
          { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
        );
        const ownedOrders = await ordersResponse.json().catch(function() {
          return [];
        });
        if (!ordersResponse.ok || !Array.isArray(ownedOrders) || ownedOrders.length !== orderIds.length) {
          return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0641\u0648\u0627\u062A\u064A\u0631 \u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0627\u0644\u062D\u0627\u0644\u064A", detail: ownedOrders }, 403);
        }
        const todayKey = dubaiDateKey(/* @__PURE__ */ new Date());
        if (ownedOrders.some(function(row) {
          return isFutureDeliveryDate(row.delivery_date, todayKey);
        })) {
          return json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u063A\u064A\u064A\u0631 \u062A\u0631\u062A\u064A\u0628 \u0641\u0648\u0627\u062A\u064A\u0631 \u064A\u0648\u0645 \u0642\u0627\u062F\u0645 \u0642\u0628\u0644 \u064A\u0648\u0645 \u0627\u0644\u062A\u0648\u0635\u064A\u0644", code: "FUTURE_DELIVERY_LOCKED" }, 409);
        }
        const byId = new Map(ownedOrders.map(function(row) {
          return [String(row.id), row];
        }));
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const sortRows = [];
        for (let index = 0; index < orderIds.length; index++) {
          const row = byId.get(orderIds[index]);
          if (!row) return json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0625\u062D\u062F\u0649 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631" }, 404);
          sortRows.push({ invoice_key: await makeSharedInvoiceKey(row), sort_position: index + 1, updated_at: now });
        }
        const saveResponse = await supabaseRequest(
          "/rest/v1/driver_invoice_order_shared?on_conflict=invoice_key",
          { method: "POST", headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(sortRows) }
        );
        const savedRows = await saveResponse.json().catch(function() {
          return [];
        });
        if (!saveResponse.ok) return json({ error: "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u0627\u0644\u062A\u0631\u062A\u064A\u0628 \u0627\u0644\u0645\u0634\u062A\u0631\u0643 - HTTP " + saveResponse.status, detail: savedRows }, 500);
        return json({ success: true, saved: sortRows.length, scope: "shared_invoice_fingerprint" });
      }
      if (path === "/api/orders" && request.method === "GET") {
        const auth = await requireDriver(
          request,
          env
        );
        if (auth.error) {
          return json(
            {
              error: auth.error
            },
            auth.status
          );
        }
        const sheet = auth.driver.sheet_name;
        const dubaiDay = dubaiDateKey(/* @__PURE__ */ new Date());
        const ordersPath = "/rest/v1/orders?sheet_name=eq." + encodeURIComponent(sheet) + "&select=*&delivery_date=gte." + encodeURIComponent(dubaiDay) + "&order=delivery_date.asc,created_at.asc";
        const ordersResponse = await supabaseRequest(
          ordersPath,
          {
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + auth.token
            }
          }
        );
        const orders = await ordersResponse.json().catch(function() {
          return [];
        });
        if (!ordersResponse.ok) {
          return json(
            {
              error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A"
            },
            500
          );
        }
        const winnerServiceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (Array.isArray(orders) && orders.length && winnerServiceKey) {
          const invoiceNumbers = Array.from(new Set(orders.map(function(row) {
            return String(row.order_number || "").trim();
          }).filter(Boolean)));
          if (invoiceNumbers.length) {
            const winnerHeaders = { apikey: winnerServiceKey };
            if (!winnerServiceKey.startsWith("sb_secret_")) winnerHeaders.Authorization = "Bearer " + winnerServiceKey;
            const winnerPath = "/rest/v1/delivery_winners?delivery_date=gte." + encodeURIComponent(dubaiDay) + "&invoice_number=in.(" + invoiceNumbers.map(function(value) {
              return encodeURIComponent(value);
            }).join(",") + ")&select=invoice_number,delivery_date,order_id,sheet_name,driver_user_id,driver_name,accepted_at&limit=10000";
            const winnerResponse = await supabaseRequest(winnerPath, { headers: winnerHeaders });
            const winnerRows = await winnerResponse.json().catch(function() {
              return null;
            });
            if (!winnerResponse.ok || !Array.isArray(winnerRows)) {
              // فشل فحص سجل الفائزين لا يجب أن يعطل تحميل طلبات المندوب.
              // نُبقي حالات orders الأصلية كما هي ولا نفرض حالة تسليم مشتركة غير مؤكدة.
              console.error("delivery_winners lookup failed", {
                status: winnerResponse.status,
                response: winnerRows
              });
            } else {
            const winnerMap = /* @__PURE__ */ new Map();
            for (const winner of winnerRows) {
              const key = String(winner.invoice_number || "").trim().toUpperCase().replace(/\s+/g, "") + "|" + String(winner.delivery_date || "").slice(0, 10);
              if (key !== "|") winnerMap.set(key, winner);
            }
            for (const row of orders) {
              const key = String(row.order_number || "").trim().toUpperCase().replace(/\s+/g, "") + "|" + String(row.delivery_date || "").slice(0, 10);
              const winner = winnerMap.get(key);
              if (!winner) continue;
              row.delivery_status = "delivered";
              row._delivery_winner = {
                driver_user_id: winner.driver_user_id || null,
                driver_name: winner.driver_name || "",
                accepted_at: winner.accepted_at || null,
                sheet_name: winner.sheet_name || ""
              };
              row._delivered_by_other = String(winner.driver_user_id || "").toLowerCase() !== String(auth.user.id || "").toLowerCase();
            }
            }
          }
        }
        const canCall = auth.user.email === DRIVER_EMAILS.zain2;
        const safeOrders = (Array.isArray(orders) ? orders : []).map(function(row) {
          const paymentText = String(row.payment_method || "").trim().toLowerCase();
          const monthlyContractDeferred = paymentText === "\u062A\u0639\u0627\u0642\u062F \u0634\u0647\u0631\u064A" || paymentText === "monthly contract" || row.monthly_contract_deferred === true || row.monthly_contract_deferred === 1 || row.is_monthly_contract === true || row.is_monthly_contract === 1;
          const cleaned = Object.assign({}, row, {
            _delivery_locked: isFutureDeliveryDate(row.delivery_date, dubaiDay),
            plate_names: stripEmojiText(row.plate_names),
            plate_qtys: stripEmojiText(row.plate_qtys),
            chicken_weights: stripEmojiText(row.chicken_weights),
            chicken_qtys: stripEmojiText(row.chicken_qtys),
            customer_name: stripEmojiText(row.customer_name),
            monthly_contract_deferred: monthlyContractDeferred
          });
          if (canCall) return cleaned;
          return Object.assign({}, cleaned, { phone: "" });
        });
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const ids = safeOrders.map(function(row) {
            return Number(row.id);
          }).filter(function(id) {
            return Number.isInteger(id) && id > 0;
          });
          if (ids.length) {
            const departureResponse = await supabaseRequest(
              "/rest/v1/driver_departures?order_id=in.(" + ids.join(",") + ")&select=order_id,departed_at",
              { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
            );
            const departureRows = await departureResponse.json().catch(function() {
              return [];
            });
            if (departureResponse.ok && Array.isArray(departureRows)) {
              const departureMap = new Map(departureRows.map(function(row) {
                return [Number(row.order_id), row.departed_at];
              }));
              safeOrders.forEach(function(row) {
                row.driver_departure_at = departureMap.get(Number(row.id)) || null;
              });
            }
          }
        }
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const locNumbers = Array.from(new Set(safeOrders.map(function(row) {
            return String(row.order_number || "").trim();
          }).filter(Boolean)));
          if (locNumbers.length) {
            const locResponse = await supabaseRequest(
              "/rest/v1/orders?order_number=in.(" + locNumbers.map(function(v) {
                return encodeURIComponent(v);
              }).join(",") + ")&select=order_number,location_url",
              { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
            );
            const locRows = await locResponse.json().catch(function() {
              return [];
            });
            if (locResponse.ok && Array.isArray(locRows)) {
              const locMap = /* @__PURE__ */ new Map();
              for (const r of locRows) {
                const u = String(r.location_url || "").trim();
                const k = String(r.order_number || "").trim();
                if (u && k && !locMap.has(k)) locMap.set(k, u);
              }
              for (const row of safeOrders) {
                const k = String(row.order_number || "").trim();
                if (k && !String(row.location_url || "").trim() && locMap.has(k)) row.location_url = locMap.get(k);
              }
            }
          }
        }
        if (safeOrders.length && env.SUPABASE_SERVICE_ROLE_KEY) {
          const sortResponse = await supabaseRequest(
            "/rest/v1/driver_invoice_order_shared?select=invoice_key,sort_position",
            { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
          );
          const sortRows = await sortResponse.json().catch(function() {
            return [];
          });
          if (sortResponse.ok && Array.isArray(sortRows)) {
            const positionMap = new Map(sortRows.map(function(row) {
              return [String(row.invoice_key), Number(row.sort_position)];
            }));
            for (const row of safeOrders) {
              const key = await makeSharedInvoiceKey(row);
              const position = positionMap.get(key);
              if (Number.isFinite(position) && position > 0) row._driver_sort_position = position;
            }
          }
        }
        return json({
          orders: safeOrders,
          sheet,
          mandoub_name: auth.driver.mandoub_name,
          can_call: canCall
        });
      }
      if (path === "/api/master/orders" && request.method === "GET") {
        let readCursor = function(name) {
          const raw = url.searchParams.get(name);
          if (raw === null || raw === "") return 0;
          const value = Number(raw);
          return Number.isSafeInteger(value) && value >= 0 ? value : null;
        };
        __name(readCursor, "readCursor");
        const auth = await requireMaster(
          request,
          env
        );
        if (auth.error) {
          return json(
            {
              error: auth.error
            },
            auth.status
          );
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        const masterReadHeaders = serviceKey ? { apikey: serviceKey, Authorization: "Bearer " + serviceKey } : { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + auth.token };
        const pageSize = 250;
        const activeAfter = readCursor("active_after");
        const archiveAfter = readCursor("archive_after");
        if (activeAfter === null || archiveAfter === null) {
          return json({ error: "\u0645\u0624\u0634\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D." }, 400);
        }
        async function readMasterPage(tableName, afterId) {
          const query = "?select=*&id=gt." + afterId + "&order=id.asc&limit=" + pageSize;
          const response = await supabaseRequest("/rest/v1/" + tableName + query, {
            headers: masterReadHeaders
          });
          const rows = await response.json().catch(function() {
            return null;
          });
          if (!response.ok || !Array.isArray(rows)) {
            return {
              ok: false,
              status: response.status,
              error: rows && (rows.message || rows.details || rows.hint || rows.error) ? rows.message || rows.details || rows.hint || rows.error : "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062C\u062F\u0648\u0644 " + tableName
            };
          }
          const last = rows.length ? Number(rows[rows.length - 1].id) : afterId;
          if (!Number.isSafeInteger(last) || last < afterId) {
            return { ok: false, status: 502, error: "\u062A\u0639\u0630\u0631 \u0645\u062A\u0627\u0628\u0639\u0629 \u0642\u0631\u0627\u0621\u0629 \u062C\u062F\u0648\u0644 " + tableName + " \u0628\u0633\u0628\u0628 \u0645\u0624\u0634\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D." };
          }
          return { ok: true, rows, next: last, hasMore: rows.length === pageSize };
        }
        __name(readMasterPage, "readMasterPage");
        const [activeResult, archiveResult] = await Promise.all([
          readMasterPage("orders", activeAfter),
          readMasterPage("master_orders_archive", archiveAfter)
        ]);
        if (!activeResult.ok || !archiveResult.ok) {
          return json({
            error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u062F\u0641\u0639\u0629 \u0641\u0648\u0627\u062A\u064A\u0631 \u0627\u0644\u0645\u0627\u0633\u062A\u0631.",
            orders_error: activeResult.ok ? null : activeResult.error,
            archive_error: archiveResult.ok ? null : archiveResult.error
          }, 502);
        }
        const activeRows = activeResult.rows.map(function(row) {
          return Object.assign({}, row, { _master_source: "orders" });
        });
        const archivedRows = archiveResult.rows.map(function(row) {
          return Object.assign({}, row, { _master_source: "master_orders_archive" });
        });
        return json({
          orders: activeRows.concat(archivedRows),
          active_count: activeRows.length,
          archived_count: archivedRows.length,
          next_active_after: activeResult.next,
          next_archive_after: archiveResult.next,
          has_more_active: activeResult.hasMore,
          has_more_archive: archiveResult.hasMore,
          username: MASTER_USERNAME,
          email: MASTER_EMAIL,
          role: "master_admin"
        });
      }
      if (path === "/api/master/customer-balances" && request.method === "GET") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0639\u0631\u0636 \u0623\u0631\u0635\u062F\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644" }, 500);
        }
        const response = await supabaseRequest(
          "/rest/v1/customer_balances?select=customer_code,customer_name,phone,amount_added,amount_paid,current_balance,notes,area,emirate,order_ref,updated_at&order=customer_code.asc",
          {
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY
            }
          }
        );
        const balances = await response.json().catch(function() {
          return null;
        });
        if (!response.ok) {
          return json({ error: balances && (balances.message || balances.hint || balances.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0623\u0631\u0635\u062F\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621" }, 502);
        }
        return json({ balances: Array.isArray(balances) ? balances : [] });
      }
      if (path === "/api/driver/heading-to-customer" && request.method === "POST") {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u062D\u0631\u0643 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: \u0623\u0636\u0641 SUPABASE_SERVICE_ROLE_KEY \u0625\u0644\u0649 \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderId = Number(body.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        const orderResponse = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) + "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) + "&select=id,order_number,customer_name,phone,emirate,area,total,sheet_name,delivery_date&limit=1",
          { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
        );
        const orderRows = await orderResponse.json().catch(function() {
          return null;
        });
        if (!orderResponse.ok) return json({ error: orderRows && (orderRows.message || orderRows.hint || orderRows.error) || "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629" }, 502);
        if (!Array.isArray(orderRows) || !orderRows.length) return json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0636\u0645\u0646 \u0637\u0644\u0628\u0627\u062A \u062D\u0633\u0627\u0628\u0643" }, 404);
        const order = orderRows[0];
        const futureLock = rejectFutureDelivery(order, dubaiDateKey(/* @__PURE__ */ new Date()));
        if (futureLock) return futureLock;
        const existingResponse = await supabaseRequest(
          "/rest/v1/driver_departures?order_id=eq." + encodeURIComponent(orderId) + "&select=order_id,departed_at&limit=1",
          { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }
        );
        const existingRows = await existingResponse.json().catch(function() {
          return null;
        });
        if (!existingResponse.ok) return json({ error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0633\u062C\u0644 \u0627\u0644\u062A\u062D\u0631\u0643. \u062A\u0623\u0643\u062F \u0645\u0646 \u0625\u0646\u0634\u0627\u0621 \u062C\u062F\u0648\u0644 driver_departures \u0645\u0646 SQL \u0627\u0644\u0645\u0631\u0641\u0642." }, 502);
        if (Array.isArray(existingRows) && existingRows.length) return json({ success: true, already_marked: true, departed_at: existingRows[0].departed_at });
        const departedAt = (/* @__PURE__ */ new Date()).toISOString();
        const insertResponse = await supabaseRequest("/rest/v1/driver_departures", {
          method: "POST",
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ order_id: order.id, invoice_number: String(order.order_number || order.id), customer_name: String(order.customer_name || ""), phone: String(order.phone || ""), emirate: String(order.emirate || ""), area: String(order.area || ""), total: Number(order.total) || 0, sheet_name: String(auth.driver.sheet_name || ""), driver_name: String(auth.driver.mandoub_name || ""), driver_user_id: auth.user.id, departed_at: departedAt })
        });
        const insertData = await insertResponse.json().catch(function() {
          return null;
        });
        if (!insertResponse.ok) {
          if (insertResponse.status === 409) {
            const retryResponse = await supabaseRequest("/rest/v1/driver_departures?order_id=eq." + encodeURIComponent(orderId) + "&select=departed_at&limit=1", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } });
            const retryRows = await retryResponse.json().catch(function() {
              return [];
            });
            if (Array.isArray(retryRows) && retryRows.length) return json({ success: true, already_marked: true, departed_at: retryRows[0].departed_at });
          }
          return json({ error: insertData && (insertData.message || insertData.hint || insertData.error) || "\u062A\u0639\u0630\u0631 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062A\u062D\u0631\u0643" }, 502);
        }
        return json({ success: true, already_marked: false, departed_at: Array.isArray(insertData) && insertData[0] ? insertData[0].departed_at : departedAt });
      }
      if (path === "/api/master/driver-departures" && request.method === "GET") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u062D\u0631\u0643 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644" }, 500);
        const response = await supabaseRequest("/rest/v1/driver_departures?select=*&order=departed_at.desc&limit=100", {
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }
        });
        const rows = await response.json().catch(function() {
          return null;
        });
        if (!response.ok) return json({ error: rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u062D\u0631\u0643" }, 502);
        return json({ departures: Array.isArray(rows) ? rows : [] });
      }
      if (path === "/api/payment" && request.method === "POST") {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderId = Number(body.orderId);
        const paymentMethod = normalizePayment(body.payment_method);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        if (!paymentMethod) {
          return json({ error: "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        }
        const paymentServiceKey = String(
          env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ""
        ).trim();
        if (!paymentServiceKey) {
          return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: \u0623\u0636\u0641 SUPABASE_SECRET_KEY \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        }
        const paymentHeaders = { apikey: paymentServiceKey };
        if (!paymentServiceKey.startsWith("sb_secret_")) {
          paymentHeaders.Authorization = "Bearer " + paymentServiceKey;
        }
        const sourceResponse = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) + "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) + "&select=id,order_number,customer_name,sheet_name,paid_in_advance,delivery_status,delivery_date&limit=1",
          { headers: paymentHeaders }
        );
        const sourceRows = await sourceResponse.json().catch(function() {
          return null;
        });
        if (!sourceResponse.ok) {
          return json({ error: sourceRows && (sourceRows.message || sourceRows.hint || sourceRows.error) || "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0642\u0628\u0644 \u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u062F\u0641\u0639" }, 502);
        }
        if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
          return json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0636\u0645\u0646 \u0637\u0644\u0628\u0627\u062A \u062D\u0633\u0627\u0628\u0643" }, 404);
        }
        const sourceOrder = sourceRows[0];
        const futurePaymentLock = rejectFutureDelivery(sourceOrder, dubaiDateKey(/* @__PURE__ */ new Date()));
        if (futurePaymentLock) return futurePaymentLock;
        if (sourceOrder.paid_in_advance === true) {
          return json({ error: "\u0647\u0630\u0647 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u062F\u0641\u0648\u0639\u0629 \u0645\u0642\u062F\u0645\u064B\u0627\u060C \u0648\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u062F\u0641\u0639 \u0645\u0646 \u0627\u0644\u0643\u0645\u0628\u064A\u0648\u062A\u0631 \u0641\u0642\u0637" }, 403);
        }
        if (String(sourceOrder.delivery_status || "").toLowerCase() === "delivered" || String(sourceOrder.delivery_status || "").includes("\u062A\u0645 \u0627\u0644\u062A\u0633\u0644\u064A\u0645")) {
          return json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u063A\u064A\u064A\u0631 \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u0628\u0639\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645" }, 409);
        }
        const invoiceNumber = String(sourceOrder.order_number || "").trim();
        if (!invoiceNumber) {
          return json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0644\u0627 \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0631\u0642\u0645 \u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u0645\u0643\u0646 \u0645\u0632\u0627\u0645\u0646\u062A\u0647" }, 400);
        }
        const duplicatesResponse = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber) + "&select=id",
          { headers: paymentHeaders }
        );
        const duplicateRows = await duplicatesResponse.json().catch(function() {
          return null;
        });
        if (!duplicatesResponse.ok || !Array.isArray(duplicateRows) || duplicateRows.length === 0) {
          return json({ error: duplicateRows && (duplicateRows.message || duplicateRows.hint || duplicateRows.error) || "\u062A\u0639\u0630\u0631 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0646\u0633\u062E \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0644\u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u062F\u0641\u0639" }, 502);
        }
        const updateOrdersResponse = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, paymentHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=representation"
            }),
            body: JSON.stringify({ payment_method: paymentMethod })
          }
        );
        const updatedOrders = await updateOrdersResponse.json().catch(function() {
          return null;
        });
        if (!updateOrdersResponse.ok) {
          return json({ error: updatedOrders && (updatedOrders.message || updatedOrders.hint || updatedOrders.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u0639\u0646\u062F \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628" }, 502);
        }
        const archiveResponse = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, paymentHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=representation"
            }),
            body: JSON.stringify({ payment_method: paymentMethod })
          }
        );
        const archiveData = await archiveResponse.json().catch(function() {
          return null;
        });
        if (!archiveResponse.ok) {
          return json({ error: archiveData && (archiveData.message || archiveData.hint || archiveData.error) || "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628 \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u0641\u064A \u0627\u0644\u0645\u0627\u0633\u062A\u0631" }, 502);
        }
        return json({
          success: true,
          payment_method: paymentMethod,
          payment_label: paymentLabel(paymentMethod),
          synced_orders: Array.isArray(updatedOrders) ? updatedOrders.length : duplicateRows.length,
          synced_master: Array.isArray(archiveData) ? archiveData.length : 0
        });
      }
      if (path === "/api/deliver" && request.method === "POST") {
        const auth = await requireDriver(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderId = Number(body.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: \u0623\u0636\u0641 SUPABASE_SECRET_KEY \u0623\u0648 SUPABASE_SERVICE_ROLE_KEY" }, 500);
        const serviceHeaders = { apikey: serviceKey };
        if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.Authorization = "Bearer " + serviceKey;
        const orderResponse = await supabaseRequest(
          "/rest/v1/orders?id=eq." + encodeURIComponent(orderId) + "&sheet_name=eq." + encodeURIComponent(auth.driver.sheet_name) + "&select=id,order_number,customer_name,sheet_name,delivery_status,paid_in_advance,delivery_date&limit=1",
          { headers: serviceHeaders }
        );
        const orderRows = await orderResponse.json().catch(function() {
          return null;
        });
        if (!orderResponse.ok) return json({ error: orderRows && (orderRows.message || orderRows.hint || orderRows.error) || "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629" }, 502);
        if (!Array.isArray(orderRows) || !orderRows.length) return json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0636\u0645\u0646 \u0637\u0644\u0628\u0627\u062A \u062D\u0633\u0627\u0628\u0643" }, 404);
        const order = orderRows[0];
        const futureDeliveryLock = rejectFutureDelivery(order, dubaiDateKey(/* @__PURE__ */ new Date()));
        if (futureDeliveryLock) return futureDeliveryLock;
        if (String(order.delivery_status || "").toLowerCase() === "delivered" || String(order.delivery_status || "").includes("\u062A\u0645 \u0627\u0644\u062A\u0633\u0644\u064A\u0645")) {
          return json({ success: true, already_delivered: true, delivery_status: order.delivery_status });
        }
        const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
        const requestResponse = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?on_conflict=order_id",
          {
            method: "POST",
            headers: Object.assign({}, serviceHeaders, {
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=representation"
            }),
            body: JSON.stringify({
              order_id: order.id,
              invoice_number: String(order.order_number || order.id),
              sheet_name: String(auth.driver.sheet_name || ""),
              driver_user_id: auth.user.id,
              driver_name: String(auth.driver.mandoub_name || ""),
              status: "pending",
              requested_at: requestedAt
            })
          }
        );
        const requestData = await requestResponse.json().catch(function() {
          return null;
        });
        if (!requestResponse.ok) {
          return json({ error: requestData && (requestData.message || requestData.hint || requestData.error) || "\u062A\u0639\u0630\u0631 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0644\u062A\u0633\u0644\u064A\u0645. \u062A\u0623\u0643\u062F \u0645\u0646 \u0625\u0646\u0634\u0627\u0621 \u062C\u062F\u0648\u0644 driver_delivery_requests" }, 502);
        }
        return json({ success: true, delivery_requested: true, delivery_status: "pending", requested_at: requestedAt });
      }
      if (path === "/api/master/order/update" && request.method === "POST") {
        const auth = await requireMaster(
          request,
          env
        );
        if (auth.error) {
          return json(
            {
              error: auth.error
            },
            auth.status
          );
        }
        const body = await request.json().catch(function() {
          return {};
        });
        const orderId = Number(body.orderId);
        const order = body.order;
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json(
            {
              error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D"
            },
            400
          );
        }
        if (!order || typeof order !== "object") {
          return json(
            {
              error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"
            },
            400
          );
        }
        const rpcResponse = await supabaseRequest(
          "/rest/v1/rpc/master_update_order",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + auth.token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              p_order_id: orderId,
              p_order: order
            })
          }
        );
        let rpcData = await rpcResponse.json().catch(function() {
          return null;
        });
        if (!rpcResponse.ok) {
          const svcKeyFb = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
          let fallbackRow = null;
          if (svcKeyFb) {
            const directPatch = Object.assign({}, order);
            delete directPatch.id;
            directPatch.updated_at = (/* @__PURE__ */ new Date()).toISOString();
            const archResp = await supabaseRequest(
              "/rest/v1/master_orders_archive?id=eq." + encodeURIComponent(orderId),
              {
                method: "PATCH",
                headers: {
                  apikey: svcKeyFb,
                  Authorization: "Bearer " + svcKeyFb,
                  "Content-Type": "application/json",
                  Prefer: "return=representation"
                },
                body: JSON.stringify(directPatch)
              }
            );
            const archRows = await archResp.json().catch(function() {
              return null;
            });
            if (archResp.ok && Array.isArray(archRows) && archRows.length) {
              fallbackRow = archRows[0];
            }
            if (!fallbackRow) {
              const fbOrdNo = String(order.order_number || "").trim();
              const fbSheet = String(order.sheet_name || "").trim();
              if (fbOrdNo && fbSheet) {
                const archResp2 = await supabaseRequest(
                  "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(fbOrdNo) + "&sheet_name=eq." + encodeURIComponent(fbSheet),
                  {
                    method: "PATCH",
                    headers: {
                      apikey: svcKeyFb,
                      Authorization: "Bearer " + svcKeyFb,
                      "Content-Type": "application/json",
                      Prefer: "return=representation"
                    },
                    body: JSON.stringify(directPatch)
                  }
                );
                const archRows2 = await archResp2.json().catch(function() {
                  return null;
                });
                if (archResp2.ok && Array.isArray(archRows2) && archRows2.length) {
                  fallbackRow = archRows2[0];
                }
              }
            }
          }
          if (fallbackRow) {
            rpcData = fallbackRow;
          } else {
            return json(
              {
                error: [
                  rpcData && rpcData.message,
                  rpcData && rpcData.details,
                  rpcData && rpcData.hint,
                  rpcData && rpcData.code ? "Code: " + rpcData.code : null,
                  rpcData && rpcData.error
                ].filter(Boolean).join(" | ") || "\u062A\u0639\u0630\u0631 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629"
              },
              400
            );
          }
        }
        if (Object.prototype.hasOwnProperty.call(order, "payment_method")) {
          const rawPaymentMethod = order.payment_method;
          const rawPaymentText = String(rawPaymentMethod == null ? "" : rawPaymentMethod).trim().toLowerCase();
          const isUnselectedPayment = rawPaymentMethod == null || rawPaymentText === "" || rawPaymentText === "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F" || rawPaymentText === "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629" || rawPaymentText === "unselected" || rawPaymentText === "not_set";
          const paymentMethod = isUnselectedPayment ? null : normalizePayment(rawPaymentMethod);
          if (!isUnselectedPayment && !paymentMethod) {
            return json({ error: "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629. \u0627\u0644\u0642\u064A\u0645 \u0627\u0644\u0645\u0642\u0628\u0648\u0644\u0629: \u063A\u064A\u0631 \u0645\u062D\u062F\u062F \u0623\u0648 \u0643\u0627\u0634 \u0623\u0648 \u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A." }, 400);
          }
          const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
          if (!serviceKey) {
            return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0645\u0632\u0627\u0645\u0646\u0629 \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: SUPABASE_SERVICE_ROLE_KEY" }, 500);
          }
          const rawIds = Array.isArray(body.invoiceCopyIds) ? body.invoiceCopyIds : [orderId];
          const copyIds = Array.from(new Set(rawIds.concat([orderId]).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
          if (!copyIds.length || copyIds.length > 20) {
            return json({ error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062F \u0646\u0633\u062E \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u0627\u062F \u062A\u062D\u062F\u064A\u062B\u0647\u0627" }, 400);
          }
          const serviceHeaders = {
            apikey: serviceKey,
            Authorization: "Bearer " + serviceKey,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          };
          const paymentPatch = {
            payment_method: paymentMethod,
            bank_transfer_received: paymentMethod === "bank_transfer" ? order.bank_transfer_received === true : false
          };
          if (typeof order.created_at === "string" && !Number.isNaN(new Date(order.created_at).getTime())) {
            paymentPatch.created_at = new Date(order.created_at).toISOString();
          }
          paymentPatch.updated_at = (/* @__PURE__ */ new Date()).toISOString();
          const paymentBody = JSON.stringify(paymentPatch);
          const idFilter = "in.(" + copyIds.join(",") + ")";
          const ordersPaymentResponse = await supabaseRequest(
            "/rest/v1/orders?id=" + encodeURIComponent(idFilter),
            { method: "PATCH", headers: serviceHeaders, body: paymentBody }
          );
          if (!ordersPaymentResponse.ok) {
            const paymentError = await ordersPaymentResponse.json().catch(function() {
              return null;
            });
            return json({ error: paymentError && (paymentError.message || paymentError.hint || paymentError.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639 \u0641\u064A \u0646\u0633\u062E \u0627\u0644\u0645\u0646\u062F\u0648\u0628\u064A\u0646" }, 502);
          }
          const archivePaymentResponse = await supabaseRequest(
            "/rest/v1/master_orders_archive?id=" + encodeURIComponent(idFilter),
            { method: "PATCH", headers: serviceHeaders, body: paymentBody }
          );
          if (!archivePaymentResponse.ok) {
            const paymentError = await archivePaymentResponse.json().catch(function() {
              return null;
            });
            return json({ error: paymentError && (paymentError.message || paymentError.hint || paymentError.error) || "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0646\u062F\u0648\u0628\u064A\u0646 \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631" }, 502);
          }
        }
        const invoiceNumber = String(
          rpcData && (rpcData.order_number || rpcData.invoice_number) || order.order_number || order.invoice_number || ""
        ).trim();
        if (invoiceNumber) {
          const archivePatchBody = {};
          const archiveFields = [
            "customer_name",
            "phone",
            "emirate",
            "area",
            "chicken_weights",
            "chicken_qtys",
            "plate_names",
            "plate_qtys",
            "total",
            "location_url",
            "note",
            "appointment_coordinator",
            "payment_method",
            "delivery_status",
            "gate_photo_url",
            "gate_photo_urls",
            "driver_notes",
            "delivery_fee",
            "paid_in_advance",
            "bank_transfer_received",
            "created_at",
            "delivery_date"
          ];
          for (const field of archiveFields) {
            if (rpcData && Object.prototype.hasOwnProperty.call(rpcData, field)) {
              archivePatchBody[field] = rpcData[field];
            }
          }
          archivePatchBody.updated_at = (/* @__PURE__ */ new Date()).toISOString();
          if (typeof order.created_at === "string" && !Number.isNaN(new Date(order.created_at).getTime())) {
            archivePatchBody.created_at = new Date(order.created_at).toISOString();
          }
          if (Object.prototype.hasOwnProperty.call(order, "delivery_date")) {
            const deliveryDate = order.delivery_date == null ? null : String(order.delivery_date).trim();
            if (deliveryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
              return json({ error: "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
            }
            archivePatchBody.delivery_date = deliveryDate;
          }
          if (Object.prototype.hasOwnProperty.call(order, "payment_method")) {
            const archiveRawPayment = order.payment_method;
            const archivePaymentText = String(archiveRawPayment == null ? "" : archiveRawPayment).trim().toLowerCase();
            const archivePaymentUnselected = archiveRawPayment == null || archivePaymentText === "" || archivePaymentText === "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F" || archivePaymentText === "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629" || archivePaymentText === "unselected" || archivePaymentText === "not_set";
            archivePatchBody.payment_method = archivePaymentUnselected ? null : normalizePayment(archiveRawPayment);
            archivePatchBody.bank_transfer_received = archivePatchBody.payment_method === "bank_transfer" ? order.bank_transfer_received === true : false;
          }
          const archivePatchResponse = await supabaseRequest(
            "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
            {
              method: "PATCH",
              headers: {
                apikey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
                Authorization: "Bearer " + (env.SUPABASE_SERVICE_ROLE_KEY || auth.token),
                "Content-Type": "application/json",
                Prefer: "return=minimal"
              },
              body: JSON.stringify(archivePatchBody)
            }
          );
          if (!archivePatchResponse.ok) {
            const archiveError = await archivePatchResponse.json().catch(function() {
              return null;
            });
            return json({
              error: archiveError && (archiveError.message || archiveError.hint || archiveError.error) || "\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0637\u0644\u0628\u060C \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0646\u0633\u062E\u0629 \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631"
            }, 502);
          }
        }
        return json({
          success: true,
          order: rpcData
        });
      }
      if (path === "/api/master/order/delete" && request.method === "POST") {
        const auth = await requireMaster(
          request,
          env
        );
        if (auth.error) {
          return json(
            {
              error: auth.error
            },
            auth.status
          );
        }
        const body = await request.json().catch(function() {
          return {};
        });
        const orderId = Number(body.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json(
            {
              error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D"
            },
            400
          );
        }
        const rpcResponse = await supabaseRequest(
          "/rest/v1/rpc/master_delete_order",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + auth.token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              p_order_id: orderId
            })
          }
        );
        const rpcData = await rpcResponse.json().catch(function() {
          return null;
        });
        if (!rpcResponse.ok) {
          const archiveDeleteResponse2 = await supabaseRequest(
            "/rest/v1/master_orders_archive?id=eq." + encodeURIComponent(orderId),
            {
              method: "DELETE",
              headers: {
                apikey: env.SUPABASE_ANON_KEY,
                Authorization: "Bearer " + auth.token,
                Prefer: "return=representation"
              }
            }
          );
          const archivedRows = await archiveDeleteResponse2.json().catch(function() {
            return [];
          });
          if (archiveDeleteResponse2.ok && Array.isArray(archivedRows) && archivedRows.length > 0) {
            return json({
              success: true,
              data: archivedRows[0],
              archived_only: true
            });
          }
          return json(
            {
              error: rpcData && rpcData.message || rpcData && rpcData.hint || rpcData && rpcData.error || "\u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629"
            },
            400
          );
        }
        const archiveDeleteResponse = await supabaseRequest(
          "/rest/v1/master_orders_archive?id=eq." + encodeURIComponent(orderId),
          {
            method: "DELETE",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + auth.token,
              Prefer: "return=representation"
            }
          }
        );
        if (!archiveDeleteResponse.ok) {
          const archiveError = await archiveDeleteResponse.json().catch(function() {
            return null;
          });
          return json(
            {
              error: archiveError && (archiveError.message || archiveError.hint || archiveError.error) || "\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0646\u0633\u062E\u0629 \u0627\u0644\u0623\u0631\u0634\u064A\u0641"
            },
            500
          );
        }
        return json({
          success: true,
          data: rpcData
        });
      }
      if (path === "/api/master/transfer-received" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) {
          return json({ error: auth.error }, auth.status);
        }
        const body = await request.json().catch(function() {
          return {};
        });
        const orderId = Number(body.orderId);
        const received = body.received === true;
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        const rpcResponse = await supabaseRequest(
          "/rest/v1/rpc/master_set_transfer_received",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + auth.token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              p_order_id: orderId,
              p_received: received
            })
          }
        );
        const rpcData = await rpcResponse.json().catch(function() {
          return null;
        });
        if (!rpcResponse.ok) {
          return json({
            error: rpcData && rpcData.message || rpcData && rpcData.hint || rpcData && rpcData.error || "\u062A\u0639\u0630\u0631 \u062D\u0641\u0638 \u062A\u0623\u0643\u064A\u062F \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062A\u062D\u0648\u064A\u0644"
          }, 400);
        }
        return json({
          success: true,
          order: rpcData,
          bank_transfer_received: received
        });
      }
      if (path === "/api/gate-photo/delete" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) {
          return json({ error: "\u0625\u0639\u062F\u0627\u062F \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: \u0623\u0636\u0641 SUPABASE_SERVICE_ROLE_KEY \u0625\u0644\u0649 \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        }
        const body = await request.json().catch(function() {
          return {};
        });
        const invoiceNumber = String(body.invoice_number || "").trim();
        if (!invoiceNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(invoiceNumber)) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        if (body.confirm_delete !== true) {
          return json({ error: "\u064A\u062C\u0628 \u062A\u0623\u0643\u064A\u062F \u062D\u0630\u0641 \u0635\u0648\u0631\u0629 \u0627\u0644\u0628\u0648\u0627\u0628\u0629 \u0628\u0625\u0631\u0633\u0627\u0644 confirm_delete: true" }, 400);
        }
        const authHeaders = {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey
        };
        const queryPath = "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber) + "&select=id,order_number,gate_photo_url,gate_photo_urls";
        const ordersResponse = await supabaseRequest(queryPath, { headers: authHeaders });
        const ordersData = await ordersResponse.json().catch(function() {
          return null;
        });
        if (!ordersResponse.ok || !Array.isArray(ordersData)) {
          return json({
            error: ordersData && (ordersData.message || ordersData.hint || ordersData.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0635\u0648\u0631 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0646 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A"
          }, 502);
        }
        if (ordersData.length === 0) {
          return json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0641\u064A \u062C\u062F\u0648\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A\u061B \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0623\u064A \u0645\u0644\u0641" }, 404);
        }
        const bucketName = "gate-photos 3";
        const bucketMarker = "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/";
        const prefixes = [];
        const addPhotoPath = /* @__PURE__ */ __name(function(photoUrl) {
          const value = String(photoUrl || "").trim();
          const markerIndex = value.indexOf(bucketMarker);
          if (markerIndex < 0) return;
          const pathPart = value.slice(markerIndex + bucketMarker.length).split("?")[0];
          let decodedPath;
          try {
            decodedPath = pathPart.split("/").map(function(part) {
              return decodeURIComponent(part);
            }).join("/");
          } catch (_) {
            return;
          }
          if (decodedPath.startsWith("invoices/") && !decodedPath.includes("..")) {
            if (!prefixes.includes(decodedPath)) prefixes.push(decodedPath);
          }
        }, "addPhotoPath");
        for (const row of ordersData) {
          addPhotoPath(row.gate_photo_url);
          let photos = row.gate_photo_urls;
          if (typeof photos === "string") {
            try {
              photos = JSON.parse(photos);
            } catch (_) {
              photos = [];
            }
          }
          if (Array.isArray(photos)) {
            for (const photo of photos) {
              addPhotoPath(typeof photo === "string" ? photo : photo && (photo.url || photo.gate_photo_url) || "");
            }
          }
        }
        if (prefixes.length > 0) {
          const encodedBucket = encodeURIComponent(bucketName);
          const deleteResponse = await supabaseRequest(
            "/storage/v1/object/" + encodedBucket,
            {
              method: "DELETE",
              headers: Object.assign({}, authHeaders, {
                "Content-Type": "application/json"
              }),
              body: JSON.stringify({ prefixes })
            }
          );
          const deleteData = await deleteResponse.json().catch(function() {
            return null;
          });
          if (!deleteResponse.ok) {
            return json({
              error: deleteData && (deleteData.message || deleteData.error) || "\u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u0645\u0646 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u062D\u0627\u0628\u064A\u061B \u0644\u0645 \u064A\u062A\u0645 \u0645\u0633\u062D \u0631\u0648\u0627\u0628\u0637\u0647\u0627 \u0645\u0646 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A",
              photo_count: prefixes.length
            }, 502);
          }
        }
        const patchResponse = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, authHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=representation"
            }),
            body: JSON.stringify({ gate_photo_url: null, gate_photo_urls: [] })
          }
        );
        const patchData = await patchResponse.json().catch(function() {
          return null;
        });
        if (!patchResponse.ok) {
          return json({
            error: patchData && (patchData.message || patchData.hint || patchData.error) || "\u062A\u0645 \u0637\u0644\u0628 \u062D\u0630\u0641 \u0627\u0644\u0635\u0648\u0631 \u0645\u0646 \u0627\u0644\u062A\u062E\u0632\u064A\u0646\u060C \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u0645\u0633\u062D \u0631\u0648\u0627\u0628\u0637\u0647\u0627 \u0645\u0646 \u062C\u062F\u0648\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A",
            photos_deleted: prefixes.length
          }, 502);
        }
        const archiveResponse = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(invoiceNumber),
          {
            method: "PATCH",
            headers: Object.assign({}, authHeaders, {
              "Content-Type": "application/json",
              Prefer: "return=minimal"
            }),
            body: JSON.stringify({ gate_photo_url: null, gate_photo_urls: [] })
          }
        );
        if (!archiveResponse.ok && archiveResponse.status !== 404) {
          return json({
            error: "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0637\u0644\u0628\u0627\u062A\u060C \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u0645\u0633\u062D \u0631\u0627\u0628\u0637 \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u0646 \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631",
            photos_deleted: prefixes.length
          }, 502);
        }
        return json({
          success: true,
          invoice_number: invoiceNumber,
          photos_deleted: prefixes.length,
          message: "\u062A\u0645 \u062D\u0630\u0641 \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631 \u0627\u0644\u0628\u0648\u0627\u0628\u0629 \u0645\u0646 \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0648\u0627\u0644\u0623\u0631\u0634\u064A\u0641"
        });
      }
      if (path === "/api/gate-photo" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        }
        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644" }, 500);
        }
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.toLowerCase().includes("multipart/form-data")) {
          return json({ error: "\u064A\u062C\u0628 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0635\u0648\u0631 \u0628\u0635\u064A\u063A\u0629 multipart/form-data" }, 400);
        }
        const form = await request.formData().catch(function() {
          return null;
        });
        if (!form) {
          return json({ error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0635\u0648\u0631" }, 400);
        }
        const invoiceNumber = String(form.get("invoice_number") || "").trim();
        if (!invoiceNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(invoiceNumber)) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        const submittedFiles = [];
        for (const fieldName of ["file", "files", "photo", "photos"]) {
          for (const item of form.getAll(fieldName)) {
            if (item && typeof item.arrayBuffer === "function" && Number(item.size) >= 0) {
              submittedFiles.push(item);
            }
          }
        }
        for (const [fieldName, item] of form.entries()) {
          if (/^(file|photo|image)[_-]?\d+$/i.test(fieldName) && item && typeof item.arrayBuffer === "function" && Number(item.size) >= 0) {
            submittedFiles.push(item);
          }
        }
        const files = submittedFiles.filter((item, index, all) => all.indexOf(item) === index);
        if (!files.length) {
          return json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u062E\u062A\u064A\u0627\u0631 \u0623\u064A \u0635\u0648\u0631\u0629" }, 400);
        }
        if (files.length > 10) {
          return json({ error: "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 10 \u0635\u0648\u0631 \u0641\u064A \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0648\u0627\u062D\u062F" }, 400);
        }
        const allowedTypes = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp"
        };
        const bucketName = "gate-photos 3";
        const uploadedUrls = [];
        const requestedIndex = String(form.get("photo_index") || form.get("image_index") || "").trim();
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const mimeType = String(file.type || "").toLowerCase();
          if (!allowedTypes[mimeType]) {
            return json({ error: "\u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629: JPG \u0648PNG \u0648WEBP" }, 400);
          }
          if (file.size > 8 * 1024 * 1024) {
            return json({ error: "\u062D\u062C\u0645 \u0643\u0644 \u0635\u0648\u0631\u0629 \u064A\u062C\u0628 \u0623\u0644\u0627 \u064A\u062A\u062C\u0627\u0648\u0632 8 \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A" }, 400);
          }
          let objectName;
          if (files.length > 1) {
            objectName = invoiceNumber + "-photo-" + (i + 1) + "." + allowedTypes[mimeType];
          } else if (requestedIndex && /^\d{1,3}$/.test(requestedIndex)) {
            objectName = invoiceNumber + "-photo-" + requestedIndex + "." + allowedTypes[mimeType];
          } else {
            objectName = invoiceNumber + "." + allowedTypes[mimeType];
          }
          const objectPath = "invoices/" + objectName;
          const storagePath = "/storage/v1/object/" + encodeURIComponent(bucketName) + "/" + objectPath.split("/").map(encodeURIComponent).join("/");
          const uploadResponse = await supabaseRequest(storagePath, {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": mimeType,
              "x-upsert": "true",
              "Cache-Control": "3600"
            },
            body: await file.arrayBuffer()
          });
          const uploadData = await uploadResponse.json().catch(function() {
            return null;
          });
          if (!uploadResponse.ok) {
            return json({
              error: uploadData && (uploadData.message || uploadData.error) || "\u0641\u0634\u0644 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u0631\u0642\u0645 " + (i + 1),
              uploaded_count: uploadedUrls.length,
              gate_photo_urls: uploadedUrls
            }, 502);
          }
          const publicUrl = SUPABASE_URL + "/storage/v1/object/public/" + encodeURIComponent(bucketName) + "/" + objectPath.split("/").map(encodeURIComponent).join("/");
          uploadedUrls.push(publicUrl);
        }
        return json({
          success: true,
          invoice_number: invoiceNumber,
          gate_photo_urls: uploadedUrls,
          gate_photo_url: uploadedUrls[0],
          uploaded_count: uploadedUrls.length
        });
      }
      if (path === "/api/customer-balances-sync" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        }
        if (!env.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0645\u0632\u0627\u0645\u0646\u0629 \u0623\u0631\u0635\u062F\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: SUPABASE_SERVICE_ROLE_KEY" }, 500);
        }
        const body = await request.json().catch(function() {
          return null;
        });
        const inputRows = Array.isArray(body) ? body : body && Array.isArray(body.balances) ? body.balances : [];
        if (!Array.isArray(inputRows)) {
          return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0623\u0631\u0635\u062F\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        }
        const balances = [];
        for (const row of inputRows) {
          if (!row || typeof row !== "object") continue;
          const customerCode = String(row.customer_code || "").trim();
          if (!customerCode) continue;
          const amountAdded = Number(row.amount_added || 0);
          const amountPaid = Number(row.amount_paid || 0);
          if (!Number.isFinite(amountAdded) || !Number.isFinite(amountPaid)) {
            return json({ error: "\u064A\u0648\u062C\u062F \u0645\u0628\u0644\u063A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D \u0644\u0644\u0639\u0645\u064A\u0644 " + customerCode }, 400);
          }
          balances.push({
            customer_code: customerCode,
            customer_name: String(row.customer_name || "").trim(),
            phone: String(row.phone || "").trim(),
            amount_added: amountAdded,
            amount_paid: amountPaid,
            notes: String(row.notes || "").trim(),
            area: String(row.area || "").trim(),
            emirate: String(row.emirate || "").trim(),
            order_ref: String(row.order_ref || "").trim(),
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        if (balances.length === 0) {
          return json({ success: true, synced: 0, message: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u0631\u0635\u062F\u0629 \u0644\u0647\u0627 \u0623\u0643\u0648\u0627\u062F \u0639\u0645\u0644\u0627\u0621" });
        }
        const balanceResponse = await supabaseRequest(
          "/rest/v1/customer_balances?on_conflict=customer_code",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=representation"
            },
            body: JSON.stringify(balances)
          }
        );
        const balanceData = await balanceResponse.json().catch(function() {
          return null;
        });
        if (!balanceResponse.ok) {
          return json({
            error: balanceData && (balanceData.message || balanceData.hint || balanceData.error) || "\u0641\u0634\u0644\u062A \u0645\u0632\u0627\u0645\u0646\u0629 \u0623\u0631\u0635\u062F\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621"
          }, 502);
        }
        return json({ success: true, synced: balances.length, data: balanceData });
      }
      if (path === "/api/excel-sync-revisions" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json({ success: false, error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        }
        const rawNumbers = String(url.searchParams.get("numbers") || "");
        const numbers = Array.from(new Set(rawNumbers.split(",").map(function(value) {
          return value.trim().toUpperCase();
        }).filter(function(value) {
          return /^[A-Z0-9_-]{1,80}$/.test(value);
        })));
        if (!numbers.length) return json({ success: true, rows: [] });
        if (numbers.length > 80) {
          return json({ success: false, error: "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 80 \u0631\u0642\u0645 \u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u0627\u0644\u0637\u0644\u0628" }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) {
          return json({ success: false, error: "\u0645\u0641\u062A\u0627\u062D \u062E\u062F\u0645\u0629 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A Worker" }, 500);
        }
        const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
        const inFilter = "(" + numbers.join(",") + ")";
        const tables = ["orders", "master_orders_archive"];
        const revisions = /* @__PURE__ */ new Map();
        for (const table of tables) {
          const response = await supabaseRequest(
            "/rest/v1/" + table + "?select=order_number,sync_revision&order_number=in." + encodeURIComponent(inFilter),
            { headers }
          );
          const rows = await response.json().catch(function() {
            return null;
          });
          if (!response.ok || !Array.isArray(rows)) {
            return json({
              success: false,
              error: rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0623\u0631\u0642\u0627\u0645 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0646 " + table
            }, 502);
          }
          rows.forEach(function(row) {
            const key = String(row && row.order_number || "").trim().toUpperCase();
            if (!key) return;
            const revision = Math.max(0, Number(row.sync_revision) || 0);
            revisions.set(key, Math.max(revisions.get(key) || 0, revision));
          });
        }
        return json({
          success: true,
          rows: Array.from(revisions.entries()).map(function(entry) {
            return { order_number: entry[0], sync_revision: entry[1] };
          })
        });
      }
      if (path === "/api/excel-sync" && request.method === "POST") {
        const secret = request.headers.get(
          "X-Excel-Sync-Secret"
        ) || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json(
            {
              error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D"
            },
            401
          );
        }
        const body = await request.json().catch(function() {
          return null;
        });
        if (!body) {
          return json(
            {
              error: "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"
            },
            400
          );
        }
        const orders = Array.isArray(body) ? body : Array.isArray(body.orders) ? body.orders : [];
        /* حماية قبل لمس قاعدة البيانات: لا نقبل حمولة فارغة أو فاتورة بلا هوية أو نسخًا مكررة لنفس المندوب. */
        if (!orders.length) return json({ success: false, error: "قائمة الفواتير فارغة؛ لم يتم تنفيذ أي تغيير" }, 400);
        const uploadKeys = new Set();
        for (let i = 0; i < orders.length; i++) {
          const order = orders[i];
          const number = String(order && (order.order_number || order.invoice_number) || "").trim().toUpperCase();
          const sheet = String(order && order.sheet_name || "").trim();
          if (!order || typeof order !== "object" || !number || !sheet) {
            return json({ success: false, error: "بيانات الفاتورة رقم " + (i + 1) + " ناقصة (رقم الفاتورة أو اسم المندوب)؛ أُوقف الرفع بالكامل" }, 400);
          }
          if (!Number.isFinite(Number(order.total)) || Number(order.total) < 0) {
            return json({ success: false, error: "إجمالي الفاتورة " + number + " غير صالح؛ أُوقف الرفع بالكامل" }, 400);
          }
          const key = number + "|" + sheet;
          if (uploadKeys.has(key)) return json({ success: false, error: "الفاتورة " + number + " مكررة لنفس المندوب داخل الرفع؛ أُوقف الرفع بالكامل" }, 409);
          uploadKeys.add(key);
        }
        const clearInvoices = Array.from(new Set(
          orders.filter(function(order) {
            return order && (order.clear_gate_photos === true || order.clear_gate_photos === 1 || String(order.clear_gate_photos).toLowerCase() === "true");
          }).map(function(order) {
            return String(order.order_number || "").trim();
          }).filter(function(number) {
            return /^[a-zA-Z0-9_-]{1,80}$/.test(number);
          })
        ));
        const deletedPhotoCounts = {};
        const rpcResponse = await supabaseRequest(
          "/rest/v1/rpc/sync_orders_from_excel",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + env.SUPABASE_ANON_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              p_orders: orders
            })
          }
        );
        const rpcData = await rpcResponse.json().catch(function() {
          return null;
        });
        if (!rpcResponse.ok) {
          return json(
            {
              success: false,
              error: rpcData && rpcData.message || rpcData && rpcData.hint || rpcData && rpcData.error || "\u0641\u0634\u0644 \u0645\u0632\u0627\u0645\u0646\u0629 Excel",
              received: orders.length,
              processed: 0
            },
            500
          );
        }
        if (rpcData === null) return json({ success: false, error: "قاعدة البيانات لم تُرجع نتيجة مؤكدة؛ لن يتم اعتماد الرفع محليًا", received: orders.length, processed: 0 }, 502);
        let skippedOldRevision = null;
        if (rpcData && typeof rpcData === "object") {
          const rpcResult = Array.isArray(rpcData) ? rpcData[0] || {} : rpcData;
          const rawSkipped = rpcResult.skipped_old_revision;
          if (rawSkipped !== void 0 && rawSkipped !== null && Number.isFinite(Number(rawSkipped))) {
            skippedOldRevision = Number(rawSkipped);
          }
        }
        if (skippedOldRevision !== null && skippedOldRevision > 0) {
          return json({ success: false, error: "قاعدة البيانات تجاهلت " + skippedOldRevision + " فاتورة بسبب تعارض المراجعة. لم يعتمد الكمبيوتر الرفع؛ أعد فحص الفواتير قبل المحاولة مرة أخرى", received: orders.length, processed: Math.max(0, orders.length - skippedOldRevision), skipped_old_revision: skippedOldRevision, possible_partial_commit: true }, 409);
        }
        let photosDeletionSkipped = false;
        if (clearInvoices.length && skippedOldRevision === 0) {
          try {
            for (const invoiceNumber of clearInvoices) {
              deletedPhotoCounts[invoiceNumber] = await clearGatePhotosForInvoice(invoiceNumber, env);
            }
          } catch (photoError) {
            photosDeletionSkipped = true;
          }
        } else if (clearInvoices.length) {
          photosDeletionSkipped = true;
        }
        return json({
          success: true,
          received: orders.length,
          processed: orders.length,
          data: rpcData,
          gate_photos_cleared: skippedOldRevision === 0 ? clearInvoices.length : 0,
          gate_photo_files_deleted: deletedPhotoCounts,
          gate_photo_file_deletion_skipped: photosDeletionSkipped,
          skipped_old_revision: skippedOldRevision
        });
      }
      if (path === "/api/excel-driver-status" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc };
        const r = await supabaseRequest(
          "/rest/v1/orders?select=order_number,sheet_name,payment_method,delivery_status,paid_in_advance,bank_transfer_received&order=order_number.asc",
          { headers: H }
        );
        const rows = await r.json().catch(function() {
          return null;
        });
        if (!r.ok || !Array.isArray(rows)) {
          return json({ error: rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u0633\u062D\u0628 \u062D\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u0646\u062F\u0648\u0628\u064A\u0646" }, 502);
        }
        return json({ orders: rows });
      }
      if (path === "/api/excel-driver-daily-ledger" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || secret !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        }
        const params = new URL(request.url).searchParams;
        const day = String(params.get("date") || "").trim();
        const month = String(params.get("month") || "").trim();
        let startIso = "";
        let endIso = "";
        if (day && month) return json({ error: "\u0623\u0631\u0633\u0644 date \u0623\u0648 month \u0648\u0644\u064A\u0633 \u0627\u0644\u0627\u062B\u0646\u064A\u0646 \u0645\u0639\u064B\u0627" }, 400);
        if (day) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
          const check = /* @__PURE__ */ new Date(day + "T00:00:00Z");
          if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== day) {
            return json({ error: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
          }
          const d = /* @__PURE__ */ new Date(day + "T00:00:00+04:00");
          const next = new Date(d.getTime() + 864e5);
          startIso = d.toISOString();
          endIso = next.toISOString();
        } else if (month) {
          if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "\u0627\u0644\u0634\u0647\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
          const check = /* @__PURE__ */ new Date(month + "-01T00:00:00Z");
          if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 7) !== month) {
            return json({ error: "\u0627\u0644\u0634\u0647\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" }, 400);
          }
          const d = /* @__PURE__ */ new Date(month + "-01T00:00:00+04:00");
          const next = new Date(Date.UTC(check.getUTCFullYear(), check.getUTCMonth() + 1, 1, -4, 0, 0));
          startIso = d.toISOString();
          endIso = next.toISOString();
        } else {
          return json({ error: "\u064A\u062C\u0628 \u0625\u0631\u0633\u0627\u0644 date \u0623\u0648 month" }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u062E\u062F\u0645\u0629 Supabase \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A Worker" }, 500);
        const H = { apikey: serviceKey };
        if (!serviceKey.startsWith("sb_secret_")) H.Authorization = "Bearer " + serviceKey;
        const reqPath = "/rest/v1/driver_delivery_requests?status=eq.approved&processed_at=gte." + encodeURIComponent(startIso) + "&processed_at=lt." + encodeURIComponent(endIso) + "&select=id,order_id,invoice_number,sheet_name,driver_user_id,driver_name,requested_at,processed_at&order=processed_at.asc&limit=5000";
        const reqRes = await supabaseRequest(reqPath, { headers: H });
        const approved = await reqRes.json().catch(function() {
          return null;
        });
        if (!reqRes.ok || !Array.isArray(approved)) {
          return json({
            error: approved && (approved.message || approved.hint || approved.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629",
            source: "driver_delivery_requests",
            status: reqRes.status
          }, 502);
        }
        const ids = Array.from(new Set(approved.map(function(q) {
          const n = Number(q.order_id);
          return Number.isInteger(n) && n > 0 ? n : null;
        }).filter(Boolean)));
        const byId = /* @__PURE__ */ new Map();
        if (ids.length) {
          const idList = ids.join(",");
          const [ordersRes, archiveRes] = await Promise.all([
            supabaseRequest("/rest/v1/orders?id=in.(" + idList + ")&select=id,order_number,customer_name,total,payment_method", { headers: H }),
            supabaseRequest("/rest/v1/master_orders_archive?id=in.(" + idList + ")&select=id,order_number,customer_name,total,payment_method", { headers: H })
          ]);
          const [orders, archive] = await Promise.all([
            ordersRes.json().catch(function() {
              return null;
            }),
            archiveRes.json().catch(function() {
              return null;
            })
          ]);
          if (!ordersRes.ok || !Array.isArray(orders)) {
            return json({ error: orders && (orders.message || orders.hint || orders.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u0629", source: "orders", status: ordersRes.status }, 502);
          }
          if (!archiveRes.ok || !Array.isArray(archive)) {
            return json({ error: archive && (archive.message || archive.hint || archive.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u0627\u0644\u0645\u0624\u0631\u0634\u0641\u0629", source: "master_orders_archive", status: archiveRes.status }, 502);
          }
          archive.forEach(function(o) {
            byId.set(String(o.id), o);
          });
          orders.forEach(function(o) {
            byId.set(String(o.id), o);
          });
        }
        const seen = /* @__PURE__ */ new Set();
        const rows = approved.filter(function(q) {
          const key = String(q.order_id || "");
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(function(q) {
          const o = byId.get(String(q.order_id)) || {};
          return {
            order_id: q.order_id,
            request_id: q.id,
            invoice_number: q.invoice_number || o.order_number || String(q.order_id || ""),
            customer_name: o.customer_name || "",
            sheet_name: q.sheet_name || "",
            delivered_by_user_id: q.driver_user_id || null,
            delivered_by_name: q.driver_name || "",
            payment_method: o.payment_method || "",
            amount: Number(o.total) || 0,
            requested_at: q.requested_at || null,
            delivered_at: q.processed_at || null,
            legacy_approved: true,
            invoice_details_found: !!Object.keys(o).length
          };
        });
        return json({
          success: true,
          date: day || null,
          month: month || null,
          rows,
          count: rows.length,
          source: "driver_delivery_requests.approved"
        });
      }
      if (path === "/api/excel-status" && request.method === "GET") {
        const secret = request.headers.get(
          "X-Excel-Sync-Secret"
        ) || "";
        if (secret !== env.EXCEL_SYNC_SECRET) {
          return json(
            {
              error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D"
            },
            401
          );
        }
        const rpcResponse = await supabaseRequest(
          "/rest/v1/rpc/get_order_delivery_statuses",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: "Bearer " + env.SUPABASE_ANON_KEY,
              "Content-Type": "application/json"
            }
          }
        );
        const data = await rpcResponse.json().catch(function() {
          return null;
        });
        if (!rpcResponse.ok) {
          return json(
            {
              error: data && data.message || data && data.hint || data && data.error || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062D\u0627\u0644\u0627\u062A \u0627\u0644\u062A\u0633\u0644\u064A\u0645"
            },
            500
          );
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u062E\u062F\u0645\u0629 Supabase \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A Worker: \u0623\u0636\u0641 SUPABASE_SERVICE_ROLE_KEY" }, 500);
        const serviceHeaders = { apikey: serviceKey };
        if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.Authorization = "Bearer " + serviceKey;
        const requestsResponse = await supabaseRequest(
          "/rest/v1/driver_delivery_requests?select=id,order_id,invoice_number,sheet_name,driver_name,requested_at,status&order=requested_at.asc",
          { headers: serviceHeaders }
        );
        const allDeliveryRequests = await requestsResponse.json().catch(function() {
          return null;
        });
        if (!requestsResponse.ok || !Array.isArray(allDeliveryRequests)) {
          return json({ error: allDeliveryRequests && (allDeliveryRequests.message || allDeliveryRequests.hint || allDeliveryRequests.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0637\u0644\u0628\u0627\u062A \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645" }, 502);
        }
        const deliveryRequests = allDeliveryRequests.filter(function(row) {
          const status = String(row.status || "pending").trim().toLowerCase();
          return status === "pending" || status === "requested" || status === "waiting" || status === "\u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631";
        });
        const statusOrders = Array.isArray(data) ? data : Array.isArray(data && data.orders) ? data.orders : [];
        return new Response(JSON.stringify({ orders: statusOrders, delivery_requests: deliveryRequests }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store, no-cache, must-revalidate" }
        });
      }
      if (path === "/api/excel-approve-delivery" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || secret !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const body = await request.json().catch(function() {
          return {};
        });
        const requestId = Number(body.request_id);
        if (!Number.isInteger(requestId) || requestId <= 0) return json({ error: "\u0631\u0642\u0645 \u0637\u0644\u0628 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u062E\u062F\u0645\u0629 Supabase \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A Worker" }, 500);
        const H = { apikey: serviceKey, "Content-Type": "application/json" };
        if (!serviceKey.startsWith("sb_secret_")) H.Authorization = "Bearer " + serviceKey;
        const approvalRes = await supabaseRequest(
          "/rest/v1/rpc/faruj_approve_driver_delivery_first_wins",
          {
            method: "POST",
            headers: Object.assign({}, H, { Prefer: "return=representation" }),
            body: JSON.stringify({ p_request_id: requestId })
          }
        );
        const approvalRaw = await approvalRes.text().catch(function() {
          return "";
        });
        let approvalData = null;
        try {
          approvalData = approvalRaw ? JSON.parse(approvalRaw) : null;
        } catch (_) {
        }
        if (!approvalRes.ok) {
          console.error("[delivery-approval-rpc-error]", JSON.stringify({
            request_id: requestId,
            http_status: approvalRes.status,
            response_body: String(approvalRaw || "").slice(0, 1600)
          }));
          const upstreamMessage = approvalData && (approvalData.message || approvalData.hint || approvalData.error || approvalData.details);
          return json({
            error: "\u0641\u0634\u0644 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u0641\u064A \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A (HTTP " + approvalRes.status + "): " + String(upstreamMessage || approvalRaw || "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0641\u0627\u0631\u063A\u0629").slice(0, 900),
            code: "delivery_approval_failed",
            upstream_status: approvalRes.status
          }, 502);
        }
        const result = Array.isArray(approvalData) ? approvalData[0] : approvalData;
        if (!result || typeof result !== "object") return json({ error: "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645 \u063A\u064A\u0631 \u0645\u0641\u0647\u0648\u0645\u0629" }, 502);
        if (result.success === true && result.approved === true) {
          return json({ success: true, approved: true, order_number: result.invoice_number || "", sheet_name: result.sheet_name || "", delivery_status: "delivered", winner: true });
        }
        if (result.conflict === true || result.approved === false) {
          return json({ success: false, approved: false, conflict: result.conflict === true, error: result.message || "\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0646\u0633\u062E\u0629 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u0645\u0646\u062F\u0648\u0628 \u0627\u0644\u0622\u062E\u0631 \u0628\u0627\u0644\u0641\u0639\u0644\u061B \u0644\u0645 \u064A\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0647\u0630\u0647 \u0627\u0644\u0646\u0633\u062E\u0629.", order_number: result.invoice_number || "", winner_sheet_name: result.winner_sheet_name || "" }, 409);
        }
        return json({ error: result.message || "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0637\u0644\u0628 \u0627\u0644\u062A\u0633\u0644\u064A\u0645", code: result.code || "not_approved" }, 409);
      }
      if (path === "/api/resolve-map" && request.method === "POST") {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) return json({ ok: false, error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const body = await request.json().catch(() => null);
        try {
          const p = await farujResolveGoogleMap(body && body.url);
          return json({ ok: true, url: String(body.url || ""), coords: [p.lat, p.lng], location_key: p.key });
        } catch (e) {
          return json({ ok: false, error: e.message }, 422);
        }
      }
      if (path === "/api/master/order/update-by-identity" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function() {
          return {};
        });
        const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
        const order = body.order && typeof body.order === "object" ? body.order : null;
        const orderNumber = String(identity.order_number || "").trim();
        const deliveryDate = String(order && order.delivery_date || "").slice(0, 10);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !order || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
          return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0623\u0648 \u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const H = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=representation" };
        const lookupPath = "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000";
        const archiveLookupPath = "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000";
        const [ordersResp, archiveResp] = await Promise.all([
          supabaseRequest(lookupPath, { headers: H }),
          supabaseRequest(archiveLookupPath, { headers: H })
        ]);
        const [ordersRows, archiveRows] = await Promise.all([
          ordersResp.json().catch(function() {
            return null;
          }),
          archiveResp.json().catch(function() {
            return null;
          })
        ]);
        if (!ordersResp.ok || !Array.isArray(ordersRows)) return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628", details: ordersRows }, 502);
        if (!archiveResp.ok || !Array.isArray(archiveRows)) return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631", details: archiveRows }, 502);
        const foundOrders = matchInvoiceRows(ordersRows, identity);
        const foundArchive = matchInvoiceRows(archiveRows, identity);
        if (foundOrders.ambiguous || foundArchive.ambiguous) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0644\u0647 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0646\u0633\u062E\u0629 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u062D\u062F\u064A\u062F\u0647\u0627 \u0628\u0623\u0645\u0627\u0646. \u0644\u0645 \u064A\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u0623\u064A \u0634\u064A\u0621.", ambiguous_orders: foundOrders.ambiguous, ambiguous_archive: foundArchive.ambiguous }, 409);
        }
        if (!foundOrders.rows.length && !foundArchive.rows.length) {
          return json({ error: "not_found \u2014 \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0628\u0646\u0641\u0633 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0645\u064A\u0644" }, 404);
        }
        const currentSheets = Array.from(new Set(
          foundOrders.rows.concat(foundArchive.rows).map(function(row) {
            return String(row.sheet_name || "").trim();
          }).filter(Boolean)
        ));
        const requestedSheet = String(order.sheet_name || "").trim();
        const hasMultipleDriverCopies = currentSheets.length > 1;
        const allowed = [
          "customer_name",
          "phone",
          "emirate",
          "area",
          "order_details",
          "chicken_weights",
          "chicken_qtys",
          "plate_names",
          "plate_qtys",
          "total",
          "payment_method",
          "delivery_status",
          "delivery_fee",
          "delivery_date",
          "location_url",
          "note",
          "appointment_coordinator",
          "gate_photo_url",
          "gate_photo_urls",
          "paid_in_advance",
          "bank_transfer_received"
        ];
        const archivePatch = {};
        allowed.forEach(function(key) {
          if (Object.prototype.hasOwnProperty.call(order, key)) archivePatch[key] = order[key];
        });
        archivePatch.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        const ordersPatch = Object.assign({}, archivePatch);
        delete ordersPatch.updated_at;
        if (currentSheets.length === 1 && requestedSheet && requestedSheet !== currentSheets[0]) {
          if (foundOrders.rows.length) ordersPatch.sheet_name = requestedSheet;
          if (foundArchive.rows.length) archivePatch.sheet_name = requestedSheet;
        }
        if (Object.prototype.hasOwnProperty.call(order, "sync_revision")) {
          ordersPatch.sync_revision = Math.max(0, Number(order.sync_revision) || 0);
        }
        const statusRaw = String(ordersPatch.delivery_status || "").toLowerCase();
        const delivered = statusRaw === "delivered" || statusRaw.includes("\u062A\u0645");
        const paymentRaw = String(ordersPatch.payment_method || "").trim();
        const driverPaymentChoice = paymentRaw === "cash" || paymentRaw === "bank_transfer" || paymentRaw === "\u0643\u0627\u0634" || paymentRaw === "\u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A";
        if (driverPaymentChoice && !delivered) ordersPatch.payment_method = "";
        if (ordersPatch.paid_in_advance === true || /مقدم/.test(paymentRaw)) {
          ordersPatch.paid_in_advance = true;
          archivePatch.paid_in_advance = true;
        }
        const ordersFilter = invoiceIdFilter(foundOrders.rows);
        const archiveFilter = invoiceIdFilter(foundArchive.rows);
        let updatedOrders = [];
        let updatedArchive = [];
        if (ordersFilter) {
          const response = await supabaseRequest("/rest/v1/orders?" + ordersFilter, { method: "PATCH", headers: H, body: JSON.stringify(ordersPatch) });
          updatedOrders = await response.json().catch(function() {
            return null;
          });
          if (!response.ok || !Array.isArray(updatedOrders) || updatedOrders.length !== foundOrders.rows.length) {
            return json({ error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0643\u0644 \u0646\u0633\u062E \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628\u061B \u0631\u0627\u062C\u0639 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0642\u0628\u0644 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.", updated_orders: Array.isArray(updatedOrders) ? updatedOrders.length : 0 }, 502);
          }
        }
        const targetIsDelivered = statusRaw === "delivered" || statusRaw.includes("\u062A\u0645");
        let archiveManagedByOrderTrigger = false;
        if (archiveFilter && !foundOrders.rows.length) {
          if (!targetIsDelivered) {
            return json({ error: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0648\u062C\u0648\u062F\u0629 \u0641\u064A \u0627\u0644\u0623\u0631\u0634\u064A\u0641 \u0641\u0642\u0637 \u0648\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u0633\u062E\u0629 \u0646\u0634\u0637\u0629 \u0639\u0646\u062F \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628 \u0644\u0625\u0639\u0627\u062F\u062A\u0647\u0627 \u0625\u0644\u0649 \u0642\u064A\u062F \u0627\u0644\u062A\u0648\u0635\u064A\u0644. \u0644\u0645 \u064A\u062A\u0645 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644.", updated_orders: 0, updated_archive: 0 }, 409);
          }
          const response = await supabaseRequest("/rest/v1/master_orders_archive?" + archiveFilter, { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
          updatedArchive = await response.json().catch(function() {
            return null;
          });
          if (!response.ok || !Array.isArray(updatedArchive) || updatedArchive.length !== foundArchive.rows.length) {
            return json({ error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0646\u0633\u062E\u0629 \u0627\u0644\u0623\u0631\u0634\u064A\u0641\u061B \u0631\u0627\u062C\u0639 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0641\u0648\u0631\u064B\u0627.", updated_orders: updatedOrders.length, updated_archive: Array.isArray(updatedArchive) ? updatedArchive.length : 0 }, 502);
          }
        } else if (foundOrders.rows.length) {
          archiveManagedByOrderTrigger = true;
        }
        const liveNotified = await broadcastOrdersChanged(env, "desktop_invoice_update");
        return json({
          success: true,
          order_number: orderNumber,
          updated_orders: updatedOrders.length,
          updated_archive: updatedArchive.length,
          archive_managed_by_orders_trigger: archiveManagedByOrderTrigger,
          updated_sheets: currentSheets,
          driver_assignment_preserved: hasMultipleDriverCopies,
          delivery_date: deliveryDate,
          live_notified: liveNotified,
          created_at_unchanged: true
        });
      }
      if (path === "/api/master/order/update-by-number" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderNumber = String(body.order_number || "").trim();
        const patch = body.order && typeof body.order === "object" ? body.order : null;
        if (!orderNumber || !patch) return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629" }, 400);
        delete patch.id;
        if (Object.prototype.hasOwnProperty.call(patch, "delivery_date") && patch.delivery_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.delivery_date))) {
          return json({ error: "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=minimal" };
        const driverPatch = Object.assign({}, patch);
        const archivePatch = Object.assign({}, patch);
        archivePatch.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        const stRaw = String(patch.delivery_status || "").toLowerCase();
        const isDelivered = stRaw === "delivered" || stRaw.includes("\u062A\u0645");
        const pmRaw = String(patch.payment_method || "").trim();
        const isDriverChoice = pmRaw === "cash" || pmRaw === "bank_transfer" || pmRaw === "\u0643\u0627\u0634" || pmRaw === "\u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A";
        const isAdvance = patch.paid_in_advance === true || /مقدم/.test(pmRaw);
        if (isDriverChoice && !isDelivered) driverPatch.payment_method = "";
        if (isAdvance) {
          driverPatch.paid_in_advance = true;
          archivePatch.paid_in_advance = true;
        }
        const r1 = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(driverPatch) });
        if (!r1.ok) {
          const e1 = await r1.json().catch(function() {
            return null;
          });
          return json({ error: e1 && (e1.message || e1.hint || e1.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0646\u0633\u062E \u0627\u0644\u0637\u0644\u0628\u0627\u062A" }, 502);
        }
        const r2 = await supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
        if (!r2.ok) {
          const e2 = await r2.json().catch(function() {
            return null;
          });
          return json({ error: e2 && (e2.message || e2.hint || e2.error) || "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0648\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0623\u0631\u0634\u064A\u0641" }, 502);
        }
        return json({ success: true, updated: orderNumber });
      }
      if (path === "/api/excel-correct" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderNumber = String(body.order_number || "").trim();
        const set = body.set && typeof body.set === "object" ? body.set : null;
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !set) return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=minimal" };
        const driverPatch = Object.assign({}, set);
        const archivePatch = Object.assign({}, set);
        archivePatch.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        const stRaw = String(set.delivery_status || "").toLowerCase();
        const isDelivered = stRaw === "delivered" || stRaw.includes("\u062A\u0645");
        const pmRaw = String(set.payment_method || "").trim();
        const isDriverChoice = pmRaw === "cash" || pmRaw === "bank_transfer" || pmRaw === "\u0643\u0627\u0634" || pmRaw === "\u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A";
        if (isDriverChoice && !isDelivered) driverPatch.payment_method = "";
        if (set.paid_in_advance === true || /مقدم/.test(pmRaw)) {
          driverPatch.paid_in_advance = true;
          archivePatch.paid_in_advance = true;
        }
        const r1 = await supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(driverPatch) });
        if (!r1.ok) {
          const e1 = await r1.json().catch(function() {
            return null;
          });
          return json({ error: e1 && (e1.message || e1.hint || e1.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0646\u0633\u062E \u0627\u0644\u0637\u0644\u0628\u0627\u062A" }, 502);
        }
        const r2 = await supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber), { method: "PATCH", headers: H, body: JSON.stringify(archivePatch) });
        if (!r2.ok) {
          const e2 = await r2.json().catch(function() {
            return null;
          });
          return json({ error: e2 && (e2.message || e2.hint || e2.error) || "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0648\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0623\u0631\u0634\u064A\u0641" }, 502);
        }
        return json({ success: true, updated: orderNumber });
      }
      if (path === "/api/master/delete-by-date" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        return json({
          success: false,
          deleted: false,
          error: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u062D\u0630\u0641 \u062D\u0633\u0628 \u0627\u0644\u062A\u0627\u0631\u064A\u062E \u062D\u0641\u0627\u0638\u064B\u0627 \u0639\u0644\u0649 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u0648\u0627\u0644\u0623\u0631\u0634\u064A\u0641. \u063A\u064A\u0651\u0631 delivery_date \u0628\u062F\u0644 \u0627\u0644\u062D\u0630\u0641."
        }, 410);
      }
      if (path === "/api/master/dedupe" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0627\u0644\u062A\u0646\u0636\u064A\u0641 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: SUPABASE_SERVICE_ROLE_KEY" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc };
        async function dedupeTable(table, withSheet) {
          const cols = withSheet ? "id,order_number,sheet_name" : "id,order_number";
          const res = await supabaseRequest("/rest/v1/" + table + "?select=" + cols + "&order=id.asc", { headers: H });
          const rows = await res.json().catch(function() {
            return [];
          });
          if (!res.ok || !Array.isArray(rows)) return { error: "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 " + table };
          const keep = /* @__PURE__ */ new Map();
          for (const r of rows) {
            const key = (withSheet ? String(r.sheet_name) + "|" : "") + String(r.order_number);
            keep.set(key, r.id);
          }
          const del = rows.filter((r) => keep.get((withSheet ? String(r.sheet_name) + "|" : "") + String(r.order_number)) !== r.id).map((r) => r.id);
          if (!del.length) return { removed: 0 };
          const dres = await supabaseRequest("/rest/v1/" + table + "?id=in.(" + del.join(",") + ")", { method: "DELETE", headers: H });
          return { removed: del.length, ok: dres.ok };
        }
        __name(dedupeTable, "dedupeTable");
        const o = await dedupeTable("orders", true);
        const a = await dedupeTable("master_orders_archive", false);
        return json({ success: true, orders: o, archive: a });
      }
      if (path === "/api/master/order/release-future" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function () { return null; });
        const orderNumber = String(body && body.order_number || "").trim();
        const deliveryDate = String(body && body.delivery_date || "").slice(0, 10);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
          return json({ success: false, error: "رقم الفاتورة أو تاريخ التوصيل غير صحيح؛ لم يتم تغيير أي بيانات" }, 400);
        }
        const parsedDate = new Date(deliveryDate + "T00:00:00Z");
        if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== deliveryDate) {
          return json({ success: false, error: "تاريخ التوصيل غير صالح؛ لم يتم تغيير أي بيانات" }, 400);
        }
        const dubaiToday = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
        if (deliveryDate <= dubaiToday) {
          return json({ success: false, error: "إذن الرفع مخصص لفواتير الأيام القادمة فقط؛ لم يتم تغيير أي بيانات", delivery_date: deliveryDate, dubai_today: dubaiToday }, 409);
        }
        // Explicit master release acknowledgement only: no invoice row is inserted, updated, or deleted here.
        return json({
          success: true,
          released: true,
          order_number: orderNumber,
          delivery_date: deliveryDate,
          release_revision: Date.now(),
          database_changed: false
        });
      }
      if (path === "/api/master/order/recall-future" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function() {
          return {};
        });
        const orderNumber = String(body.order_number || "").trim();
        const sheetName = String(body.sheet_name || "").trim();
        const requestedDate = String(body.delivery_date || "").slice(0, 10);
        const allSheets = sheetName.toUpperCase() === "ALL";
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber) || !sheetName || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
          return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0623\u0648 \u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        }
        const dubaiToday = new Date(Date.now() + 4 * 3600 * 1e3).toISOString().slice(0, 10);
        if (requestedDate <= dubaiToday) return json({ error: "\u0627\u0644\u0633\u062D\u0628 \u0645\u0633\u0645\u0648\u062D \u0644\u0644\u0641\u0648\u0627\u062A\u064A\u0631 \u0627\u0644\u0645\u0633\u062A\u0642\u0628\u0644\u064A\u0629 \u0641\u0642\u0637", requested_date: requestedDate, dubai_today: dubaiToday }, 409);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D SUPABASE_SERVICE_ROLE_KEY \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=representation" };
        let query = "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,created_at";
        if (!allSheets) query += "&sheet_name=eq." + encodeURIComponent(sheetName);
        const findResp = await supabaseRequest(query, { headers: H });
        const found = await findResp.json().catch(function() {
          return null;
        });
        if (!findResp.ok || !Array.isArray(found)) return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u062C\u062F\u0648\u0644 orders", details: found }, 502);
        const futureRows = found.filter(function(row) {
          const savedDate = String(row.delivery_date || "").slice(0, 10);
          return savedDate === requestedDate && savedDate > dubaiToday && (allSheets || String(row.sheet_name || "") === sheetName);
        });
        if (!futureRows.length) {
          return json({ error: "\u0644\u0645 \u0623\u062C\u062F \u0646\u0633\u062E\u0629 \u0645\u0633\u062A\u0642\u0628\u0644\u064A\u0629 \u0645\u0637\u0627\u0628\u0642\u0629 \u0641\u064A \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628\u061B \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0623\u064A \u0634\u064A\u0621.", requested: { order_number: orderNumber, sheet_name: sheetName, delivery_date: requestedDate }, database_rows: found }, 404);
        }
        const ids = futureRows.map(function(row) {
          return Number(row.id);
        }).filter(function(id) {
          return Number.isInteger(id) && id > 0;
        });
        if (!ids.length) return json({ error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062F \u0645\u0639\u0631\u0641\u0627\u062A \u0627\u0644\u0646\u0633\u062E\u061B \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0623\u064A \u0634\u064A\u0621." }, 409);
        const departureResp = await supabaseRequest("/rest/v1/driver_departures?order_id=in.(" + ids.join(",") + ")", { method: "DELETE", headers: H });
        if (!departureResp.ok && departureResp.status !== 404) {
          const err = await departureResp.json().catch(function() {
            return {};
          });
          return json({ error: "\u062A\u0639\u0630\u0631 \u0625\u0632\u0627\u0644\u0629 \u0633\u062C\u0644 \u062A\u062D\u0631\u0643 \u0627\u0644\u0645\u0646\u062F\u0648\u0628\u061B \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0633\u062D\u0628.", details: err }, 502);
        }
        const delResp = await supabaseRequest("/rest/v1/orders?id=in.(" + ids.join(",") + ")", { method: "DELETE", headers: H });
        const removedRows = await delResp.json().catch(function() {
          return null;
        });
        if (!delResp.ok || !Array.isArray(removedRows) || removedRows.length !== ids.length) {
          return json({ error: "\u062A\u0639\u0630\u0631 \u0633\u062D\u0628 \u0643\u0644 \u0646\u0633\u062E \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628\u061B \u0644\u0645 \u064A\u062A\u0645 \u0627\u0639\u062A\u0628\u0627\u0631 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0646\u0627\u062C\u062D\u0629.", removed: Array.isArray(removedRows) ? removedRows.length : 0, expected: ids.length }, 502);
        }
        return json({ success: true, removed: removedRows.length, archive_preserved: true, order_number: orderNumber, sheet_names: Array.from(new Set(futureRows.map(function(row) {
          return row.sheet_name;
        }))), delivery_date: requestedDate });
      }
      if (path === "/api/master/order/delete-by-identity" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const body = await request.json().catch(function() {
          return {};
        });
        const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
        const orderNumber = String(identity.order_number || "").trim();
        const identityDate = String(identity.delivery_date || "").slice(0, 10);
        const identityPhone = invoiceDigits(identity.phone);
        const identityCustomer = invoiceNorm(identity.customer_name);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(identityDate) || !identityPhone && identityCustomer.length < 3) {
          return json({ error: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0628\u0623\u0645\u0627\u0646 \u062F\u0648\u0646 \u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0648\u0635\u064A\u0644 \u0648\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641 \u0623\u0648 \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064A\u0644." }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const H = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=representation" };
        const [ordersResp, archiveResp] = await Promise.all([
          supabaseRequest("/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000", { headers: H }),
          supabaseRequest("/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number,sheet_name,delivery_date,phone,customer_name&limit=1000", { headers: H })
        ]);
        const [ordersRows, archiveRows] = await Promise.all([
          ordersResp.json().catch(function() {
            return null;
          }),
          archiveResp.json().catch(function() {
            return null;
          })
        ]);
        if (!ordersResp.ok || !Array.isArray(ordersRows)) return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628", details: ordersRows }, 502);
        if (!archiveResp.ok || !Array.isArray(archiveRows)) return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u0627\u0644\u0645\u0627\u0633\u062A\u0631", details: archiveRows }, 502);
        const foundOrders = matchInvoiceRows(ordersRows, identity);
        const foundArchive = matchInvoiceRows(archiveRows, identity);
        if (foundOrders.ambiguous) return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0644\u0647 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0646\u0633\u062E\u0629 \u0639\u0646\u062F \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u062D\u062F\u064A\u062F\u0647\u0627 \u0628\u0623\u0645\u0627\u0646. \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0623\u064A \u0634\u064A\u0621.", ambiguous_orders: true }, 409);
        if (foundArchive.ambiguous) {
          const exactArchiveCounterparts2 = archiveRows.filter(function(archived) {
            return foundOrders.rows.some(function(active) {
              return String(active.id) === String(archived.id) && String(active.order_number || "").trim() === String(archived.order_number || "").trim() && String(active.sheet_name || "").trim() === String(archived.sheet_name || "").trim();
            });
          });
          if (exactArchiveCounterparts2.length) {
            foundArchive.rows = exactArchiveCounterparts2;
            foundArchive.ambiguous = false;
          } else {
            return json({ error: "\u0646\u0633\u062E \u0627\u0644\u0623\u0631\u0634\u064A\u0641 \u0644\u0646\u0641\u0633 \u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629 \u0628\u0623\u0645\u0627\u0646. \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0623\u064A \u0634\u064A\u0621.", ambiguous_archive: true }, 409);
          }
        }
        const exactArchiveCounterparts = archiveRows.filter(function(archived) {
          return foundOrders.rows.some(function(active) {
            return String(active.id) === String(archived.id) && String(active.order_number || "").trim() === String(archived.order_number || "").trim() && String(active.sheet_name || "").trim() === String(archived.sheet_name || "").trim();
          });
        });
        foundArchive.rows = foundArchive.rows.concat(exactArchiveCounterparts).filter(function(row, index, rows) {
          return rows.findIndex(function(item) {
            return String(item.id) === String(row.id);
          }) === index;
        });
        if (!foundOrders.rows.length && !foundArchive.rows.length) return json({ error: "not_found \u2014 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0628\u0646\u0641\u0633 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0645\u064A\u0644" }, 404);
        const orderIds = foundOrders.rows.map(function(row) {
          return Number(row.id);
        }).filter(function(id) {
          return Number.isInteger(id) && id > 0;
        });
        const archiveIds = foundArchive.rows.map(function(row) {
          return Number(row.id);
        }).filter(function(id) {
          return Number.isInteger(id) && id > 0;
        });
        if (orderIds.length) {
          const depRes = await supabaseRequest("/rest/v1/driver_departures?order_id=in.(" + orderIds.join(",") + ")", { method: "DELETE", headers: H });
          if (!depRes.ok && depRes.status !== 404) {
            const detail = await depRes.json().catch(function() {
              return {};
            });
            return json({ error: "\u062A\u0639\u0630\u0631 \u062A\u0646\u0638\u064A\u0641 \u0633\u062C\u0644 \u062D\u0631\u0643\u0629 \u0627\u0644\u0645\u0646\u062F\u0648\u0628\u061B \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.", details: detail }, 502);
          }
          const approvalRes = await supabaseRequest("/rest/v1/driver_delivery_requests?order_id=in.(" + orderIds.join(",") + ")", { method: "DELETE", headers: H });
          if (!approvalRes.ok && approvalRes.status !== 404) {
            const detail = await approvalRes.json().catch(function() {
              return {};
            });
            return json({ error: "\u062A\u0639\u0630\u0631 \u062A\u0646\u0638\u064A\u0641 \u0637\u0644\u0628\u0627\u062A \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u062A\u0633\u0644\u064A\u0645\u061B \u0644\u0645 \u064A\u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.", details: detail }, 502);
          }
        }
        let deletedArchive = [];
        let deletedOrders = [];
        if (archiveIds.length) {
          const ar = await supabaseRequest("/rest/v1/master_orders_archive?id=in.(" + archiveIds.join(",") + ")", { method: "DELETE", headers: H });
          deletedArchive = await ar.json().catch(function() {
            return null;
          });
          if (!ar.ok || !Array.isArray(deletedArchive) || deletedArchive.length !== archiveIds.length) {
            return json({ error: "\u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u0645\u0627\u0633\u062A\u0631 \u0628\u0627\u0644\u0643\u0627\u0645\u0644\u061B \u0631\u0627\u062C\u0639 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0642\u0628\u0644 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.", deleted_archive: Array.isArray(deletedArchive) ? deletedArchive.length : 0, expected_archive: archiveIds.length }, 502);
          }
        }
        if (orderIds.length) {
          const od = await supabaseRequest("/rest/v1/orders?id=in.(" + orderIds.join(",") + ")", { method: "DELETE", headers: H });
          deletedOrders = await od.json().catch(function() {
            return null;
          });
          if (!od.ok || !Array.isArray(deletedOrders) || deletedOrders.length !== orderIds.length) {
            return json({ error: "\u062A\u0645 \u062D\u0630\u0641 \u0646\u0633\u062E\u0629 \u0627\u0644\u0645\u0627\u0633\u062A\u0631 \u0644\u0643\u0646 \u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0643\u0644 \u0646\u0633\u062E \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628. \u0644\u0627 \u062A\u0639\u062A\u0628\u0631 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0645\u0643\u062A\u0645\u0644\u0629 \u062D\u062A\u0649 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.", deleted_archive: deletedArchive.length, deleted_orders: Array.isArray(deletedOrders) ? deletedOrders.length : 0, expected_orders: orderIds.length }, 502);
          }
        }
        return json({ success: true, deleted: orderNumber, deleted_orders: deletedOrders.length, deleted_archive: deletedArchive.length, driver_departures_removed: orderIds.length });
      }
      if (path === "/api/master/order/delete-by-number" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) {
          return json({ error: auth.error }, auth.status);
        }
        const body = await request.json().catch(function() {
          return {};
        });
        const orderNumber = String(body.order_number || "").trim();
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!serviceKey) {
          return json({ error: "\u0625\u0639\u062F\u0627\u062F \u0627\u0644\u062D\u0630\u0641 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644: \u0623\u0636\u0641 SUPABASE_SERVICE_ROLE_KEY \u0625\u0644\u0649 \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        }
        const svcHeaders = {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey
        };
        const findResp = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber) + "&select=id,order_number",
          { headers: svcHeaders }
        );
        const found = await findResp.json().catch(function() {
          return null;
        });
        if (!findResp.ok || !Array.isArray(found)) {
          return json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629" }, 502);
        }
        if (!found.length) {
          return json({ error: "not_found" }, 404);
        }
        const orderIds = found.map(function(row) {
          return row.id;
        }).filter(function(id) {
          return Number.isInteger(id) && id > 0;
        });
        if (orderIds.length) {
          await supabaseRequest(
            "/rest/v1/driver_departures?order_id=in.(" + orderIds.join(",") + ")",
            { method: "DELETE", headers: svcHeaders }
          );
        }
        const delResp = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encodeURIComponent(orderNumber),
          {
            method: "DELETE",
            headers: Object.assign({}, svcHeaders, { Prefer: "return=representation" })
          }
        );
        if (!delResp.ok) {
          const delErr = await delResp.json().catch(function() {
            return null;
          });
          return json({
            error: delErr && (delErr.message || delErr.hint || delErr.error) || "\u062A\u0639\u0630\u0631 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u0637\u0644\u0628\u0627\u062A"
          }, 502);
        }
        await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encodeURIComponent(orderNumber),
          { method: "DELETE", headers: svcHeaders }
        );
        return json({
          success: true,
          deleted: orderNumber,
          orders_deleted: found.length
        });
      }
      if (path === "/api/excel-master-state" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Secret") || request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const r = await supabaseRequest(
          "/rest/v1/master_orders_archive?select=order_number,customer_name,phone,emirate,area,total,note,payment_method,delivery_status,paid_in_advance,bank_transfer_received,updated_at&order=updated_at.desc&limit=2000",
          { headers: { apikey: svc, Authorization: "Bearer " + svc } }
        );
        const rows = await r.json().catch(function() {
          return null;
        });
        if (!r.ok || !Array.isArray(rows)) {
          return json({ error: rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u0645\u0627\u0633\u062A\u0631" }, 502);
        }
        return json({ orders: rows, server_now: (/* @__PURE__ */ new Date()).toISOString() });
      }
      if (path === "/api/excel-transfer-received" && request.method === "POST") {
        const supplied = request.headers.get("X-Excel-Sync-Secret") || request.headers.get("X-Excel-Secret") || "";
        if (!env.EXCEL_SYNC_SECRET || supplied !== env.EXCEL_SYNC_SECRET) {
          return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D: \u0645\u0641\u062A\u0627\u062D \u0645\u0632\u0627\u0645\u0646\u0629 Excel \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642" }, 401);
        }
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0641\u064A \u0623\u0633\u0631\u0627\u0631 Worker" }, 500);
        const body = await request.json().catch(function() {
          return null;
        });
        const orderNumber = String(body && body.order_number || "").trim();
        const received = !(body && body.received === false);
        if (!orderNumber || !/^[a-zA-Z0-9_-]{1,80}$/.test(orderNumber)) {
          return json({ error: "\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D" }, 400);
        }
        const H = {
          apikey: svc,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        };
        if (!svc.startsWith("sb_secret_")) H.Authorization = "Bearer " + svc;
        const patch = { bank_transfer_received: received };
        const encoded = encodeURIComponent(orderNumber);
        const r1 = await supabaseRequest(
          "/rest/v1/orders?order_number=eq." + encoded,
          { method: "PATCH", headers: H, body: JSON.stringify(patch) }
        );
        const d1 = await r1.json().catch(function() {
          return null;
        });
        if (!r1.ok) {
          return json({
            error: d1 && (d1.message || d1.hint || d1.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0646\u0633\u062E \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628",
            failed_table: "orders",
            supabase_status: r1.status,
            detail: d1
          }, 502);
        }
        const r2 = await supabaseRequest(
          "/rest/v1/master_orders_archive?order_number=eq." + encoded,
          { method: "PATCH", headers: H, body: JSON.stringify(patch) }
        );
        const d2 = await r2.json().catch(function() {
          return null;
        });
        if (!r2.ok) {
          return json({
            error: d2 && (d2.message || d2.hint || d2.error) || "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0646\u0627\u062F\u064A\u0628 \u0648\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631",
            failed_table: "master_orders_archive",
            supabase_status: r2.status,
            detail: d2
          }, 502);
        }
        const driversUpdated = Array.isArray(d1) ? d1.length : 0;
        const archiveUpdated = Array.isArray(d2) ? d2.length : 0;
        if (driversUpdated === 0 && archiveUpdated === 0) {
          return json({ error: "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u064A \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0623\u0648 \u0623\u0631\u0634\u064A\u0641 \u0627\u0644\u0645\u0627\u0633\u062A\u0631", order_number: orderNumber }, 404);
        }
        await broadcastOrdersChanged(env, "excel-transfer-received");
        return json({
          success: true,
          order_number: orderNumber,
          bank_transfer_received: received,
          drivers_updated: driversUpdated,
          archive_updated: archiveUpdated
        });
      }
      if (path === "/api/collect-sync" && request.method === "POST") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637" }, 500);
        const body = await request.json().catch(function() {
          return null;
        });
        const rows = Array.isArray(body) ? body : body && Array.isArray(body.collects) ? body.collects : null;
        if (!Array.isArray(rows)) return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const clean = rows.filter(function(r) {
          return r && r.id;
        }).map(function(r) {
          return {
            id: String(r.id),
            code: String(r.code || ""),
            name: String(r.name || ""),
            phone: String(r.phone || ""),
            emirate: String(r.emirate || ""),
            date: String(r.date || ""),
            amt: Number(r.amt) || 0,
            method: String(r.method || ""),
            note: String(r.note || ""),
            status: String(r.status || "pend"),
            done_at: String(r.done_at || ""),
            src_inv: String(r.src_inv || ""),
            created_at: String(r.created_at || now),
            updated_at: now
          };
        });
        if (clean.length) {
          const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
          const up = await supabaseRequest("/rest/v1/scheduled_collections?on_conflict=id", { method: "POST", headers: H, body: JSON.stringify(clean) });
          if (!up.ok) {
            const eu = await up.json().catch(function() {
              return null;
            });
            return json({ error: eu && (eu.message || eu.hint || eu.error) || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u062A\u062D\u0635\u064A\u0644 \u0627\u0644\u0645\u062C\u062F\u0648\u0644" }, 502);
          }
        }
        return json({ success: true, synced: clean.length });
      }
      if (path === "/api/excel-collect" && request.method === "GET") {
        const secret = request.headers.get("X-Excel-Sync-Secret") || "";
        if (secret !== env.EXCEL_SYNC_SECRET) return json({ error: "\u063A\u064A\u0631 \u0645\u0635\u0631\u062D" }, 401);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637" }, 500);
        const r = await supabaseRequest("/rest/v1/scheduled_collections?select=*&order=date.asc", { headers: { apikey: svc, Authorization: "Bearer " + svc } });
        const rows = await r.json().catch(function() {
          return null;
        });
        if (!r.ok || !Array.isArray(rows)) return json({ error: rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062A\u062D\u0635\u064A\u0644 \u0627\u0644\u0645\u062C\u062F\u0648\u0644" }, 502);
        return json({ collects: rows });
      }
      if (path === "/api/master/collect" && request.method === "GET") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637" }, 500);
        const r = await supabaseRequest("/rest/v1/scheduled_collections?select=*&order=date.asc", { headers: { apikey: svc, Authorization: "Bearer " + svc } });
        const rows = await r.json().catch(function() {
          return null;
        });
        if (!r.ok || !Array.isArray(rows)) return json({ error: rows && (rows.message || rows.hint || rows.error) || "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062A\u062D\u0635\u064A\u0644 \u0627\u0644\u0645\u062C\u062F\u0648\u0644" }, 502);
        return json({ collects: rows });
      }
      if (path === "/api/master/collect-update" && request.method === "POST") {
        const auth = await requireMaster(request, env);
        if (auth.error) return json({ error: auth.error }, auth.status);
        const svc = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        if (!svc) return json({ error: "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637" }, 500);
        const body = await request.json().catch(function() {
          return {};
        });
        const id = String(body.id || "").trim();
        const patch = body.patch && typeof body.patch === "object" ? body.patch : null;
        if (!id || !patch) return json({ error: "\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }, 400);
        if (patch.status === "done" && !patch.done_at) patch.done_at = (/* @__PURE__ */ new Date()).toISOString();
        patch.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        const row = Object.assign({}, patch, { id });
        const r = await supabaseRequest("/rest/v1/scheduled_collections?on_conflict=id", {
          method: "POST",
          headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(row)
        });
        if (!r.ok) {
          const e = await r.json().catch(function() {
            return null;
          });
          return json({ error: e && (e.message || e.hint || e.error) || "\u062A\u0639\u0630\u0631 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0648\u0639\u062F" }, 502);
        }
        return json({ success: true, id });
      }
      if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse && assetResponse.status === 200) {
          const contentType = String(assetResponse.headers.get("Content-Type") || "").toLowerCase();
          if (contentType.indexOf("text/html") >= 0 || contentType.indexOf("javascript") >= 0 || contentType.indexOf("css") >= 0) {
            const headers = new Headers(assetResponse.headers);
            headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
            headers.set("Pragma", "no-cache");
            headers.delete("ETag");
            return new Response(assetResponse.body, {
              status: assetResponse.status,
              statusText: assetResponse.statusText,
              headers
            });
          }
        }
        return assetResponse;
      }
      return new Response(
        "Not Found",
        {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8"
          }
        }
      );
    } catch (error) {
      return json(
        {
          error: "\u062D\u062F\u062B \u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639"
        },
        500
      );
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
