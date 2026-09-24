const mongoose = require("mongoose");

const historicalLandslideSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: true
        },

        state: {
            type: String,
            required: true
        },

        locationName: {
            type: String,
            required: true
        },

        location: {
            lat: { type: Number, required: true },
            lng: { type: Number, required: true }
        },

        // Coordinates for pre-2024 news-sourced events are town/district
        // level approximations, not the exact slope-failure point — GSI
        // Bhukosh-grade precision wasn't accessible in this pass. See
        // scripts/seedHistoricalLandslides.js for sourcing notes.
        coordinatePrecision: {
            type: String,
            enum: ["exact", "town_approximate"],
            default: "town_approximate"
        },

        description: {
            type: String,
            required: true
        },

        approxFatalities: {
            type: Number,
            default: null
        },

        source: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("HistoricalLandslide", historicalLandslideSchema);
