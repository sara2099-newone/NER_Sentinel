# Citizen on-entry schema: auto-location → essential info → bold alert

This documents the exact flow and data shape a Citizen sees the moment
they log in, and what's deliberately left out of that first screen
(available instead via GIS/History/Safety — one tap away, not deleted).
It matches the real code in `frontend/public/app.js` — the two aren't
independent designs to keep in sync by hand.

## 1. Entry sequence

```
login success
  → enterApp()
      → autoDetectCitizenLocation()
          → navigator.geolocation.getCurrentPosition()
              ├─ granted → nearestZone(lat,lng) → renderCitizenRisk(zone, point, "automatic")
              └─ denied/unsupported → citizenLocationLine shows "unavailable" +
                                        citizen can search/select a zone manually instead
      → renderCitizenWarning(zone)   [always runs before the essential-info card]
      → renderCitizenRisk(zone)       [essential-info card]
```

The alert banner (`#citizenWarningBanner`) sits **above** the essential
card in the DOM (`index.html` line ~104, before `#yourAreaContent`) —
it is always the first thing rendered, not something the citizen has
to scroll to find.

## 2. Essential-info schema (`#yourAreaContent`)

Only these fields render on entry. Everything else (full map, response
workflow, alert history, historical-record detail) is one nav tap away,
never on this screen.

```jsonc
{
  "location": {
    "zoneName": "string",           // matched supported area
    "mode": "automatic | manual",
    "distanceKm": "number | null"   // only shown in automatic mode
  },
  "riskLevel": "Low | Medium | High | Critical",
  "aiRisk": { "value": "string", "status": "LIVE | UNAVAILABLE" },
  "factors": [
    { "label": "Rainfall (24h)",        "value": "number mm | Unavailable", "status": "LIVE|CACHED|DEMO|UNAVAILABLE" },
    { "label": "Weather now",            "value": "temp/humidity | Unavailable", "status": "..." },
    { "label": "Soil moisture",          "value": "percent | Unavailable", "status": "..." },
    { "label": "Terrain",                "value": "slope°/elevation | Unavailable", "status": "..." },
    { "label": "Landslide possibility",  "value": "early-warning status label" },
    { "label": "Nearby historical landslides", "value": "count within 150km", "status": "LIVE|UNAVAILABLE" }
  ],
  "mainRiskFactors": "string",       // one short explanation, not the full model output
  "recommendedAction": "string"      // one sentence, level-specific (see §4)
}
```

Deliberately **not** on this screen: full historical-record list and
sources (→ History page), villages/infrastructure detail (→ Official
control room only — see `OFFICIAL_DASHBOARD.md`), routing options (→
"Find safe route" button), alert history, incident-report form. Each
is reachable from a single button at the bottom of the essential card
or the nav bar, never removed — just not competing for attention here.

## 3. Alert banner schema (`#citizenWarningBanner`)

```jsonc
{
  "level": "Low | Medium | High | Critical",
  "icon": "✅ | ⚠️ | ⚠️ | 🚨",         // Low | Medium | High | Critical
  "eyebrow": "PERSONAL SAFETY WARNING"          // Low/Medium
            | "URGENT — PERSONAL SAFETY WARNING", // High/Critical
  "headline": "{ZONE}: {LEVEL} LANDSLIDE RISK",
  "message": "string",                // first early-warning reason, or a calm default for Low
  "recommendedAction": "string",
  "style": {
    "Low":      "calm — soft green tint, no animation",
    "Medium":   "clear caution — solid amber fill",
    "High":     "solid orange fill, white text, pulsing eyebrow dot",
    "Critical": "solid red gradient fill, white text, pulsing eyebrow dot"
  }
}
```

The four levels are differentiated on **three channels at once** —
color, icon, and wording — not color alone, so the banner still reads
correctly without color vision or in bright sunlight on a phone
screen.

## 4. Recommended-action text per level (`citizenSafetyAction()`)

| Level    | Action shown |
|----------|--------------|
| Critical | Move away from slopes and unstable drainage paths now; follow official evacuation instructions. |
| High     | Avoid slopes and stream channels, keep essentials ready, and follow official alerts closely. |
| Medium   | Stay alert, avoid unnecessary travel near steep slopes, and check for updated warnings. |
| Low      | (calm default — no action framed as urgent) |

## 5. What changed to match this schema

- Added a distinct icon per level (not color-only differentiation).
- Critical/High now render as a solid, high-contrast fill instead of a
  pastel tint, with a pulsing "URGENT" eyebrow — previously all four
  levels used the same subtle tinted-background treatment, which was
  easy to skim past under stress.
- Auto-location-detect → essential-card → bold-alert was already the
  real flow (`autoDetectCitizenLocation()` already ran on every
  Citizen login); this pass strengthened the *visual* differentiation
  the flow renders into, not the flow itself.
