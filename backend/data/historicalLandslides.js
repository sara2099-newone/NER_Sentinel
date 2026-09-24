// Real, publicly-reported NER landslide/landslide-adjacent disaster
// records. Not a comprehensive inventory (that needs GSI Bhukosh/NRSC
// archive access) — a curated sample spanning small local incidents up
// to the two largest NER landslide-related disasters of the last
// decade, plus the most recent 2025/2026 events. Facts (date, place,
// approximate toll) compiled from public news reporting and Wikipedia
// via web search; descriptions are paraphrased, not quoted.
//
// coordinatePrecision: "town_approximate" means the coordinate is the
// nearest named town/district center, not the exact slope-failure
// point. approxFatalities figures vary across sources as death tolls
// were revised during rescue operations — the value used here is the
// most commonly cited/final figure at time of writing, not a
// guaranteed-precise count.

const RECORDS = [
    // --- Two largest NER landslide-related disasters, for scale ---
    {
        date: new Date("2022-06-30"),
        state: "Manipur",
        locationName: "Tupul railway yard, Noney district",
        location: { lat: 24.7833, lng: 93.6667 },
        coordinatePrecision: "town_approximate",
        description:
            "One of the deadliest landslides in NER history. A hillside collapsed onto a railway construction camp near Tupul station, burying Territorial Army personnel and railway workers and damming the Ijei river.",
        approxFatalities: 58,
        source: "Wikipedia: 2022 Manipur landslide; PTI/Deccan Herald contemporaneous reporting"
    },
    {
        date: new Date("2023-10-04"),
        state: "Sikkim",
        locationName: "Chungthang / Teesta river basin, North Sikkim",
        location: { lat: 27.6167, lng: 88.65 },
        coordinatePrecision: "town_approximate",
        description:
            "A landslide into South Lhonak glacial lake triggered a glacial lake outburst flood (GLOF) down the Teesta river, destroying the Teesta III dam at Chungthang and 15 bridges. Not a rainfall landslide in the classic sense, but landslide-triggered and the deadliest NER disaster of this kind in decades.",
        approxFatalities: 92,
        source: "Wikipedia: 2023 Sikkim flash floods; SSDMA situation reports"
    },

    // --- 2024 events (previously seeded) ---
    {
        date: new Date("2024-05-29"),
        state: "Mizoram",
        locationName: "Melthum/Hlimen, southern outskirts of Aizawl",
        location: { lat: 23.68, lng: 92.72 },
        description:
            "Stone quarry collapse and landslide during Cyclone Remal; National Highway 6 at Hunthar also blocked, cutting off Aizawl.",
        approxFatalities: 27,
        source: "AIR News Bulletin, 29 May 2024"
    },
    {
        date: new Date("2024-05-29"),
        state: "Meghalaya",
        locationName: "Multiple locations (state-wide)",
        location: { lat: 25.5788, lng: 91.8933 },
        coordinatePrecision: "town_approximate",
        description: "Cyclone Remal triggered heavy rain and landslides at several locations across the state.",
        approxFatalities: 1,
        source: "AIR News Bulletin, 29 May 2024"
    },
    {
        date: new Date("2024-06-01"),
        state: "Mizoram",
        locationName: "Aizawl area",
        location: { lat: 23.7271, lng: 92.7176 },
        description: "Landslide killed multiple people, including non-local labourers.",
        approxFatalities: 28,
        source: "EastMojo, 1 Jun 2024"
    },
    {
        date: new Date("2024-06-19"),
        state: "Assam",
        locationName: "Assam (district unspecified in source)",
        location: { lat: 26.1445, lng: 91.7362 },
        coordinatePrecision: "town_approximate",
        description: "Landslide killed a family of four, including a 3-year-old child.",
        approxFatalities: 4,
        source: "EastMojo, 19 Jun 2024"
    },
    {
        date: new Date("2024-09-04"),
        state: "Nagaland",
        locationName: "NH-29, Kohima-Dimapur link",
        location: { lat: 25.79, lng: 93.92 },
        description: "Multiple landslides on the Kohima-Dimapur highway cut off the road link.",
        approxFatalities: 6,
        source: "EastMojo, 4 Sep 2024"
    },
    {
        date: new Date("2024-10-07"),
        state: "Meghalaya",
        locationName: "South Garo Hills / East Khasi Hills area",
        location: { lat: 25.5788, lng: 91.8933 },
        coordinatePrecision: "town_approximate",
        description: "Landslide buried a family of seven; wider flash-flood event in the same window reported a 10-15 death toll and disrupted the Dalu-Baghmara road.",
        approxFatalities: 15,
        source: "EastMojo / IndiaTVNews, 5-7 Oct 2024"
    },

    // --- 2023 local incidents (previously seeded) ---
    {
        date: new Date("2023-06-17"),
        state: "Meghalaya",
        locationName: "West Khasi Hills",
        location: { lat: 25.5167, lng: 91.2667 },
        description: "Landslide buried two children alive.",
        approxFatalities: 2,
        source: "EastMojo, 17 Jun 2023"
    },
    {
        date: new Date("2023-01-28"),
        state: "Mizoram",
        locationName: "Khawzawl",
        location: { lat: 23.6333, lng: 93.0333 },
        description: "Road construction site cave-in.",
        approxFatalities: 3,
        source: "EastMojo, 28 Jan 2023"
    },
    {
        date: new Date("2023-06-17"),
        state: "Assam",
        locationName: "Guwahati",
        location: { lat: 26.1445, lng: 91.7362 },
        description: "Landslide killed one person in the city.",
        approxFatalities: 1,
        source: "EastMojo, 17 Jun 2023"
    },

    // --- 2025 "Northeast Deluge" monsoon season — multiple large events ---
    {
        date: new Date("2025-06-01"),
        state: "Multi-state (Assam, Arunachal Pradesh, Mizoram, Meghalaya, Tripura, Nagaland, Manipur)",
        locationName: "Northeast-wide, worst-hit: Guwahati, Assam",
        location: { lat: 26.1445, lng: 91.7362 },
        coordinatePrecision: "town_approximate",
        description:
            "Opening spell of the 2025 Northeast monsoon deluge: relentless rain caused simultaneous floods and landslides across seven states; toll climbed from ~22 to ~44 over the following days as reports came in.",
        approxFatalities: 44,
        source: "Reuters/Gulf Times/ekantipur (citing NDTV/govt officials), 1-4 Jun 2025"
    },
    {
        date: new Date("2025-06-03"),
        state: "Mizoram",
        locationName: "State-wide",
        location: { lat: 23.7271, lng: 92.7176 },
        coordinatePrecision: "town_approximate",
        description: "Nearly 600 separate landslides recorded across the state in a single reporting window amid unrelenting rain.",
        approxFatalities: 5,
        source: "Down To Earth, 3 Jun 2025"
    },
    {
        date: new Date("2025-06-25"),
        state: "Assam",
        locationName: "Dima Hasao district (New Haflong)",
        location: { lat: 25.1667, lng: 93.0167 },
        description:
            "Landslides triggered by highway repair work dumped roughly 50,000 cubic metres of debris onto the railway line, cutting rail links to Tripura, Mizoram, Manipur and southern Assam; 12 trains cancelled.",
        approxFatalities: null,
        source: "News Arena, 25 Jun 2025"
    },
    {
        date: new Date("2025-07-10"),
        state: "Mizoram",
        locationName: "State-wide",
        location: { lat: 23.7271, lng: 92.7176 },
        coordinatePrecision: "town_approximate",
        description: "846 landslides recorded across the state during the same monsoon spell that pushed Assam's flood/landslide toll to 30.",
        approxFatalities: null,
        source: "News Arena, 10 Jul 2025"
    },

    // --- Most recent ---
    {
        date: new Date("2025-05-30"),
        state: "Mizoram",
        locationName: "Aizawl",
        location: { lat: 23.7271, lng: 92.7176 },
        description: "Retaining wall collapse during rain-triggered landslide activity.",
        approxFatalities: 1,
        source: "EastMojo, 30 May 2025"
    },
    {
        date: new Date("2026-06-28"),
        state: "Sikkim",
        locationName: "North Sikkim",
        location: { lat: 27.5167, lng: 88.5333 },
        coordinatePrecision: "town_approximate",
        description: "Torrential rain washed away a Bailey bridge, cutting off North Sikkim — the most recent record in this set.",
        approxFatalities: null,
        source: "EastMojo, 28-29 Jun 2026"
    }
];

module.exports = { RECORDS };
