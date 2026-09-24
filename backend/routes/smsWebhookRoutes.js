const express = require("express");
const SafetyStatus = require("../models/SafetyStatus");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// SETUP NOTE: Twilio needs a public HTTPS URL to call /incoming — it
// cannot reach http://localhost. For a local demo, run this behind
// ngrok (`ngrok http 5000`) and paste the forwarded URL + `/api/sms/incoming`
// into your Twilio phone number's "A message comes in" webhook field.
//
// Until that's set up, /simulate below runs the IDENTICAL processing
// logic (same function, same DB write) from an authenticated button in
// the UI instead of a real incoming text — so the feature is genuinely
// demoable today, not just documented as "would work if configured".

const HELP_KEYWORDS = ["help", "मदद", "সাহায্য", "সহায়"];
const SAFE_KEYWORDS = ["safe", "सुरक्षित", "সুরক্ষিত"];

const detectStatus = (text) => {
    const lower = (text || "").toLowerCase().trim();
    if (HELP_KEYWORDS.some((k) => lower.includes(k))) return "NeedHelp";
    if (SAFE_KEYWORDS.some((k) => lower.includes(k))) return "Safe";
    return null;
};

// The one real processing function — both /incoming (Twilio) and
// /simulate (authenticated UI button) call this, so a "simulated"
// message goes through the exact same code as a real SMS reply.
const processIncomingSms = async (from, body) => {
    const status = detectStatus(body);

    if (!from) return { ok: false, reply: "Could not identify sender." };
    if (!status) {
        return { ok: false, reply: "NER Sentinel: reply SAFE if you're okay, or HELP if you need assistance." };
    }

    const saved = await SafetyStatus.findOneAndUpdate(
        { phone: from },
        { phone: from, status, source: "sms", note: `Via SMS: "${body}"` },
        { upsert: true, new: true, runValidators: true }
    );

    const reply =
        status === "NeedHelp"
            ? "NER Sentinel: Received — you've been marked as needing help. Responders have been notified."
            : "NER Sentinel: Received — you've been marked as safe. Thank you.";

    return { ok: true, status, reply, record: saved };
};

const twiml = (message) =>
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`;

// POST /api/sms/incoming — Twilio's real webhook. No auth (Twilio
// can't send our JWT); Twilio's own X-Twilio-Signature header is the
// real integrity check in production — not implemented here to keep
// this runnable without extra deps.
router.post("/incoming", async (req, res) => {
    res.set("Content-Type", "text/xml");
    try {
        const result = await processIncomingSms(req.body.From, req.body.Body);
        res.status(200).send(twiml(result.reply));
    } catch (error) {
        res.status(200).send(twiml("NER Sentinel: something went wrong recording your reply — please try again."));
    }
});

// POST /api/sms/simulate (Official-only) — { from, body }
// Runs the exact same processIncomingSms() as a real Twilio webhook
// call, triggered from the UI instead of an actual text message. This
// is how the "reply SAFE/HELP by SMS" feature is demoed without
// requiring ngrok + a live Twilio webhook to be configured first.
router.post("/simulate", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const { from, body } = req.body;
        if (!from) return res.status(400).json({ message: "from (phone number) is required" });
        const result = await processIncomingSms(from, body || "");
        res.status(200).json({ message: "Simulated SMS processed (same code path as a real Twilio webhook call)", ...result });
    } catch (error) {
        res.status(500).json({ message: "Failed to process simulated SMS", error: error.message });
    }
});

module.exports = router;
