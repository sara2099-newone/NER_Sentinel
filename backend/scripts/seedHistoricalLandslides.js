// Seeds real, publicly-reported NER landslide events into MongoDB.
// The actual record list lives in data/historicalLandslides.js so it
// can be shared with the zero-dependency demo server too — see that
// file for sourcing notes.
//
// Run with: node scripts/seedHistoricalLandslides.js

require("dotenv").config();
const mongoose = require("mongoose");
const HistoricalLandslide = require("../models/HistoricalLandslide");
const { RECORDS } = require("../data/historicalLandslides");

const run = async () => {
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI not set — check your .env");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected. Seeding historical landslide records...");

    for (const record of RECORDS) {
        await HistoricalLandslide.findOneAndUpdate(
            { date: record.date, locationName: record.locationName },
            record,
            { upsert: true, new: true }
        );
    }

    console.log(`Seeded ${RECORDS.length} historical landslide records.`);
    await mongoose.disconnect();
};

run().catch((error) => {
    console.error("Seed failed:", error.message);
    process.exit(1);
});
