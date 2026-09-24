// Multilingual notifications — for the FIXED set of strings this
// system generates (risk levels, priority levels, safety status,
// the critical-alert SMS template). This is a real, working i18n
// layer, but it is deliberately scoped to templated system messages,
// not free-text translation — there's no reliable no-key MT API for
// arbitrary text, and guessing at one would be worse than not having
// it.
//
// TRANSLATION CONFIDENCE — read before a real deployment:
//   en, hi, bn — standard translations, reasonably confident.
//   as (Assamese) — written using Bengali-Assamese script; a few
//     words differ from standard Assamese usage — best-effort.
//   mni (Manipuri/Meitei), kha (Khasi), lus (Mizo) — best-effort
//     only, English-anchored gloss where a confident translation
//     wasn't available. ALL THREE ARE FLAGGED NEEDS_REVIEW below.
// Get a native speaker to check every non-English string here before
// this is used for anything beyond a demo — an alert people can't
// parse correctly is worse than one only in English.

const SUPPORTED_LOCALES = ["en", "hi", "as", "bn", "mni", "kha", "lus"];

const NEEDS_REVIEW_LOCALES = ["as", "mni", "kha", "lus"];

const RISK_LEVEL = {
    Low: { en: "Low", hi: "कम", as: "কম", bn: "কম", mni: "Ahaanba (low)", kha: "Neipha (low)", lus: "Tlawmte (low)" },
    Moderate: { en: "Moderate", hi: "मध्यम", as: "মধ্যম", bn: "মাঝারি", mni: "Marakta (moderate)", kha: "Mynhalor (moderate)", lus: "Zataka (moderate)" },
    High: { en: "High", hi: "उच्च", as: "উচ্চ", bn: "উচ্চ", mni: "Wangba (high)", kha: "Bakhraw (high)", lus: "Sang (high)" },
    "Very High": { en: "Very High", hi: "बहुत उच्च", as: "অতি উচ্চ", bn: "অত্যন্ত উচ্চ", mni: "Yamna wangba (very high)", kha: "Bakhraw shibun (very high)", lus: "Sang tak (very high)" }
};

const PRIORITY_LEVEL = {
    Low: RISK_LEVEL.Low,
    Moderate: RISK_LEVEL.Moderate,
    High: RISK_LEVEL.High,
    Critical: { en: "Critical", hi: "गंभीर", as: "গুরুতর", bn: "অত্যন্ত গুরুত্বপূর্ণ", mni: "Maruoiba (critical)", kha: "Kylli bok (critical)", lus: "A pawi tak (critical)" }
};

const SAFETY_STATUS = {
    Safe: { en: "I'm Safe", hi: "मैं सुरक्षित हूं", as: "মই সুৰক্ষিত আছো", bn: "আমি সুরক্ষিত আছি", mni: "Ei ngak-hanbi (I'm safe)", kha: "Ngan shatai (I'm safe)", lus: "Ka dam a ni (I'm safe)" },
    NeedHelp: { en: "I Need Help", hi: "मुझे सहायता चाहिए", as: "মোক সহায় লাগে", bn: "আমার সাহায্য দরকার", mni: "Eina mateng tabani (I need help)", kha: "Ngan mut ban ïr (I need help)", lus: "Ka ngaihtuah a ngai (I need help)" }
};

// {zone} and {rules} are substituted by the caller.
const CRITICAL_ALERT_TEMPLATE = {
    en: "NER Sentinel ALERT: {zone} has crossed a critical landslide-risk threshold ({rules}). Check the official dashboard.",
    hi: "NER Sentinel चेतावनी: {zone} में भूस्खलन का गंभीर खतरा सीमा पार हो गया है ({rules})। कृपया डैशबोर्ड देखें।",
    bn: "NER Sentinel সতর্কতা: {zone}-তে ভূমিধসের ঝুঁকি সংকটজনক সীমা অতিক্রম করেছে ({rules})। দয়া করে ড্যাশবোর্ড দেখুন।",
    as: "NER Sentinel সতর্কবার্তা: {zone}-ত ভূমিস্খলনৰ বিপদ গুৰুতৰ সীমা অতিক্রম কৰিছে ({rules})। ডেশবোর্ড চাওক।",
    mni: "NER Sentinel ALERT: {zone} da landslide risk critical level thok-le ({rules}). Official dashboard yeng-u.",
    kha: "NER Sentinel ALERT: Ka {zone} ka la iaid ha ka jrong balang khraw ({rules}). Peit ïa ka dashboard.",
    lus: "NER Sentinel ALERT: {zone} ah lednawh tihlum sang tak a thleng ({rules}). Dashboard chu en teh."
};

const translateLabel = (dictionary, key, locale = "en") => {
    const entry = dictionary[key];
    if (!entry) return key; // unknown key — return as-is rather than throw
    return entry[locale] || entry.en || key;
};

const translateRiskLevel = (level, locale) => translateLabel(RISK_LEVEL, level, locale);
const translatePriorityLevel = (level, locale) => translateLabel(PRIORITY_LEVEL, level, locale);
const translateSafetyStatus = (status, locale) => translateLabel(SAFETY_STATUS, status, locale);

const renderCriticalAlert = (locale, { zone, rules }) => {
    const template = CRITICAL_ALERT_TEMPLATE[locale] || CRITICAL_ALERT_TEMPLATE.en;
    return template.replace("{zone}", zone).replace("{rules}", rules);
};

// Builds one combined SMS body with the alert in every requested
// locale on its own line — one message, multiple languages, rather
// than N separate sends (cheaper on a Twilio trial account too).
const renderMultilingualAlert = (locales, { zone, rules }) => {
    const uniqueLocales = [...new Set(locales.length ? locales : ["en"])];
    return uniqueLocales
        .map((locale) => renderCriticalAlert(locale, { zone, rules }))
        .join("\n---\n");
};

// Agency dispatch template — {agency}, {zone}, {reason}, {population} substituted by the caller.
const AGENCY_DISPATCH_TEMPLATE = {
    en: "[{agency}] NER Sentinel DISPATCH: Landslide risk at {zone}. Reason: {reason}. Approx. {population} people in the 5km zone. Respond per protocol.",
    hi: "[{agency}] NER Sentinel सूचना: {zone} में भूस्खलन का खतरा। कारण: {reason}। लगभग {population} लोग 5 किमी क्षेत्र में। कृपया प्रोटोकॉल अनुसार कार्रवाई करें।",
    bn: "[{agency}] NER Sentinel প্রেরণ: {zone}-এ ভূমিধসের ঝুঁকি। কারণ: {reason}। আনুমানিক {population} জন মানুষ ৫ কিমি এলাকায়। প্রোটোকল অনুযায়ী পদক্ষেপ নিন।",
    as: "[{agency}] NER Sentinel প্ৰেৰণ: {zone}-ত ভূমিস্খলনৰ বিপদ। কাৰণ: {reason}। প্ৰায় {population} জন মানুহ ৫ কিমি অঞ্চলত।",
    mni: "[{agency}] NER Sentinel DISPATCH: {zone} da landslide risk le. Reason: {reason}. ~{population} mi 5km zone da lei. Protocol yaduna respond tou.",
    kha: "[{agency}] NER Sentinel DISPATCH: Ka jrong ha {zone}. Kaba lada: {reason}. ~{population} briew ha ka 5km zone.",
    lus: "[{agency}] NER Sentinel DISPATCH: {zone} ah lednawh a awm. A chhan: {reason}. Mi ~{population} vel 5km chhung ah an awm."
};

const renderAgencyDispatch = (locale, { agency, zone, reason, population }) => {
    const template = AGENCY_DISPATCH_TEMPLATE[locale] || AGENCY_DISPATCH_TEMPLATE.en;
    return template
        .replace("{agency}", agency)
        .replace("{zone}", zone)
        .replace("{reason}", reason)
        .replace("{population}", population);
};

module.exports = {
    SUPPORTED_LOCALES,
    NEEDS_REVIEW_LOCALES,
    translateRiskLevel,
    translatePriorityLevel,
    translateSafetyStatus,
    renderCriticalAlert,
    renderMultilingualAlert,
    renderAgencyDispatch
};
