// A visible record of every alert dispatch attempt — automatic
// (scheduler threshold crossings) and manual (an official's trigger
// or agency dispatch). Without this, an auto-alert firing was only
// ever a console.log line nobody watching the frontend would see.
//
// Bounded in-memory ring buffer — fine for a demo/single-process
// deployment; a real production system would persist this in Mongo
// the same way, just swap the storage, not the shape.

const MAX_ENTRIES = 200;
const log = [];

const record = (entry) => {
    log.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date(),
        ...entry
    });
    if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
    return log[0];
};

const getRecent = (limit = 30) => log.slice(0, limit);

module.exports = { record, getRecent };
