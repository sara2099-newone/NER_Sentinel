const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        password: {
            type: String,
            required: true,
            minlength: 6
        },

        role: {
            type: String,
            enum: ["Citizen", "Official"],
            default: "Citizen"
        },

        // Optional — only needed if the citizen wants to reply "SAFE" /
        // "HELP" by plain SMS (no app) after an alert. Not required at
        // signup since not everyone will use this path.
        phone: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("User", userSchema);