const mongoose = require("mongoose");

const safetyStatusSchema = new mongoose.Schema(
    {
        // Present for an app-based report; absent (not merely null) for
        // an SMS-only report from someone who has never logged into the
        // app. Deliberately no `default` here: `user`/`phone` each have
        // a unique+sparse index below, and a Mongo sparse index still
        // indexes (and enforces uniqueness on) an explicit `null` — only
        // a genuinely *missing* field is skipped. A `default: null` used
        // to sit here, which meant the second SMS-only report (no `user`)
        // or the second phone-less app report (no `phone`) would fail to
        // upsert with a duplicate-key error on that shared explicit
        // null. Leaving the field undefined when not provided is what
        // actually gets the "absent" behavior the comment always described.
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },

        // Present for an SMS-based report (or an app user who has
        // registered a phone number for SMS reply support).
        phone: {
            type: String
        },

        // How this record was created/last updated — lets officials
        // (and this code) tell "used the app" apart from "replied by
        // text with no app", which matters for what we can trust.
        source: {
            type: String,
            enum: ["app", "sms", "demo"],
            default: "app"
        },

        // True only for records an Official generated with the "Generate
        // Help Requests" demo control (POST /api/demo/help-requests) —
        // never set for a real app or SMS report. Lets the UI/officials
        // tell simulated load apart from a genuine citizen in distress.
        demo: {
            type: Boolean,
            default: false
        },

        displayName: {
            type: String,
            default: ""
        },

        status: {
            type: String,
            enum: ["Safe", "NeedHelp", "Unknown"],
            default: "Unknown"
        },

        note: {
            type: String,
            default: ""
        },

        lastKnownLocation: {
            lat: Number,
            lng: Number,
            capturedAt: Date
        }
    },
    {
        timestamps: true
    }
);

// One evolving record per identity — updates overwrite rather than
// piling up a new row every time someone taps the button or texts in.
// Sparse so a null user/phone doesn't collide with other nulls.
safetyStatusSchema.index({ user: 1 }, { unique: true, sparse: true });
safetyStatusSchema.index({ phone: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("SafetyStatus", safetyStatusSchema);
