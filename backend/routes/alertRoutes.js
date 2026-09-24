const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getZoneById } = require("../config/zones");
const { renderMultilingualAlert, renderAgencyDispatch, SUPPORTED_LOCALES } = require("../services/i18nService");
const { sendAlertSms } = require("../services/alertService");
const { getCategories, numbersFor } = require("../config/agencies");
const { record: recordAlertLog, getRecent: getRecentAlerts } = require("../services/alertLogService");

const router = express.Router();

// GET /api/alerts/agencies — which responder categories are
// configured with real numbers vs. still empty (Official-only; this
// tells the frontend what it can actually dispatch to right now).
router.get("/agencies", protect, authorizeRoles("Official"), (req, res) => {
    res.status(200).json({ data: getCategories() });
});

// GET /api/alerts/log — recent alert dispatches, automatic (scheduler
// threshold crossings) and manual, newest first. Without this, an
// auto-alert firing was only ever a server console.log line — this is
// what makes "the system automatically warned officials" visible and
// checkable from the UI instead of taken on faith.
router.get("/log", protect, authorizeRoles("Official"), (req, res) => {
    res.status(200).json({ data: getRecentAlerts(Number(req.query.limit) || 30) });
});

// POST /api/alerts/dispatch-agencies (Official-only)
// { zoneId, agencies: ["Police","Fire","Medical","DisasterManagement"], reason, population, locale }
// Sends a category-prefixed dispatch message to each selected
// agency's configured numbers. See config/agencies.js — numbers are
// never pre-filled with real emergency helplines.
router.post("/dispatch-agencies", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const { zoneId, agencies = [], reason = "manually dispatched", population = "unknown", locale = "en" } = req.body;
        const zone = getZoneById(zoneId) || { name: zoneId || "Unnamed zone" };
        const useLocale = SUPPORTED_LOCALES.includes(locale) ? locale : "en";

        if (!agencies.length) return res.status(400).json({ message: "agencies must be a non-empty array" });

        const results = [];
        for (const agencyId of agencies) {
            const numbers = numbersFor(agencyId);
            const message = renderAgencyDispatch(useLocale, { agency: agencyId, zone: zone.name, reason, population });

            if (!numbers.length) {
                results.push({ agency: agencyId, sent: false, reason: `No numbers configured (${agencyId.toUpperCase()}_SMS_NUMBERS is empty in .env)`, wouldSend: message });
                recordAlertLog({ type: "agency-dispatch", zoneName: zone.name, agency: agencyId, message, sent: false, recipients: 0, note: "not configured" });
                continue;
            }

            const smsResult = await sendAlertSms(numbers, message);
            results.push({ agency: agencyId, sent: !smsResult.simulated, message, smsResult });
            recordAlertLog({ type: "agency-dispatch", zoneName: zone.name, agency: agencyId, message, sent: !smsResult.simulated, recipients: numbers.length });
        }

        res.status(200).json({ message: "Agency dispatch attempted", results });
    } catch (error) {
        res.status(500).json({ message: "Failed to dispatch to agencies", error: error.message });
    }
});

// POST /api/alerts/trigger (Official-only)
// { zoneId, locales: ["en","hi"], recipients: ["+91..."], rules: "manual_trigger" }
// Lets an official manually push the same multilingual critical-alert
// SMS the scheduler sends automatically — useful for a demo, and for
// a real situation an official wants to flag before the automated
// threshold check catches it.
router.post("/trigger", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const { zoneId, locales = ["en", "hi"], recipients = [], rules = "manually_triggered" } = req.body;

        const zone = getZoneById(zoneId) || { name: zoneId || "Unnamed zone" };
        const validLocales = locales.filter((l) => SUPPORTED_LOCALES.includes(l));

        const message = renderMultilingualAlert(validLocales.length ? validLocales : ["en"], {
            zone: zone.name,
            rules
        });

        const configuredRecipients = recipients.length
            ? recipients
            : (process.env.ALERT_SMS_RECIPIENTS || "").split(",").map((n) => n.trim()).filter(Boolean);

        if (!configuredRecipients.length) {
            recordAlertLog({ type: "manual-trigger", zoneName: zone.name, trigger: rules, message, sent: false, recipients: 0, note: "no recipients configured" });
            return res.status(200).json({
                message: "No recipients given and no ALERT_SMS_RECIPIENTS set — showing the message that would be sent",
                wouldSend: message
            });
        }

        const result = await sendAlertSms(configuredRecipients, message);
        recordAlertLog({ type: "manual-trigger", zoneName: zone.name, trigger: rules, message, sent: !result.simulated, recipients: configuredRecipients.length });
        res.status(200).json({ message: "Alert dispatch attempted", result, alertText: message });
    } catch (error) {
        res.status(500).json({ message: "Failed to trigger alert", error: error.message });
    }
});

module.exports = router;
