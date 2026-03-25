// Citibike Social — deck.gl + MapLibre GL + Google Auth + Compare

// ═══════════════ Google OAuth Config ═══════════════
// Replace with your Google Cloud OAuth web client ID
const GOOGLE_CLIENT_ID = window.location.hostname === 'localhost'
    ? 'YOUR_CLIENT_ID.apps.googleusercontent.com'  // TODO: Replace
    : 'YOUR_CLIENT_ID.apps.googleusercontent.com';  // TODO: Replace

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Griffin's pre-loaded user ID (Google sub). Set after first sign-in.
// For now, Griffin's data loads as static and gets a placeholder ID.
const GRIFFIN_STATIC_ID = '__griffin_static__';

// ═══════════════ User Color Palettes ═══════════════
const PALETTES = [
    { // Warm (ember/orange) — assigned to first user (Griffin)
        name: 'warm',
        primary: '#FF6B35',
        stops: [
            [0.00,  50,   8,   0],
            [0.25, 140,  25,   0],
            [0.45, 200,  35,  10],
            [0.60, 230,  35,  60],
            [0.75, 245,  45, 140],
            [0.88, 255, 140,  50],
            [1.00, 255, 220, 120],
        ],
    },
    { // Cool (teal/cyan)
        name: 'cool',
        primary: '#4ECDC4',
        stops: [
            [0.00,   0,  40,  60],
            [0.25,   0,  80, 100],
            [0.45,  20, 140, 140],
            [0.60,  40, 180, 175],
            [0.75,  78, 205, 196],
            [0.88, 140, 230, 220],
            [1.00, 200, 245, 240],
        ],
    },
    { // Nature (green/lime)
        name: 'nature',
        primary: '#7ED957',
        stops: [
            [0.00,   0,  40,  15],
            [0.25,   0,  80,  30],
            [0.45,  30, 130,  50],
            [0.60,  60, 170,  70],
            [0.75, 100, 200,  80],
            [0.88, 126, 217,  87],
            [1.00, 190, 250, 170],
        ],
    },
    { // Violet (purple/pink)
        name: 'violet',
        primary: '#A78BFA',
        stops: [
            [0.00,  35,  10,  60],
            [0.25,  65,  20, 110],
            [0.45, 100,  40, 160],
            [0.60, 130,  70, 200],
            [0.75, 167, 139, 250],
            [0.88, 190, 170, 255],
            [1.00, 220, 200, 255],
        ],
    },
];

// ═══════════════ Configuration ═══════════════
const CONFIG = {
    GRID_CELL: 0.001,
    LOOP_LENGTH: 80,
    TRAIL_LENGTH: 1.5,
    MIN_POLYLINE_LEN: 50,
    VIRTUAL_ITEM_H: 56,
    VIRTUAL_BUFFER: 10,
};

const MONTH_MAP = {
    JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
    JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11
};
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ═══════════════ State ═══════════════
let map, deckOverlay;
let currentUser = null;       // { id, name, email, picture, accessToken, idToken }
let griffinRides = [];        // Griffin's pre-loaded rides
let myRides = [];             // Current signed-in user's rides

// Community data: { users: [...], rides: { userId: [...] } }
let community = { users: [], rides: {} };

// Which users are visible on the map (by user ID)
let visibleUsers = new Set();
// Maps userId → palette index
let userPalettes = new Map();

// Per-user layer data
let userPathData = new Map();    // userId → pathData[]
let userTripsData = new Map();   // userId → tripsData[]

let allYears = new Set(), activeYear = null;
let animating = true, animFrameId = null, userPaused = false;
let virtualList = null;
let focusedRideIdx = -1;
let deckClickHandled = false;

// ═══════════════ Date Parsing ═══════════════
function parseRideDate(dateStr) {
    if (!dateStr) return new Date(0);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const parts = dateStr.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
    if (parts) {
        return new Date(
            parseInt(parts[3]),
            MONTH_MAP[parts[1].toUpperCase()] ?? 0,
            parseInt(parts[2])
        );
    }
    return new Date(0);
}

function formatDate(dateStr) {
    const d = parseRideDate(dateStr);
    if (d.getTime() === 0) return dateStr;
    return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ═══════════════ Polyline ═══════════════
function decodePolylineStr(encoded) {
    if (!encoded || typeof polyline === 'undefined') return [];
    try { return polyline.decode(encoded); } catch { return []; }
}

function getDecodedPolyline(ride) {
    if (!ride._decoded) ride._decoded = decodePolylineStr(ride.polyline);
    return ride._decoded;
}

// ═══════════════ Density Grid ═══════════════
function buildDensityGrid(rides) {
    const CELL = CONFIG.GRID_CELL;
    const grid = new Map();
    let max = 0;
    for (const ride of rides) {
        const pts = getDecodedPolyline(ride);
        if (!pts || pts.length < 2) continue;
        const visited = new Set();
        for (let i = 0; i < pts.length - 1; i++) {
            const [lat1, lng1] = pts[i];
            const [lat2, lng2] = pts[i + 1];
            const dist = Math.sqrt((lat2 - lat1) ** 2 + (lng2 - lng1) ** 2);
            const steps = Math.max(1, Math.ceil(dist / (CELL * 0.5)));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const key = `${Math.floor((lat1 + t * (lat2 - lat1)) / CELL)},${Math.floor((lng1 + t * (lng2 - lng1)) / CELL)}`;
                if (!visited.has(key)) {
                    visited.add(key);
                    const count = (grid.get(key) || 0) + 1;
                    grid.set(key, count);
                    if (count > max) max = count;
                }
            }
        }
    }
    return { grid, max };
}

function rideHeatScore(ride, grid) {
    const CELL = CONFIG.GRID_CELL;
    const pts = getDecodedPolyline(ride);
    if (!pts || pts.length < 2) return 1;
    let best = 0;
    for (const [lat, lng] of pts) {
        const score = grid.get(`${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`) || 0;
        if (score > best) best = score;
    }
    return best || 1;
}

// ═══════════════ Thermal Colors (per palette) ═══════════════
function thermalRGBA(t, alpha, stops) {
    t = Math.max(0, Math.min(1, t));
    let i = 0;
    while (i < stops.length - 1 && stops[i + 1][0] < t) i++;
    if (i >= stops.length - 1) {
        const s = stops[stops.length - 1];
        return [s[1], s[2], s[3], alpha];
    }
    const [t0, r0, g0, b0] = stops[i];
    const [t1, r1, g1, b1] = stops[i + 1];
    const f = (t - t0) / (t1 - t0);
    return [
        Math.round(r0 + f * (r1 - r0)),
        Math.round(g0 + f * (g1 - g0)),
        Math.round(b0 + f * (b1 - b0)),
        alpha,
    ];
}

function thermalColor(t, stops) {
    const [r, g, b] = thermalRGBA(t, 255, stops);
    return `rgb(${r},${g},${b})`;
}

function rideStyle(score, maxScore, palette) {
    const t = maxScore > 1 ? Math.pow(score / maxScore, 0.35) : 0;
    const opacity = 0.10 + t * 0.25;
    return {
        color: thermalColor(t, palette.stops),
        colorRGBA: thermalRGBA(t, Math.round(opacity * 255), palette.stops),
        pulseRGBA: thermalRGBA(t, 255, palette.stops),
        weight: 0.5 + t * 0.8,
        opacity,
        t,
    };
}

// ═══════════════ Per-User Layer Data ═══════════════
function prepareUserLayerData(userId, rides, palette) {
    const sorted = [...rides].sort((a, b) => (a._heatScore || 0) - (b._heatScore || 0));
    const paths = [];
    const trips = [];

    for (let i = 0; i < sorted.length; i++) {
        const ride = sorted[i];
        if (!ride.origin_lat || !ride.dest_lat) continue;
        if (!ride.polyline || ride.polyline.length < CONFIG.MIN_POLYLINE_LEN) continue;
        const pts = getDecodedPolyline(ride);
        if (!pts || pts.length < 4) continue;

        const style = ride._style;
        const path = pts.map(p => [p[1], p[0]]);

        paths.push({
            path,
            color: style.colorRGBA,
            focusColor: [...style.colorRGBA.slice(0, 3), 255],
            dimColor: [...style.colorRGBA.slice(0, 3), 15],
            weight: style.weight,
            userId,
        });

        let totalDist = 0;
        const dists = [0];
        for (let j = 1; j < pts.length; j++) {
            const dlat = pts[j][0] - pts[j - 1][0];
            const dlng = pts[j][1] - pts[j - 1][1];
            totalDist += Math.sqrt(dlat * dlat + dlng * dlng);
            dists.push(totalDist);
        }

        const phase = (i * 7.31) % (CONFIG.LOOP_LENGTH - 7);
        const speed = 4 + (i % 5) * 0.6;
        const timestamps = totalDist > 0
            ? dists.map(d => phase + (d / totalDist) * speed)
            : dists.map(() => phase);

        trips.push({ path, timestamps, color: style.pulseRGBA });
    }

    userPathData.set(userId, paths);
    userTripsData.set(userId, trips);
}

// ═══════════════ Map Setup ═══════════════
const NYC_BOUNDS = [[-74.35, 40.45], [-73.65, 40.95]];
const IS_MOBILE = () => window.innerWidth <= 768;

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [-73.955, 40.695],
        zoom: 14,
        attributionControl: false,
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        maxBounds: NYC_BOUNDS,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    deckOverlay = new deck.MapboxOverlay({ layers: [] });
    map.addControl(deckOverlay);

    map.on('click', () => {
        if (deckClickHandled) { deckClickHandled = false; return; }
        if (focusedRideIdx >= 0) unfocusRide();
        if (IS_MOBILE()) {
            document.getElementById('sidebar').classList.remove('expanded');
            updateLegendVisibility();
        }
    });
}

// ═══════════════ Layer Updates ═══════════════
function updateLayers() {
    const layers = [];

    // Merge path data from all visible users
    const allPaths = [];
    const allTrips = [];
    for (const uid of visibleUsers) {
        const paths = userPathData.get(uid) || [];
        const trips = userTripsData.get(uid) || [];
        allPaths.push(...paths);
        allTrips.push(...trips);
    }

    layers.push(new deck.PathLayer({
        id: 'routes',
        data: allPaths,
        getPath: d => d.path,
        getColor: d => d.color,
        getWidth: d => d.weight,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        capRounded: true,
        jointRounded: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 40],
        onClick: (info) => {
            if (info.object) {
                deckClickHandled = true;
                return true;
            }
        },
    }));

    if (animating) {
        layers.push(new deck.TripsLayer({
            id: 'pulses',
            data: allTrips,
            getPath: d => d.path,
            getTimestamps: d => d.timestamps,
            getColor: d => d.color,
            widthMinPixels: 3,
            capRounded: true,
            jointRounded: true,
            trailLength: CONFIG.TRAIL_LENGTH,
            currentTime: (performance.now() / 1000) % CONFIG.LOOP_LENGTH,
        }));
    }

    deckOverlay.setProps({ layers });
}

// ═══════════════ Process Pipeline ═══════════════
function processUserRides(userId, rides, paletteIdx) {
    const palette = PALETTES[paletteIdx % PALETTES.length];
    const { grid, max } = buildDensityGrid(rides);
    rides.forEach(r => {
        r._heatScore = rideHeatScore(r, grid);
        r._style = rideStyle(r._heatScore, max, palette);
    });
    prepareUserLayerData(userId, rides, palette);
}

function recomputeAndDraw() {
    // Reprocess all visible users
    for (const uid of visibleUsers) {
        const rides = getFilteredRidesForUser(uid);
        const palIdx = userPalettes.get(uid) || 0;
        processUserRides(uid, rides, palIdx);
    }

    collectYears();
    renderStats();
    renderYearFilters();
    renderRideList();
    updateLayers();
    renderLegend();
    renderCompareOverlay();
    fitBounds();
}

function collectYears() {
    allYears.clear();
    for (const uid of visibleUsers) {
        const rides = getAllRidesForUser(uid);
        rides.forEach(r => {
            const y = parseRideDate(r.ride_date).getFullYear();
            if (y > 2000) allYears.add(y);
        });
    }
}

// ═══════════════ Data Access ═══════════════
function getAllRidesForUser(userId) {
    if (userId === GRIFFIN_STATIC_ID) return griffinRides;
    return community.rides[userId] || [];
}

function getFilteredRidesForUser(userId) {
    const rides = getAllRidesForUser(userId);
    if (!activeYear) return rides;
    return rides.filter(r => parseRideDate(r.ride_date).getFullYear() === activeYear);
}

function getMyFilteredRides() {
    // Current user's rides for the ride list
    const uid = currentUser ? currentUser.id : GRIFFIN_STATIC_ID;
    if (visibleUsers.has(uid)) return getFilteredRidesForUser(uid);
    // Fallback: show Griffin's rides if signed out
    if (visibleUsers.has(GRIFFIN_STATIC_ID)) return getFilteredRidesForUser(GRIFFIN_STATIC_ID);
    return [];
}

// ═══════════════ Filtering ═══════════════
function filterYear(year) {
    activeYear = year;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active',
            (!year && btn.dataset.year === 'all') ||
            btn.dataset.year === String(year));
    });
    recomputeAndDraw();
}

// ═══════════════ Focus / Unfocus ═══════════════
function focusRide(ride) {
    if (!ride || !ride.origin_lat) return;
    const inNYC = (lat, lng) => lat > 40.45 && lat < 40.95 && lng > -74.35 && lng < -73.65;
    if (!inNYC(ride.origin_lat, ride.origin_lng) || !inNYC(ride.dest_lat, ride.dest_lng)) return;

    const padding = IS_MOBILE()
        ? { top: 40, bottom: 160, left: 20, right: 20 }
        : 80;
    const bounds = new maplibregl.LngLatBounds(
        [ride.origin_lng, ride.origin_lat],
        [ride.dest_lng, ride.dest_lat]
    );
    map.fitBounds(bounds, { padding, duration: 600, maxZoom: 16 });

    if (IS_MOBILE()) document.getElementById('sidebar').classList.remove('expanded');
}

function unfocusRide() {
    focusedRideIdx = -1;
    if (virtualList) virtualList.setActive(-1);
}

// ═══════════════ Animation ═══════════════
function startAnimation() {
    animating = true;
    if (!animFrameId) animate();
}
function stopAnimation() {
    animating = false;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}
function animate() {
    if (!animating) { animFrameId = null; return; }
    updateLayers();
    animFrameId = requestAnimationFrame(animate);
}

const PAUSE_ICON = '<svg width="10" height="12" viewBox="0 0 10 12"><rect x="0" y="0" width="3" height="12" fill="currentColor"/><rect x="7" y="0" width="3" height="12" fill="currentColor"/></svg>';
const PLAY_ICON = '<svg width="10" height="12" viewBox="0 0 10 12"><polygon points="0,0 10,6 0,12" fill="currentColor"/></svg>';

function toggleAnimation() {
    const btn = document.getElementById('anim-toggle');
    if (animating) {
        stopAnimation(); userPaused = true; btn.innerHTML = PLAY_ICON; updateLayers();
    } else {
        startAnimation(); userPaused = false; btn.innerHTML = PAUSE_ICON;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAnimation();
    else if (!userPaused) startAnimation();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') unfocusRide(); });

// ═══════════════ Virtual Scroll ═══════════════
class VirtualList {
    constructor(container) {
        this.container = container;
        this.itemH = CONFIG.VIRTUAL_ITEM_H;
        this.items = [];
        this.renderFn = null;
        this.activeIdx = -1;
        this.inner = document.createElement('div');
        this.inner.style.position = 'relative';
        container.appendChild(this.inner);
        this._raf = null;
        container.addEventListener('scroll', () => {
            if (!this._raf) {
                this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
            }
        });
    }
    update(items, renderFn) {
        this.items = items;
        this.renderFn = renderFn;
        this.inner.style.height = `${items.length * this.itemH}px`;
        this._render();
    }
    _render() {
        const top = this.container.scrollTop;
        const h = this.container.clientHeight;
        const buf = CONFIG.VIRTUAL_BUFFER;
        const start = Math.max(0, Math.floor(top / this.itemH) - buf);
        const end = Math.min(this.items.length, Math.ceil((top + h) / this.itemH) + buf);
        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
            const el = this.renderFn(this.items[i], i);
            el.style.position = 'absolute';
            el.style.top = `${i * this.itemH}px`;
            el.style.left = '0'; el.style.right = '0';
            el.style.height = `${this.itemH}px`;
            if (i === this.activeIdx) el.classList.add('active');
            frag.appendChild(el);
        }
        this.inner.replaceChildren(frag);
    }
    scrollTo(idx) {
        const target = idx * this.itemH;
        const h = this.container.clientHeight;
        const top = this.container.scrollTop;
        if (target < top || target + this.itemH > top + h) {
            this.container.scrollTop = target - h / 2 + this.itemH / 2;
        }
    }
    setActive(idx) { this.activeIdx = idx; this._render(); }
}

// ═══════════════ Sidebar Rendering ═══════════════
function renderStats() {
    const myRidesList = getMyFilteredRides();
    const stations = new Set();
    let totalCost = 0;
    myRidesList.forEach(r => {
        if (r.start_station) stations.add(r.start_station);
        if (r.end_station) stations.add(r.end_station);
        const c = r.total_charged;
        if (c && c.startsWith && c.startsWith('$')) totalCost += parseFloat(c.slice(1)) || 0;
    });

    document.getElementById('stats').innerHTML = `
        <div class="stat"><div class="stat-value">${myRidesList.length.toLocaleString()}</div><div class="stat-label">Rides</div></div>
        <div class="stat"><div class="stat-value">${stations.size}</div><div class="stat-label">Stations</div></div>
        <div class="stat"><div class="stat-value">${[...allYears].length}</div><div class="stat-label">Years</div></div>
        <div class="stat"><div class="stat-value">$${Math.round(totalCost).toLocaleString()}</div><div class="stat-label">Spent</div></div>
    `;
}

function renderYearFilters() {
    const years = [...allYears].sort((a, b) => b - a);
    document.getElementById('year-filters').innerHTML =
        `<span class="filter-btn ${!activeYear ? 'active' : ''}" data-year="all" onclick="filterYear(null)">All</span>` +
        years.map(y =>
            `<span class="filter-btn ${activeYear === y ? 'active' : ''}" data-year="${y}" onclick="filterYear(${y})">${y}</span>`
        ).join('');
}

function renderRideList() {
    const container = document.getElementById('ride-list');
    const filtered = getMyFilteredRides();

    if (!virtualList) {
        container.innerHTML = '';
        virtualList = new VirtualList(container);
    }

    const uid = currentUser ? currentUser.id : GRIFFIN_STATIC_ID;
    const palIdx = userPalettes.get(uid) || 0;
    const palette = PALETTES[palIdx % PALETTES.length];

    virtualList.update(filtered, (ride, idx) => {
        const el = document.createElement('div');
        el.className = 'ride-item';
        const style = ride._style || { color: palette.primary, t: 0 };
        el.style.borderLeftColor = style.color;
        el.innerHTML =
            `<div class="ride-date">${formatDate(ride.ride_date)} &middot; ${ride.ride_time || ride.start_time}${ride.type === 'group_ride' ? ' &middot; Group' : ''}</div>` +
            `<div class="ride-route"><span class="station">${ride.start_station || '?'}</span>` +
            `<span class="arrow" style="color:${style.color}">&rarr;</span>` +
            `<span class="station">${ride.end_station || '?'}</span></div>`;
        el.addEventListener('click', () => focusRide(ride));
        return el;
    });
}

function renderLegend() {
    const legend = document.getElementById('legend');
    const items = [];
    for (const uid of visibleUsers) {
        const palIdx = userPalettes.get(uid) || 0;
        const palette = PALETTES[palIdx % PALETTES.length];
        const name = getUserName(uid);
        items.push(`
            <div class="legend-item">
                <div class="legend-swatch" style="background: ${palette.primary}"></div>
                <span class="legend-label">${name}</span>
            </div>
        `);
    }
    legend.innerHTML = `
        <div class="legend-title">Riders on map</div>
        <div class="legend-items">${items.join('')}</div>
    `;
}

function renderCompareOverlay() {
    const overlay = document.getElementById('compare-overlay');
    if (visibleUsers.size < 2) {
        overlay.classList.remove('visible');
        return;
    }

    const stats = [];
    for (const uid of visibleUsers) {
        const rides = getFilteredRidesForUser(uid);
        const palIdx = userPalettes.get(uid) || 0;
        const palette = PALETTES[palIdx % PALETTES.length];
        const name = getUserName(uid);
        stats.push(`
            <div class="compare-stat">
                <div class="compare-stat-name" style="color:${palette.primary}">${name}</div>
                <div class="compare-stat-value">${rides.length.toLocaleString()}</div>
                <div class="compare-stat-label">rides</div>
            </div>
        `);
    }
    overlay.innerHTML = stats.join('');
    overlay.classList.add('visible');
}

function getUserName(userId) {
    if (userId === GRIFFIN_STATIC_ID) return 'Griffin';
    const user = community.users.find(u => u.id === userId);
    return user ? user.name.split(' ')[0] : 'Unknown';
}

// ═══════════════ Compare / Friend Chips ═══════════════
function renderFriendChips() {
    const container = document.getElementById('friend-chips');
    const section = document.getElementById('compare-section');

    // Build chip list from all known users
    const allUsers = [];

    // Griffin (static) is always first
    allUsers.push({
        id: GRIFFIN_STATIC_ID,
        name: 'Griffin',
        picture: '',
        rideCount: griffinRides.length,
    });

    // Add community users (skip Griffin if he signed in and his static is still showing)
    for (const u of community.users) {
        if (u.id !== GRIFFIN_STATIC_ID) {
            allUsers.push(u);
        }
    }

    if (allUsers.length < 2) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    container.innerHTML = allUsers.map((u, i) => {
        const palIdx = userPalettes.get(u.id);
        const palette = palIdx != null ? PALETTES[palIdx % PALETTES.length] : PALETTES[0];
        const isActive = visibleUsers.has(u.id);
        const initial = (u.name || '?')[0].toUpperCase();
        const avatarHtml = u.picture
            ? `<img src="${u.picture}" alt="${initial}" referrerpolicy="no-referrer">`
            : `<div style="width:22px;height:22px;border-radius:50%;background:${palette.primary};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;border:2px solid ${isActive ? palette.primary : 'transparent'}">${initial}</div>`;

        return `
            <div class="friend-chip ${isActive ? 'active' : ''}"
                 style="--chip-color:${palette.primary}; --chip-bg:${palette.primary}22"
                 onclick="toggleUser('${u.id}')">
                ${avatarHtml}
                <span class="friend-chip-name">${u.name.split(' ')[0]}</span>
                <span class="friend-chip-count">${(u.rideCount || 0).toLocaleString()}</span>
            </div>
        `;
    }).join('');
}

function toggleUser(userId) {
    if (visibleUsers.has(userId)) {
        // Don't allow deselecting the last user
        if (visibleUsers.size <= 1) return;
        visibleUsers.delete(userId);
    } else {
        visibleUsers.add(userId);
    }
    recomputeAndDraw();
    renderFriendChips();
}

// ═══════════════ Map Utilities ═══════════════
function fitBounds() {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    let hasPoints = false;

    for (const uid of visibleUsers) {
        const rides = getFilteredRidesForUser(uid);
        rides.forEach(r => {
            if (r.origin_lat) {
                west = Math.min(west, r.origin_lng); east = Math.max(east, r.origin_lng);
                south = Math.min(south, r.origin_lat); north = Math.max(north, r.origin_lat);
                hasPoints = true;
            }
            if (r.dest_lat) {
                west = Math.min(west, r.dest_lng); east = Math.max(east, r.dest_lng);
                south = Math.min(south, r.dest_lat); north = Math.max(north, r.dest_lat);
                hasPoints = true;
            }
        });
    }

    if (hasPoints) {
        const padding = IS_MOBILE() ? { top: 20, bottom: 160, left: 20, right: 20 } : 40;
        map.fitBounds([[west, south], [east, north]], { padding, duration: 0, maxZoom: 16 });
    }
}

function resetView() { unfocusRide(); fitBounds(); }

function updateLegendVisibility() {
    const legend = document.querySelector('.legend');
    if (!legend || !IS_MOBILE()) return;
    const expanded = document.getElementById('sidebar').classList.contains('expanded');
    legend.classList.toggle('hidden', expanded);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (IS_MOBILE()) sidebar.classList.toggle('expanded');
    else sidebar.classList.toggle('collapsed');
    updateLegendVisibility();
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (IS_MOBILE()) sidebar.classList.remove('expanded');
    else sidebar.classList.add('collapsed');
    updateLegendVisibility();
}

// ═══════════════ Sheet Drag (mobile) ═══════════════
function initSheetDrag() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sheet-handle');
    if (!handle) return;
    let startY, isDragging = false;
    handle.addEventListener('click', () => toggleSidebar());
    const dragZone = [handle, sidebar.querySelector('.header')];
    dragZone.forEach(el => {
        if (!el) return;
        el.addEventListener('touchstart', e => {
            if (!IS_MOBILE()) return;
            startY = e.touches[0].clientY;
            isDragging = true;
            sidebar.style.transition = 'none';
        }, { passive: true });
    });
    document.addEventListener('touchmove', e => {
        if (!isDragging) return;
        e.preventDefault();
        const dy = e.touches[0].clientY - startY;
        const isExpanded = sidebar.classList.contains('expanded');
        const sheetH = sidebar.offsetHeight;
        const peek = 160;
        const base = isExpanded ? 0 : (sheetH - peek);
        const clamped = Math.max(0, Math.min(sheetH - peek, base + dy));
        sidebar.style.transform = `translateY(${clamped}px)`;
    }, { passive: false });
    document.addEventListener('touchend', e => {
        if (!isDragging) return;
        isDragging = false;
        const endY = e.changedTouches[0]?.clientY ?? startY;
        const dy = endY - startY;
        sidebar.style.transition = '';
        sidebar.style.transform = '';
        if (Math.abs(dy) < 10) return;
        else if (dy > 50) sidebar.classList.remove('expanded');
        else if (dy < -50) sidebar.classList.add('expanded');
        updateLegendVisibility();
    }, { passive: true });
}


// ═══════════════════════════════════════════════════════
//  GOOGLE AUTH + GMAIL SCRAPING (CLIENT-SIDE)
// ═══════════════════════════════════════════════════════

let tokenClient = null;
let gapiInited = false;
let gisInited = false;

function initGoogleAuth() {
    // Initialize the Google Identity Services token client
    if (typeof google === 'undefined' || !google.accounts) {
        // GIS not loaded yet, retry
        setTimeout(initGoogleAuth, 200);
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: `openid email profile ${GMAIL_SCOPE}`,
        callback: handleTokenResponse,
    });
    gisInited = true;
}

function initGapi() {
    if (typeof gapi === 'undefined') {
        setTimeout(initGapi, 200);
        return;
    }
    gapi.load('client', async () => {
        await gapi.client.init({});
        await gapi.client.load('gmail', 'v1');
        gapiInited = true;
    });
}

function signIn() {
    if (!gisInited) { alert('Google Sign-In is still loading. Please wait.'); return; }
    tokenClient.requestAccessToken();
}

function signOut() {
    currentUser = null;
    myRides = [];

    // Remove current user from visible, ensure Griffin static remains
    if (currentUser) visibleUsers.delete(currentUser.id);
    visibleUsers.add(GRIFFIN_STATIC_ID);

    document.getElementById('auth-signed-in').style.display = 'none';
    document.getElementById('auth-signed-out').style.display = '';
    recomputeAndDraw();
    renderFriendChips();
}

async function handleTokenResponse(tokenResponse) {
    if (tokenResponse.error) {
        console.error('Auth error:', tokenResponse);
        return;
    }

    const accessToken = tokenResponse.access_token;

    // Get user info from Google
    try {
        const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const userInfo = await resp.json();

        currentUser = {
            id: userInfo.sub,
            name: userInfo.name || userInfo.email.split('@')[0],
            email: userInfo.email,
            picture: userInfo.picture || '',
            accessToken,
        };

        // Update UI
        document.getElementById('auth-signed-out').style.display = 'none';
        document.getElementById('auth-signed-in').style.display = '';
        document.getElementById('user-name').textContent = currentUser.name;
        document.getElementById('user-email').textContent = currentUser.email;
        if (currentUser.picture) {
            document.getElementById('user-avatar').src = currentUser.picture;
        }

        // Assign palette
        if (!userPalettes.has(currentUser.id)) {
            userPalettes.set(currentUser.id, userPalettes.size);
        }

        // Check if we already have this user's rides in community data
        if (community.rides[currentUser.id] && community.rides[currentUser.id].length > 0) {
            myRides = community.rides[currentUser.id];
            visibleUsers.add(currentUser.id);
            recomputeAndDraw();
            renderFriendChips();
            return;
        }

        // Start Gmail scraping
        await scrapeGmail(accessToken);

    } catch (err) {
        console.error('Failed to get user info:', err);
    }
}


// ═══════════════ Gmail Scraping (Client-Side) ═══════════════

async function scrapeGmail(accessToken) {
    const scrapeSection = document.getElementById('scrape-section');
    const scrapeBar = document.getElementById('scrape-bar');
    const scrapeStatus = document.getElementById('scrape-status');
    scrapeSection.classList.add('visible');

    try {
        scrapeStatus.textContent = 'Searching Gmail for Citibike receipts...';
        scrapeBar.style.width = '5%';

        // Search for receipt emails
        const queries = [
            'from:no-reply@updates.citibikenyc.com subject:(Ride Receipt)',
            'from:no-reply@lyftmail.com subject:("Lyft Bike ride")',
            'from:no-reply@updates.citibikenyc.com subject:("receipt for rides")',
            'from:no-reply@lyftmail.com subject:("receipt for rides")',
            'from:no-reply@updates.citibikenyc.com subject:("weekly receipt")',
        ];

        const allMsgIds = new Set();
        for (const q of queries) {
            const ids = await gmailSearch(accessToken, q);
            ids.forEach(id => allMsgIds.add(id));
        }

        const msgIds = [...allMsgIds];
        scrapeStatus.textContent = `Found ${msgIds.length} receipt emails. Parsing...`;
        scrapeBar.style.width = '15%';

        if (msgIds.length === 0) {
            scrapeStatus.textContent = 'No Citibike receipts found in your Gmail.';
            setTimeout(() => scrapeSection.classList.remove('visible'), 3000);
            return;
        }

        // Fetch and parse each message
        const rides = [];
        const batchSize = 5;

        for (let i = 0; i < msgIds.length; i += batchSize) {
            const batch = msgIds.slice(i, i + batchSize);
            const batchPromises = batch.map(id => fetchAndParseMessage(accessToken, id));
            const results = await Promise.all(batchPromises);

            for (const parsed of results) {
                if (parsed) rides.push(...parsed);
            }

            const pct = 15 + (85 * Math.min(i + batchSize, msgIds.length) / msgIds.length);
            scrapeBar.style.width = `${pct}%`;
            scrapeStatus.textContent = `Parsed ${Math.min(i + batchSize, msgIds.length)} / ${msgIds.length} emails (${rides.length} rides)`;
        }

        scrapeBar.style.width = '100%';
        scrapeStatus.textContent = `Done! Found ${rides.length} rides.`;

        // Store rides
        myRides = rides;
        community.rides[currentUser.id] = rides;

        // Update community user record
        const existingUser = community.users.find(u => u.id === currentUser.id);
        if (existingUser) {
            existingUser.rideCount = rides.length;
        } else {
            community.users.push({
                id: currentUser.id,
                name: currentUser.name,
                email: currentUser.email,
                picture: currentUser.picture,
                rideCount: rides.length,
            });
        }

        // Make visible and redraw
        visibleUsers.add(currentUser.id);
        recomputeAndDraw();
        renderFriendChips();

        // Save to backend
        saveRidesToBackend(rides);

        setTimeout(() => scrapeSection.classList.remove('visible'), 2000);

    } catch (err) {
        console.error('Scraping error:', err);
        scrapeStatus.textContent = `Error: ${err.message}`;
    }
}

async function gmailSearch(accessToken, query) {
    const ids = [];
    let pageToken = '';

    do {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) break;
        const data = await resp.json();
        if (data.messages) {
            data.messages.forEach(m => ids.push(m.id));
        }
        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return ids;
}

async function fetchAndParseMessage(accessToken, messageId) {
    try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) return null;
        const msg = await resp.json();

        const headers = {};
        (msg.payload.headers || []).forEach(h => { headers[h.name] = h.value; });
        const subject = headers.Subject || '';
        const date = headers.Date || '';

        const html = extractHtmlFromPayload(msg.payload);
        if (!html) return null;

        return parseReceiptHtml(html, messageId, subject, date);
    } catch {
        return null;
    }
}

function extractHtmlFromPayload(payload) {
    if (payload.mimeType === 'text/html') {
        const data = payload.body?.data || '';
        return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    for (const part of (payload.parts || [])) {
        const html = extractHtmlFromPayload(part);
        if (html) return html;
    }
    return '';
}


// ═══════════════ Receipt Parser (JS port of parse_receipt.py) ═══════════════

function parseReceiptHtml(html, messageId, subject, date) {
    const isDailyDigest = html.includes('DAILY RECEIPT') || html.includes('WEEKLY RECEIPT') ||
        html.includes('Your bill for yesterday') || html.includes('recap of your day') ||
        subject.toLowerCase().includes('receipt for rides') || subject.toLowerCase().includes('weekly receipt');

    if (isDailyDigest) {
        return parseDailyDigest(html, messageId, subject, date);
    }
    return parseIndividualReceipt(html, messageId, subject, date);
}

function parseIndividualReceipt(html, messageId, subject, date) {
    const isGroupRide = subject.includes('Group ride') || html.includes('Group ride');
    const source = detectSource(html);

    const ride = {
        message_id: messageId,
        type: isGroupRide ? 'group_ride' : 'individual',
        source,
    };

    // Date/time
    const dtMatch = html.match(/(\w+ \d{1,2}, \d{4})\s*\n?\s*AT\s*\n?\s*(\d{1,2}:\d{2} [AP]M)/);
    if (dtMatch) {
        ride.ride_date = dtMatch[1].trim();
        ride.ride_time = dtMatch[2].trim();
    }

    // Stations and times
    const tripMatch = html.match(/(?:Your Trip|'s Trip)([\s\S]*?)(?:Question about charges|Receipt #)/);
    const tripSection = tripMatch ? tripMatch[1] : html;

    const stationRe = /font-size: 17px;[^"]*color: #0C0B31;[^"]*line-height: 20px;[^"]*font-weight: 400;["\s]*>\s*\n?\s*(.+?)\s*\n?\s*<\/td>/g;
    const stations = [];
    let m;
    while ((m = stationRe.exec(tripSection))) stations.push(cleanText(m[1]));
    ride.start_station = stations[0] || '';
    ride.end_station = stations[1] || '';

    const timeRe = /<span style="font-weight: 400;">(Start|End)<\/span><br>\s*\n?\s*(\d{1,2}:\d{2} [ap]m)/g;
    while ((m = timeRe.exec(tripSection))) {
        if (m[1] === 'Start') ride.start_time = m[2].trim();
        else ride.end_time = m[2].trim();
    }

    // Map data (lat/lng + polyline)
    const mapRe = /(?:api\.lyft\.com\/v1\/staticmap\/general|staticmap)[^"]*?origin_lat=([^&]+)&amp;origin_lng=([^&]+)&amp;dest_lat=([^&]+)&amp;dest_lng=([^&]+)&amp;polyline=([^&"]+)/;
    const mapMatch = html.match(mapRe);
    if (mapMatch) {
        ride.origin_lat = parseFloat(mapMatch[1]);
        ride.origin_lng = parseFloat(mapMatch[2]);
        ride.dest_lat = parseFloat(mapMatch[3]);
        ride.dest_lng = parseFloat(mapMatch[4]);
        ride.polyline = decodeURIComponent(mapMatch[5]);
    }

    // Bike number
    const bikeMatch = html.match(/pill_background\.png[^>]*>[\s\S]*?(\d{3}-\d{4})/);
    ride.bike_number = bikeMatch ? bikeMatch[1] : '';

    // Total charged
    const totalMatch = html.match(/font-size: 30px;[^"]*color: #0C0B31;[^"]*line-height: 32px;["\s]*>\s*\n?\s*(\$[\d.]+)/);
    ride.total_charged = totalMatch ? totalMatch[1].trim() : '';

    // Receipt number
    const receiptMatch = html.match(/Receipt #\s*(\d+)/);
    ride.receipt_number = receiptMatch ? receiptMatch[1] : '';

    // Rider name for group rides
    if (isGroupRide) {
        const nameMatch = subject.match(/(.+?)'s Ride Receipt/);
        ride.rider_name = nameMatch ? nameMatch[1] : '';
    }

    return [ride];
}

function parseDailyDigest(html, messageId, subject, date) {
    const rides = [];
    const source = detectSource(html);

    const rideRe = /(\w+ \d{1,2}, \d{4}\s+\d{1,2}:\d{2}\s*[AP]M)\s*<\/td>[\s\S]*?\$(\d+\.\d{2})\s*\n?\s*<\/td>/g;
    let m;
    while ((m = rideRe.exec(html))) {
        const rawDt = m[1].replace(/\s+/g, ' ').trim();
        const dtParts = rawDt.match(/(\w+ \d{1,2}, \d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/);

        rides.push({
            message_id: messageId,
            type: 'daily_digest',
            source,
            ride_date: dtParts ? dtParts[1] : '',
            ride_time: dtParts ? dtParts[2] : '',
            total_charged: `$${m[2]}`,
            start_station: '',
            end_station: '',
            origin_lat: null,
            origin_lng: null,
            dest_lat: null,
            dest_lng: null,
            polyline: '',
        });
    }

    return rides;
}

function detectSource(html) {
    if (html.includes('updates.citibikenyc.com') || html.includes('LyftCitibikePBL'))
        return 'citibike';
    return 'lyft';
}

function cleanText(text) {
    return text
        .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}


// ═══════════════ Backend Communication ═══════════════

async function saveRidesToBackend(rides) {
    if (!currentUser || !currentUser.accessToken) return;

    // Get a fresh ID token for backend auth
    try {
        const tokenResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${currentUser.accessToken}` },
        });
        if (!tokenResp.ok) return;

        // Use the access token directly for backend auth (backend will verify with Google)
        await fetch('/api/save_rides', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.accessToken}`,
            },
            body: JSON.stringify({ rides }),
        });
    } catch (err) {
        console.warn('Failed to save rides to backend:', err);
        // Non-fatal — rides are still in memory
    }
}

async function loadCommunity() {
    try {
        const resp = await fetch('/api/community');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.users) {
            community.users = data.users;
        }
        if (data.rides) {
            for (const [uid, rides] of Object.entries(data.rides)) {
                community.rides[uid] = rides;
            }
        }

        // Assign palettes to community users
        let palIdx = 1; // 0 is reserved for Griffin/first user
        for (const u of community.users) {
            if (!userPalettes.has(u.id)) {
                userPalettes.set(u.id, palIdx++);
            }
        }
    } catch {
        // Backend not available — that's OK, we still have static data
    }
}


// ═══════════════ Boot ═══════════════

initMap();
initSheetDrag();

// Load Griffin's static data
const griffinPromise = fetch('./data/griffin.json')
    .then(r => r.json())
    .catch(() => []);

// Load community data from backend
const communityPromise = loadCommunity();

map.on('load', async () => {
    griffinRides = await griffinPromise;
    await communityPromise;

    // Sort Griffin's rides
    griffinRides.sort((a, b) => parseRideDate(b.ride_date) - parseRideDate(a.ride_date));

    // Set up Griffin as default visible user
    userPalettes.set(GRIFFIN_STATIC_ID, 0);
    visibleUsers.add(GRIFFIN_STATIC_ID);

    // If community has users, make their data available
    // (but only show on map when toggled)
    let palIdx = 1;
    for (const u of community.users) {
        if (!userPalettes.has(u.id)) {
            userPalettes.set(u.id, palIdx++);
        }
    }

    recomputeAndDraw();
    renderFriendChips();
    startAnimation();

    // Init Google auth
    initGoogleAuth();
    initGapi();
});
