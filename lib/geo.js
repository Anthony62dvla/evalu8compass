/*
 * UK postcode lookup, for the consultant register's distance search
 * ------------------------------------------------------------
 * Uses postcodes.io (free, open data from the ONS). Only the postcode itself is
 * sent. Consultants' locations are stored as the postcode district (e.g. "LS6")
 * and its centre point, never a full address.
 *   POSTCODES_API  base URL (default https://api.postcodes.io), changed for tests
 */
const cache = new Map();
const base = () => (process.env.POSTCODES_API || "https://api.postcodes.io").replace(/\/$/, "");
const DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?$/;

class GeoError extends Error { constructor(status, message) { super(message); this.status = status; } }

/** Tidy what someone typed: "ls6 3qs" → { full: "LS6 3QS", district: "LS6" }, "ls6" → { district: "LS6" }. */
function parse(input) {
  const s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (m) return { full: `${m[1]} ${m[2]}`, district: m[1] };
  if (DISTRICT.test(s)) return { district: s };
  return null;
}

async function get(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new GeoError(503, "The postcode lookup isn't available right now. Try again shortly, or search by region.");
    return (await r.json()).result || null;
  } catch (e) {
    if (e instanceof GeoError) throw e;
    throw new GeoError(503, "The postcode lookup isn't available right now. Try again shortly, or search by region.");
  } finally { clearTimeout(timer); }
}

/** → { district, lat, lon, area } or throws GeoError (400 if the postcode isn't real). */
async function lookup(input) {
  const pc = parse(input);
  if (!pc) throw new GeoError(400, "Enter a UK postcode, for example LS6 3QS, or just the first part, LS6.");
  const key = pc.full || pc.district;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  if (pc.full) {
    const r = await get(`${base()}/postcodes/${encodeURIComponent(pc.full)}`);
    if (r && typeof r.latitude === "number") out = { district: r.outcode || pc.district, lat: r.latitude, lon: r.longitude, area: r.admin_district || r.region || "" };
  }
  if (!out) {
    const r = await get(`${base()}/outcodes/${encodeURIComponent(pc.district)}`);
    if (r && typeof r.latitude === "number") out = { district: r.outcode || pc.district, lat: r.latitude, lon: r.longitude, area: (r.admin_district || [])[0] || "" };
  }
  if (!out) throw new GeoError(400, "We couldn't find that postcode. Check it and try again.");
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

/** For consultants: only ever the district's centre point, never a full postcode's location. */
async function lookupDistrict(input) {
  const pc = parse(input);
  if (!pc) throw new GeoError(400, "Enter a UK postcode, for example LS6 3QS, or just the first part, LS6.");
  return lookup(pc.district);
}
/** Straight-line distance in miles. */
function miles(a, b) {
  const R = 3958.8, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { lookup, lookupDistrict, parse, miles, GeoError };
