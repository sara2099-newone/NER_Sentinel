// Departments notified when a landslide incident becomes critical, as
// part of the RESPONSE workflow (department alerts + response teams).
//
// IMPORTANT — this is intentionally separate from config/agencies.js:
// agencies.js backs the existing real-Twilio-capable "multi-agency
// dispatch" panel (4 categories, sends an actual SMS if configured).
// This file backs the newer, broader 8-department RESPONSE workflow,
// which is DEMO DISPATCH ONLY by design — it never sends a real SMS,
// WhatsApp message, or email, regardless of what's in .env. That's a
// deliberate product decision (see responseService.js), not a gap to
// "complete" by wiring it to Twilio later without re-reading this note.

const DEPARTMENTS = [
    { id: "Police", label: "Police", icon: "ti-shield-check" },
    { id: "FireRescue", label: "Fire & Rescue", icon: "ti-flame" },
    { id: "Medical", label: "Medical / Ambulance", icon: "ti-ambulance" },
    { id: "DisasterManagement", label: "Disaster Management", icon: "ti-alert-triangle" },
    { id: "SearchRescue", label: "Search & Rescue", icon: "ti-search" },
    { id: "NGOs", label: "NGOs", icon: "ti-heart-handshake" },
    { id: "RoadsPublicWorks", label: "Roads / Public Works", icon: "ti-road" },
    { id: "LocalAdministration", label: "Local Administration", icon: "ti-building-bank" }
];

const getDepartmentById = (id) => DEPARTMENTS.find((d) => d.id === id) || null;

module.exports = { DEPARTMENTS, getDepartmentById };
