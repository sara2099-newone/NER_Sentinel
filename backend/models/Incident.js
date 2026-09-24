const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema(
    {
        location: {
            type: {
                lat: Number,
                lng: Number
            },
            required: true
        },

        description: {
            type: String,
            required: true
        },

        imageUrl: {
            type: String,
            default: ""
        },

        videoUrl: {
            type: String,
            default: ""
        },

        // Real uploaded file URLs (see routes/uploadRoutes.js), e.g.
        // ["/uploads/171234-abc.jpg"]. imageUrl/videoUrl are kept above
        // for backward compatibility with anything already using them.
        evidence: {
            type: [String],
            default: []
        },

        reportedBy: {
            type: String,
            default: "Citizen"
        },

        status: {
            type: String,
            enum: ["Pending", "Verified", "Rejected"],
            default: "Pending"
        },

        riskLevel: {
            type: String,
            enum: ["Low", "Moderate", "High", "Very High"],
            default: "Low"
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Incident", incidentSchema);