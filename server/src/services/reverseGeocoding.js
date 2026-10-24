const cache = new Map();
const pendingLookups = new Map();
let lookupQueue = Promise.resolve();
let lastLookupAt = 0;

function cachePlace(key, result) {
  cache.set(key, result);
  if (cache.size > 500) {
    cache.delete(cache.keys().next().value);
  }
}

function queueNominatimLookup(cacheKey, url, transform) {
  if (cache.has(cacheKey)) {
    return Promise.resolve(cache.get(cacheKey));
  }
  if (pendingLookups.has(cacheKey)) {
    return pendingLookups.get(cacheKey);
  }

  const lookup = lookupQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastLookupAt));
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    lastLookupAt = Date.now();

    const response = await fetch(url, {
      headers: {
        "User-Agent": "EmergencyCare/1.0 (emergency response coordination application)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`OpenStreetMap returned HTTP ${response.status}.`);
    }

    const result = transform(await response.json());
    cachePlace(cacheKey, result);
    return result;
  });

  lookupQueue = lookup.then(() => undefined, () => undefined);
  pendingLookups.set(cacheKey, lookup);
  lookup.then(
    () => pendingLookups.delete(cacheKey),
    () => pendingLookups.delete(cacheKey),
  );
  return lookup;
}

export function reverseGeocode(latitude, longitude) {
  const cacheKey = `reverse:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
    addressdetails: "0",
    "accept-language": "en",
  }).toString();
  return queueNominatimLookup(cacheKey, url, (result) =>
    typeof result.display_name === "string" && result.display_name.trim()
      ? result.display_name
      : null,
  );
}

export function geocodeAddress(address) {
  const normalizedAddress = address.trim().toLocaleLowerCase("en");
  const cacheKey = `search:${normalizedAddress}`;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: address.trim(),
    format: "jsonv2",
    limit: "1",
    countrycodes: "bd",
    "accept-language": "en",
  }).toString();
  return queueNominatimLookup(cacheKey, url, (results) => {
    const match = Array.isArray(results) ? results[0] : null;
    const latitude = Number(match?.lat);
    const longitude = Number(match?.lon);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    return {
      latitude,
      longitude,
      displayName: typeof match.display_name === "string" ? match.display_name : address.trim(),
    };
  });
}
