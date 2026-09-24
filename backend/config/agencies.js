// Responder agency categories for multi-agency alert dispatch.
//
// SAFETY NOTE — read before touching this file:
// These numbers are NOT pre-filled with any real emergency helpline
// (India's 100/101/108/1078 etc.) on purpose. If this code ever runs
// with real Twilio credentials, an SMS to a real dispatch line is a
// real-world action with real consequences — it is not something a
// hackathon prototype should ever do by default. Fill each category's
// env var with YOUR OWN team's phones (or other consenting test
// numbers) for a demo. Never point these at a real public safety number
// unless you are the agency operating that number.

const CATEGORIES = [
    { id: "Police", label: "Police", envVar: "POLICE_SMS_NUMBERS", prefix: "[POLICE DISPATCH]" },
    { id: "Fire", label: "Fire Station", envVar: "FIRE_SMS_NUMBERS", prefix: "[FIRE DEPT]" },
    { id: "Medical", label: "Medical / Ambulance", envVar: "MEDICAL_SMS_NUMBERS", prefix: "[MEDICAL TEAM]" },
    { id: "DisasterManagement", label: "Disaster Management", envVar: "DISASTER_MGMT_SMS_NUMBERS", prefix: "[DISASTER MGMT]" }
];

const numbersFor = (categoryId) => {
    const cat = CATEGORIES.find((c) => c.id === categoryId);
    if (!cat) return [];
    return (process.env[cat.envVar] || "").split(",").map((n) => n.trim()).filter(Boolean);
};

const getCategories = () => CATEGORIES.map((c) => ({ id: c.id, label: c.label, configured: numbersFor(c.id).length > 0 }));

module.exports = { CATEGORIES, numbersFor, getCategories };
