// SMS alert dispatch.
//
// Real cell-broadcast / mass SMS to an entire district needs telecom-
// carrier access — not achievable in a hackathon. What IS achievable
// and genuinely real: sending an actual SMS through a Twilio trial
// account to one or more registered demo numbers. That's what this
// does. If Twilio env vars aren't set, it logs what WOULD have been
// sent and returns a clearly-marked simulated result instead of
// crashing — so the rest of the app (scheduler, incident routes) can
// always call this safely regardless of whether Twilio is configured
// for a given run.

const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER
} = process.env;

const isConfigured = () =>
    Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

let twilioClient = null;
const getClient = () => {
    if (!isConfigured()) return null;
    if (twilioClient) return twilioClient;

    // Lazy-required so the app doesn't hard-fail if the `twilio`
    // package isn't installed in an environment that never sends SMS.
    const twilio = require("twilio");
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
};

// toNumbers: array of E.164 phone numbers, e.g. ["+919876543210"]
const sendAlertSms = async (toNumbers, message) => {
    const recipients = Array.isArray(toNumbers) ? toNumbers : [toNumbers];

    if (!isConfigured()) {
        console.warn(
            "[alertService] Twilio not configured — simulating SMS send.",
            { recipients, message }
        );

        return {
            simulated: true,
            configured: false,
            recipients,
            message,
            note:
                "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER " +
                "to send real SMS via a Twilio trial account."
        };
    }

    const client = getClient();
    const results = [];

    for (const to of recipients) {
        try {
            const sms = await client.messages.create({
                body: message,
                from: TWILIO_FROM_NUMBER,
                to
            });
            results.push({ to, status: sms.status, sid: sms.sid });
        } catch (error) {
            results.push({ to, status: "failed", error: error.message });
        }
    }

    return {
        simulated: false,
        configured: true,
        results
    };
};

module.exports = { sendAlertSms, isConfigured };
