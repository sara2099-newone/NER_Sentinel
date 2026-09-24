// Minimal in-memory TTL cache.
//
// Problem this solves: the AI pipeline (weather + rainfall + slope +
// /api/risk/predict) was being called fresh on every dashboard load,
// even when the same zone had just been queried seconds earlier. This
// is a plain Map-based cache with expiry — no Redis, no extra infra,
// good enough for a single-process hackathon deployment. It resets on
// server restart, which is fine here.

const store = new Map();

const buildKey = (namespace, latitude, longitude) => {
    // Round to ~1km precision so nearby requests for "the same place"
    // share a cache entry instead of missing on float noise.
    const lat = Number(latitude).toFixed(2);
    const lng = Number(longitude).toFixed(2);
    return `${namespace}:${lat},${lng}`;
};

const get = (key) => {
    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }

    return entry.value;
};

const set = (key, value, ttlMs) => {
    store.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
};

// Wraps an async producer function with cache-or-fetch semantics.
// Example: withCache("weather", lat, lng, 5 * 60 * 1000, () => getWeatherData(lat, lng))
const withCache = async (namespace, latitude, longitude, ttlMs, producer) => {
    const key = buildKey(namespace, latitude, longitude);

    const cached = get(key);
    if (cached !== null) {
        return { data: cached, cached: true };
    }

    const fresh = await producer();
    set(key, fresh, ttlMs);
    return { data: fresh, cached: false };
};

const clearAll = () => store.clear();

module.exports = {
    withCache,
    clearAll
};
