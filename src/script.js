import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

// Setup three-mesh-bvh for insane raycasting performance
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Group, Tween, Easing } from '@tweenjs/tween.js'

/**
 * Base
 */
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
// Set a background color (optional, enables us to see the world bounds nicely if no skybox)
// scene.background = new THREE.Color(0xaaaaaa); 

//Overlay
const overlayGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

/**
 * Camera
 */
const camera = new THREE.PerspectiveCamera(60, sizes.width / sizes.height, 0.1, 2000)
camera.position.x = -233.27
camera.position.y = 139.96
camera.position.z = 233.27
scene.add(camera)

let isAnimating = false;

/**
 * Controls
 */
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.05 // optional, default is 0.05, can also be reduced
controls.enablePan = true
controls.minDistance = 0.1
controls.maxDistance = 500

// Slow down the controls to make them less sensitive
controls.rotateSpeed = 0.4
controls.zoomSpeed = 0.4
controls.panSpeed = 0.4

// Limit panning to keep model in view
const minPan = new THREE.Vector3(-200, -50, -100)
const maxPan = new THREE.Vector3(200, 350, 400)
const _v = new THREE.Vector3()

controls.addEventListener('change', () => {
    _v.copy(controls.target)
    controls.target.clamp(minPan, maxPan)
    _v.sub(controls.target)
    camera.position.sub(_v)
})

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

// Enable Shadows and Tone Mapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.5

// Environment Lighting - Toggleable System
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

// Store both environment textures
let roomEnvironmentTexture = null;
let hdriTexture = null;

// Lighting settings
const lightingSettings = {
    useHDRI: false, // Start with RoomEnvironment (original)
    toggleLighting: function () {
        this.useHDRI = !this.useHDRI;
        updateEnvironment();
    }
};

// Create RoomEnvironment texture
roomEnvironmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// Load HDRI texture
new RGBELoader()
    .load('/textures/citrus_orchard_road_puresky_1k.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        hdriTexture = texture;
        // If we're already set to use HDRI, apply it now
        if (lightingSettings.useHDRI) {
            updateEnvironment();
        }
    });

// Function to update the environment
function updateEnvironment() {
    if (lightingSettings.useHDRI && hdriTexture) {
        scene.environment = hdriTexture;
    } else {
        scene.environment = roomEnvironmentTexture;
    }
}

// Set initial environment (RoomEnvironment)
scene.environment = roomEnvironmentTexture;

/**
 * Textures
 */
const textureLoader = new THREE.TextureLoader()

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')

const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

// ===================================================
// Iframe-safe navigation
// ---------------------------------------------------
// Handles three contexts:
//   1) Standalone (opened directly at 3d.mekhlopat.mn)  → window.location.href
//   2) Same-origin iframe                                → window.top.location.href
//   3) Cross-origin iframe (WordPress ↔ Vercel subdomain) → postMessage to parent
//
// The parent WordPress page listens for { type: 'namir3d:navigate', url }
// and sets window.location.href on receipt.
// ===================================================
function navigateTo(url) {
    if (!url) return;
    const trimmed = String(url).trim();
    if (!trimmed || trimmed === '#' || trimmed === 'NA') return;
    if (!/^https?:\/\//i.test(trimmed)) {
        // Reject placeholders like "Weblink Is underconstruction!" or relative paths
        console.warn('[navigateTo] Skipping non-http URL:', trimmed);
        return;
    }

    const inIframe = window.self !== window.top;

    if (!inIframe) {
        window.location.href = trimmed;
        return;
    }

    // Iframe path: notify parent (works cross-origin) AND try top navigation (same-origin only)
    try {
        window.parent.postMessage({ type: 'namir3d:navigate', url: trimmed }, '*');
    } catch (e) {
        console.warn('[navigateTo] postMessage failed:', e);
    }
    try {
        window.top.location.href = trimmed;
    } catch (e) {
        // Cross-origin — the parent listener will handle navigation
    }
}

// ===================================================
// NEW: Hotspot CSV Loading and Management
// ===================================================
let hotspotData = [];
let hotspotElements = []; // DOM elements for 2D hotspots
let currentLanguage = 'EN';
let categoryColorMap = {}; // keyed by categoryKey -> { color, textColor, iconColor }
let categoryGroupMap = {}; // keyed by categoryKey -> group name
let groupIconMap = {};     // keyed by group name -> icon filename
let activeHotspotIndex = -1;

const _knownFilters = {
    '#ff2c2c': 'brightness(0) saturate(100%) invert(27%) sepia(90%) saturate(5000%) hue-rotate(340deg) brightness(105%)',
    '#00b9ff': 'brightness(0) saturate(100%) invert(62%) sepia(98%) saturate(1500%) hue-rotate(168deg) brightness(103%)',
    '#f58220': 'brightness(0) saturate(100%) invert(60%) sepia(90%) saturate(2000%) hue-rotate(1deg) brightness(104%)',
    '#ba8e23': 'brightness(0) invert(1) brightness(0.5) sepia(100%) hue-rotate(5deg) saturate(280%) brightness(0.75)',
};

function iconColorToFilter(color) {
    if (!color || color === 'white' || color === '#ffffff') return 'brightness(0) invert(1)';
    if (color === 'black' || color === '#000000') return 'brightness(0)';
    if (!color.startsWith('#') || color.length !== 7) return 'brightness(0) invert(1)';
    const known = _knownFilters[color.toLowerCase()];
    if (known) return known;
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    const rn=r/255, gn=g/255, bn=b/255;
    const max=Math.max(rn,gn,bn), min=Math.min(rn,gn,bn);
    const l=(max+min)/2;
    const d=max-min;
    let h=0, s=0;
    if(d>0){
        s=l>0.5?d/(2-max-min):d/(max+min);
        if(max===rn) h=((gn-bn)/d+(gn<bn?6:0))/6;
        else if(max===gn) h=((bn-rn)/d+2)/6;
        else h=((rn-gn)/d+4)/6;
    }
    const hDeg=h*360, sPct=s*100, lPct=l*100;
    if(sPct < 15) {
        return `brightness(0) invert(1) brightness(${(lPct/100).toFixed(2)})`;
    }
    // Apply brightness(0.5) before sepia so we work from grey (~HSL 38.5°,24.3%,57.5%)
    // rather than near-white, which preserves saturation for vibrant target colours
    const hueRot = Math.round(hDeg - 38.5);
    const sat = Math.round(sPct / 24.3 * 100);
    const br = (lPct / 57.5).toFixed(2);
    return `brightness(0) invert(1) brightness(0.5) sepia(100%) hue-rotate(${hueRot}deg) saturate(${sat}%) brightness(${br})`;
}

// Robust CSV Line Parser
function parseCSVLine(str) {
    const arr = [];
    let quote = false;
    let col = '';
    let i = 0;
    while (i < str.length) {
        let c = str[i];
        if (c === '"') {
            if (i + 1 < str.length && str[i + 1] === '"') {
                col += '"';
                i += 2;
                continue;
            }
            quote = !quote;
        } else if (c === ',' && !quote) {
            arr.push(col.trim());
            col = '';
        } else {
            col += c;
        }
        i++;
    }
    arr.push(col.trim());
    return arr;
}


// Load and parse CSV file
async function loadHotspotCSV() {
    try {
        const response = await fetch(`/data/hotspots_multilang.csv?t=${Date.now()}`);
        const csvText = await response.text();

        // Parse CSV
        const lines = [];
        let currentLine = '';
        let inQuotes = false;
        const trimmedText = csvText.trim();
        for (let i = 0; i < trimmedText.length; i++) {
            const char = trimmedText[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            }
            if (char === '\n' && !inQuotes) {
                lines.push(currentLine);
                currentLine = '';
            } else {
                currentLine += char;
            }
        }
        if (currentLine) lines.push(currentLine);
        if (lines.length < 2) return; // Need headers + data

        // Parse Headers
        const headers = parseCSVLine(lines[0]).map(h => h.trim());
        const headerMap = {};
        headers.forEach((h, i) => { headerMap[h] = i; });

        // Helper to get value by header name safely
        const getVal = (values, key) => {
            const idx = headerMap[key];
            if (idx === undefined || idx >= values.length) return '';
            return values[idx].trim();
        };

        hotspotData = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            if (values.length < 2) return null; // Skip empty/malformed

            // Use header mapping for robustness
            const baseData = {
                // Common Fields
                position: new THREE.Vector3(
                    parseFloat(getVal(values, 'X')),
                    parseFloat(getVal(values, 'Y')),
                    parseFloat(getVal(values, 'Z'))
                ),
                fixedCameraPos: (getVal(values, 'CamX') && getVal(values, 'CamY')) ? new THREE.Vector3(
                    parseFloat(getVal(values, 'CamX')),
                    parseFloat(getVal(values, 'CamY')),
                    parseFloat(getVal(values, 'CamZ'))
                ) : null,

                fixedTargetPos: (getVal(values, 'TgtX') && getVal(values, 'TgtY')) ? new THREE.Vector3(
                    parseFloat(getVal(values, 'TgtX')),
                    parseFloat(getVal(values, 'TgtY')),
                    parseFloat(getVal(values, 'TgtZ'))
                ) : null,

                minZoom: parseFloat(getVal(values, 'MinZoom')) || 0,
                maxZoom: parseFloat(getVal(values, 'MaxZoom')) || 1000,

                // Visuals
                image: getVal(values, 'Image'),
                icon: getVal(values, 'Icon'),
                phone: getVal(values, 'Phone'),
                email: getVal(values, 'Email'),
                color: getVal(values, 'Color'),
                textColor: getVal(values, 'TextColor'),
                iconColor: getVal(values, 'IconColor'),
                group: getVal(values, 'Group'),
                groupIcon: getVal(values, 'GroupIcon'),
                groupIconColor: getVal(values, 'GroupIconColor'),

                button1Url: getVal(values, 'Button1Url') || '#',
                button2Url: getVal(values, 'Button2Url') || '#',

                // Text Data for Switching
                text: {
                    EN: {
                        category: getVal(values, 'Category'),
                        name: getVal(values, 'Item'),
                        description: getVal(values, 'Description') || 'No description available.',
                        button1Text: getVal(values, 'Button1Text'),
                        button2Text: getVal(values, 'Button2Text')
                    },
                    MN: {
                        category: getVal(values, 'Category_MN') || getVal(values, 'Category'),
                        name: getVal(values, 'Item_MN') || getVal(values, 'Item'),
                        description: getVal(values, 'Description_MN') || getVal(values, 'Description'),
                        button1Text: getVal(values, 'Button1Text_MN') || getVal(values, 'Button1Text'),
                        button2Text: getVal(values, 'Button2Text_MN') || getVal(values, 'Button2Text')
                    }
                },

                // Key for CSS styling (Always English Category)
                categoryKey: getVal(values, 'Category'),

                // Current State (Initialized to EN)
                category: getVal(values, 'Category'),
                name: getVal(values, 'Item'),
                description: getVal(values, 'Description') || 'No description available.',
                button1Text: getVal(values, 'Button1Text'),
                button2Text: getVal(values, 'Button2Text'),

                isActive: false,
                clicked: false
            };

            // Apply global offset to Category Headers (Main Icons) to push them up slightly
            if (baseData.category === baseData.name) {
                baseData.position.y += 5;
            }

            return baseData;
        }).filter(item => item !== null);

        // Build colour and group lookups from category header rows
        categoryColorMap = {};
        categoryGroupMap = {};
        groupIconMap = {};
        hotspotData.forEach(data => {
            if (data.name === data.category) {
                if (data.color) {
                    categoryColorMap[data.categoryKey] = {
                        color: data.color,
                        textColor: data.textColor || '#ffffff',
                        iconColor: data.iconColor || 'white',
                        groupIconColor: data.groupIconColor || ''
                    };
                }
                if (data.group) {
                    categoryGroupMap[data.categoryKey] = data.group;
                }
                if (data.groupIcon && data.group) {
                    groupIconMap[data.group] = data.groupIcon;
                }
            }
        });

        // Initial Render
        createHotspotElements();
        populateSidebar();

        // If the model already finished loading, warm the image cache now.
        // (Otherwise the model's onLoad handler will trigger it.)
        if (loadedModel) preloadPanelImages();

    } catch (error) {
        console.error('Failed to load hotspot CSV:', error);
    }
}

function updateAppLanguage() {
    // 1. Update data objects in place
    hotspotData.forEach(data => {
        const t = data.text[currentLanguage];
        data.category = t.category;
        data.name = t.name;
        data.description = t.description;
        data.button1Text = t.button1Text;
        data.button2Text = t.button2Text;
    });

    // 2. Re-create Sidebar
    populateSidebar();

    // 3. Re-create Hotspot Elements
    // Clear existing
    hotspotElements.forEach(el => {
        if (el && el.parentNode) el.parentNode.remove();
    });
    hotspotElements = [];
    createHotspotElements();

    // 4. Update Info Panel if open
    // If we have an active index, refresh it
    if (activeHotspotIndex !== -1 && hotspotData[activeHotspotIndex].clicked) {
        showInfoPanel(hotspotData[activeHotspotIndex]);
    }
}

// Populate Sidebar with 3-level Hierarchy: Group → Category → Items
function populateSidebar() {
    const sidebarList = document.querySelector('.sidebar-links');
    if (!sidebarList) return;

    sidebarList.innerHTML = '';

    // Build group → category → items structure
    const groupMap = {};
    const groupOrder = [];

    hotspotData.forEach((data, index) => {
        const groupName = data.group || categoryGroupMap[data.categoryKey] || 'Other';
        const catName = data.category;

        if (!groupMap[groupName]) {
            groupMap[groupName] = { categories: {}, categoryOrder: [] };
            groupOrder.push(groupName);
        }
        const grp = groupMap[groupName];

        if (!grp.categories[catName]) {
            grp.categories[catName] = { headerIndex: -1, items: [], color: '' };
            grp.categoryOrder.push(catName);
        }
        const cat = grp.categories[catName];

        if (data.name === data.category) {
            cat.headerIndex = index;
            cat.color = data.color || (categoryColorMap[data.categoryKey] || {}).color || '';
        } else {
            cat.items.push({ name: data.name, index: index });
        }
    });

    // Render
    groupOrder.forEach(groupName => {
        const grp = groupMap[groupName];

        const groupLi = document.createElement('li');
        groupLi.className = 'sidebar-group';

        const groupTitle = document.createElement('span');
        groupTitle.className = 'group-title';
        const groupIconFile = groupIconMap[groupName];
        if (groupIconFile) {
            const groupIconImg = document.createElement('img');
            groupIconImg.src = `/images/Icons/${groupIconFile}`;
            groupIconImg.className = 'sidebar-group-icon';
            groupIconImg.alt = groupName;
            groupTitle.appendChild(groupIconImg);
        }
        const groupTitleText = document.createElement('span');
        groupTitleText.textContent = groupName;
        groupTitle.appendChild(groupTitleText);
        groupLi.appendChild(groupTitle);

        const catUl = document.createElement('ul');
        catUl.className = 'group-categories';

        grp.categoryOrder.forEach(catName => {
            const cat = grp.categories[catName];

            const catLi = document.createElement('li');
            catLi.className = 'sidebar-category';
            if (cat.color) {
                catLi.style.setProperty('--cat-color', cat.color);
            }

            const catTitle = document.createElement('span');
            catTitle.className = 'category-title';
            catTitle.textContent = catName;

            if (cat.headerIndex !== -1) {
                catTitle.addEventListener('click', () => {
                    onHotspotClick2D(cat.headerIndex);
                    const sidebar = document.getElementById('left-sidebar');
                    if (sidebar) sidebar.classList.remove('active');
                    setSidebarOverlayHidden(false);
                });
            }
            catLi.appendChild(catTitle);

            if (cat.items.length > 0) {
                const submenu = document.createElement('ul');
                submenu.className = 'submenu';

                cat.items.forEach(item => {
                    const subLi = document.createElement('li');
                    subLi.className = 'submenu-item';
                    subLi.textContent = item.name;
                    subLi.addEventListener('click', () => {
                        onHotspotClick2D(item.index);
                        const sidebar = document.getElementById('left-sidebar');
                        if (sidebar) sidebar.classList.remove('active');
                        setSidebarOverlayHidden(false);
                    });
                    submenu.appendChild(subLi);
                });
                catLi.appendChild(submenu);
            }

            catUl.appendChild(catLi);
        });

        groupLi.appendChild(catUl);
        sidebarList.appendChild(groupLi);
    });
}

// Create DOM elements for each hotspot
function createHotspotElements() {
    const container = document.querySelector('.ui-container');

    // First, identify children for each category to populate the panel
    const categoryChildren = {};
    hotspotData.forEach((data, index) => {
        if (!categoryChildren[data.category]) {
            categoryChildren[data.category] = [];
        }
        if (data.name !== data.category) {
            categoryChildren[data.category].push(data);
        }
    });

    hotspotData.forEach((data, index) => {
        // Create hotspot marker container
        const marker = document.createElement('div');
        marker.className = 'hotspot-marker scale-transition';
        if (data.name !== data.category) {
            marker.classList.add('is-child');
        }
        marker.dataset.category = data.categoryKey;
        marker.dataset.name = data.nameKey;
        marker.dataset.index = index;

        // --- NEW STRUCTURE: Icon + Expandable Panel ---

        // Apply per-category colour via CSS custom properties
        const catColors = categoryColorMap[data.categoryKey] || {};
        const themeColor = data.color || catColors.color || '#0690ce';
        const iconColor = data.iconColor || catColors.iconColor || 'white';
        const labelColor = data.textColor || catColors.textColor || '#111111';
        const markerGroup = data.group || categoryGroupMap[data.categoryKey] || '';
        marker.style.setProperty('--theme-color', themeColor);
        marker.style.setProperty('--icon-filter', iconColorToFilter(iconColor));
        marker.style.setProperty('--label-color', labelColor);

        // 1. Icon Container (Visible initially)
        const iconBox = document.createElement('div');
        iconBox.className = 'hotspot-icon-box';

        // Custom Icon Logic
        let iconHtml = '';
        if (data.icon && data.icon.trim() !== '') {
            // New: Use custom image if provided
            iconHtml = `<img src="/images/Icons/${data.icon}" alt="icon" class="custom-icon-img" />`;
        } else {
            // Fallback SVG (Gear)
            iconHtml = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>`;
        }

        iconBox.innerHTML = iconHtml;
        const iconImgEl = iconBox.querySelector('.custom-icon-img');
        if (iconImgEl) {
            // Icon box sits on a dark/theme-coloured background, so keep the icon white.
            iconImgEl.style.filter = iconColorToFilter('#ffffff');
        }
        marker.appendChild(iconBox);

        // --- NEW: Mobile/Always-Visible Label ---
        // Added per user request for mobile visibility
        const label = document.createElement('div');
        label.className = 'hotspot-label';
        label.textContent = data.name;
        // Child labels sit on the dark translucent box, so keep text white like other icons.
        label.style.color = '#ffffff';
        marker.appendChild(label);

        // 2. Content Panel (Expandable) -- ONLY for Category Headers
        // The user requested that the "second column items" (children) do NOT have the popup info.
        // "First layer" (Category Headers) gets the style we made (with panel).
        if (data.name === data.category) {
            const panel = document.createElement('div');
            panel.className = 'hotspot-expand-panel';

            // Header Section (Matches Title)
            const panelHeader = document.createElement('div');
            panelHeader.className = 'panel-header-internal';
            const groupIconFile = groupIconMap[markerGroup] || '';
            panelHeader.innerHTML = `
                <h3>${data.name}</h3>
                ${groupIconFile ? `<img src="/images/Icons/${groupIconFile}" class="panel-group-icon" alt="" />` : ''}
            `;
            // Header sits on the theme-coloured background, so title + logo are white.
            panelHeader.style.color = '#ffffff';
            const groupIconEl = panelHeader.querySelector('.panel-group-icon');
            if (groupIconEl) {
                const groupIconColorVal = catColors.groupIconColor || '#ffffff';
                groupIconEl.style.filter = iconColorToFilter(groupIconColorVal);
            }
            panel.appendChild(panelHeader);

            // Details Section (Removed per user request)
            // Child Items Grid (Only if children exist and this is a category header)
            const children = categoryChildren[data.category];
            if (children && children.length > 0) {
                const subGrid = document.createElement('div');
                subGrid.className = 'panel-subicons';

                // Bright/saturated icon colours → use white text
                const isBrightIcon = iconColor && iconColor.startsWith('#') &&
                    (parseInt(iconColor.slice(1,3),16) + parseInt(iconColor.slice(3,5),16) + parseInt(iconColor.slice(5,7),16)) > 200;
                const subTextColor = isBrightIcon ? (catColors.textColor || '#ffffff') : iconColor;

                children.forEach(child => {
                    const subItem = document.createElement('div');
                    subItem.className = 'sub-item';

                    // Get the icon filename for this child
                    const iconPath = child.icon ? `/images/Icons/${child.icon}` : '';

                    subItem.innerHTML = `
                        <div class="sub-icon">${iconPath ? `<img src="${iconPath}" alt="${child.name}">` : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>'}</div>
                        <span class="sub-name">${child.name}</span>
                    `;
                    const subImgEl = subItem.querySelector('.sub-icon img');
                    if (subImgEl) {
                        // Sub-icons match the heading (theme) colour on the light grid.
                        subImgEl.style.filter = iconColorToFilter(themeColor);
                    }
                    const subNameEl = subItem.querySelector('.sub-name');
                    if (subNameEl && subTextColor && subTextColor.startsWith('#')) {
                        const lum = parseInt(subTextColor.slice(1,3),16) + parseInt(subTextColor.slice(3,5),16) + parseInt(subTextColor.slice(5,7),16);
                        if (lum < 200) subNameEl.style.color = subTextColor;
                    }
                    subItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Find the global index of this child
                        const childIndex = hotspotData.indexOf(child);
                        if (childIndex !== -1) {
                            onHotspotClick2D(childIndex);
                        }
                    });
                    subGrid.appendChild(subItem);
                });
                panel.appendChild(subGrid);
            }

            marker.appendChild(panel);
        }

        // Add click handler (Keep existing zoom logic)
        marker.addEventListener('click', (e) => {
            // e.stopPropagation(); // Optional: decide if click passes through
            onHotspotClick2D(index);
        });

        // Restore active state if needed
        if (data.clicked) {
            marker.classList.add('active');
        }

        container.appendChild(marker);
        hotspotElements.push(marker);
    });
}

// Reusable objects for raycasting to avoid garbage collection pauses
const _raycaster = new THREE.Raycaster();
_raycaster.firstHitOnly = true; // Optimization for three-mesh-bvh
const _direction = new THREE.Vector3();
let _raycastFrameCounter = 0;

// Update hotspot positions and visibility based on camera
function updateHotspots() {
    if (!hotspotData.length || !camera) return;

    // Determine which hotspots to check this frame to distribute load
    _raycastFrameCounter++;
    const batchSize = 10; // Check 10 hotspots per frame
    const startIdx = (_raycastFrameCounter * batchSize) % hotspotData.length;

    // --- NEW: Reset Active Hotspot on Zoom Away ---
    // If not animating and distance is far (e.g. > 70), reset active state to return to "Overview"
    if (activeHotspotIndex !== -1 && hotspotData[activeHotspotIndex] && !isAnimating) {
        const activeData = hotspotData[activeHotspotIndex];
        const currentDist = camera.position.distanceTo(activeData.position);

        // Threshold: 300 (Increased to accommodate large camera distances for some categories)
        if (currentDist > 300) {
            activeHotspotIndex = -1;

            // Close info panel if open
            const panel = document.getElementById('info-panel');
            if (panel) panel.classList.remove('active');

            // Close left sidebar if open
            const leftSidebar = document.getElementById('left-sidebar');
            if (leftSidebar) leftSidebar.classList.remove('active');

            // Hide category badge and arrows, restore instructions
            hideCategoryBadge();
            restoreInstructions();

            // Restore nav
            const nav = document.querySelector('.top-nav');
            if (nav) { nav.style.opacity = '1'; nav.style.pointerEvents = 'auto'; }
        }
    }
    // ----------------------------------------------

    // Determine the currently active category (if any)
    let activeCategory = null;
    if (activeHotspotIndex !== -1 && hotspotData[activeHotspotIndex]) {
        activeCategory = hotspotData[activeHotspotIndex].category;
    }

    hotspotData.forEach((data, index) => {
        const marker = hotspotElements[index];
        if (!marker) return;

        // Calculate distance from camera to hotspot
        const distance = camera.position.distanceTo(data.position);

        let shouldBeVisible = false;
        const isChild = data.name !== data.category;

        if (activeCategory) {
            // === A CATEGORY IS ACTIVE ===
            // Only show children of the active category – hide everything else
            if (isChild && data.category === activeCategory && distance <= data.maxZoom) {
                shouldBeVisible = true;
            }
            // All category headers and other categories' children stay hidden
        } else {
            // === NO ACTIVE CATEGORY (overview mode) ===
            if (isChild) {
                // Children only show if their category is active
                shouldBeVisible = false;
            } else {
                // Category Headers: standard distance-based visibility
                if (distance >= data.minZoom && distance <= data.maxZoom) {
                    shouldBeVisible = true;
                }
            }
        }

        // Always hide the currently active/clicked hotspot itself
        if (index === activeHotspotIndex) {
            shouldBeVisible = false;
        }

        if (shouldBeVisible) {
            // Project 3D position to 2D screen space
            const screenPosition = data.position.clone().project(camera);

            // Check if hotspot is behind the camera
            if (screenPosition.z > 1) {
                marker.style.display = 'none';
                return;
            }

            // Convert to pixel coordinates
            const x = (screenPosition.x * 0.5 + 0.5) * sizes.width;
            const y = (screenPosition.y * -0.5 + 0.5) * sizes.height;

            // Position the marker using GPU-accelerated transforms to prevent jitter
            marker.style.left = '0px';
            marker.style.top = '0px';

            if (marker.classList.contains('is-child')) {
                marker.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-50% - 60px))`;
            } else {
                marker.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
            }

            marker.style.display = 'flex';

            // Smart Panel Positioning: open downwards if near top of screen
            if (y < sizes.height * 0.4) {
                marker.classList.add('opens-down');
            } else {
                marker.classList.remove('opens-down');
            }

            // --- Raycast Occlusion Check (Accelerated by BVH) --- DISTRIBUTED
            // Only raycast a subset of hotspots each frame to maintain 60fps, especially during camera transitions
            const isBatchFrame = (index >= startIdx && index < startIdx + batchSize) ||
                (startIdx + batchSize > hotspotData.length && index < (startIdx + batchSize) % hotspotData.length);

            if (isBatchFrame && typeof loadedModel !== 'undefined' && loadedModel) {
                _direction.copy(data.position).sub(camera.position).normalize();
                _raycaster.set(camera.position, _direction);

                // Subtract 2.5 distance units so it doesn't intersect with the geometry the icon is sitting exactly on.
                _raycaster.far = Math.max(0, distance - 2.5);

                const intersects = _raycaster.intersectObject(loadedModel, true);
                if (intersects.length > 0) {
                    marker.classList.add('occluded');
                } else {
                    marker.classList.remove('occluded');
                }
            }

            data.isActive = true;
        } else {
            // Don't hide while the pop animation is running
            if (!marker.dataset.popping) {
                marker.style.display = 'none';
            }
            data.isActive = false;
        }
    });
}

// Handle hotspot clicks
// Handle hotspot clicks
function onHotspotClick2D(index) {
    activeHotspotIndex = index; // Track active index

    // ── Pop animation fires immediately on every click ──
    const clickedMarker = hotspotElements[index];
    if (clickedMarker) {
        const iconBox = clickedMarker.querySelector('.hotspot-icon-box') || clickedMarker;
        clickedMarker.dataset.popping = 'true';
        const anim = iconBox.animate(
            [
                { transform: 'scale(1)' },
                { transform: 'scale(1.5)' },
                { transform: 'scale(1.15)' },
                { transform: 'scale(1.35)' },
                { transform: 'scale(1)' }
            ],
            { duration: 420, easing: 'ease-in-out', fill: 'forwards' }
        );
        anim.onfinish = () => { delete clickedMarker.dataset.popping; };
    }

    if (isAnimating) {
        // Cancel existing tweens and allow new click to proceed
        tweenGroup.removeAll();
        controls.enabled = true;
        controls.enableDamping = true;
        isAnimating = false;
    }

    const data = hotspotData[index];
    const marker = hotspotElements[index];

    // --- NEW: Close other windows/panels ---

    // 1. Close Layout Sidebar if open
    const leftSidebar = document.getElementById('left-sidebar');
    if (leftSidebar) leftSidebar.classList.remove('active');

    // 2. Deactivate all other markers (Closes their expand panels)
    hotspotElements.forEach(el => el.classList.remove('active'));
    hotspotData.forEach(d => d.clicked = false);

    // Determine if this is a Category Header
    const isHeader = data.category === data.name;

    // Mark as clicked/active ONLY if it is NOT a header
    // Headers are just navigation points -> Zoom & Reveal Children, but don't keep their own panel open
    if (!isHeader) {
        data.clicked = true;
        marker.classList.add('active');
    }

    // Zoom to hotspot
    controls.enabled = false;
    controls.enableDamping = false;
    isAnimating = true;

    // Distance: Headers zoom to 40 (inside 0-60 range, so Headers hide, Items show)
    // Items zoom to 30 (close up)
    const zoomDistance = isHeader ? 40 : 30;

    // Use fixedCameraPos if available (Precise Angle), otherwise standard distance logic
    const zoomTarget = data.fixedCameraPos ? data.fixedCameraPos : zoomDistance;

    // Use fixedTargetPos if available (Precise LookAt), otherwise Center of Hotspot
    const lookAtTarget = data.fixedTargetPos ? data.fixedTargetPos : data.position;

    zoomToTarget2(lookAtTarget, zoomTarget, () => {
        if (isHeader) {
            // Hide panel if open (Headers don't show panel, they just zoom to reveal children)
            const panel = document.getElementById('info-panel');
            if (panel) panel.classList.remove('active');

            // Show category bar in navbar
            showNavCategoryBar(data);

            // Make sure nav is visible
            const nav = document.querySelector('.top-nav');
            if (nav) {
                nav.style.transition = 'opacity 0.5s';
                nav.style.opacity = '1';
                nav.style.pointerEvents = 'auto';
            }
        } else {
            // After zoom, show related info panel
            showInfoPanel(data);

            // Hide category badge and arrows (bar stays visible with home btn)
            hideCategoryBadge();

            // Hide Top Nav
            const nav = document.querySelector('.top-nav');
            if (nav) {
                nav.style.transition = 'opacity 0.5s';
                nav.style.opacity = '0';
                nav.style.pointerEvents = 'none';
            }
        }
    });
}

// Side-panel images are served as WebP. The CSV may still list a .jpg/.png
// filename, so swap the extension to .webp here (keeps the CSV workflow intact).
function panelImagePath(imageFile) {
    if (!imageFile) return '';
    return `/images/SidePanelImages/${imageFile.replace(/\.[^./]+$/, '.webp')}`;
}

// Show info panel for hotspot
function showInfoPanel(data) {
    const panel = document.getElementById('info-panel');

    if (!panel) return;

    // Apply category colour to panel
    const catColors = categoryColorMap[data.categoryKey] || {};
    const panelColor = data.color || catColors.color || '#0690ce';
    // Panel background is the theme colour, so keep all panel text white.
    const panelTextColor = '#ffffff';
    panel.style.background = panelColor;
    panel.style.setProperty('--panel-text', panelTextColor);

    // Get icon path
    const iconPath = data.icon ? `/images/Icons/${data.icon}` : '';

    // Get image path (WebP)
    const imagePath = panelImagePath(data.image);

    // Build the new panel HTML
    panel.innerHTML = `
        ${iconPath ? `<div class="panel-floating-icon"><img src="${iconPath}" alt="${data.name}"></div>` : ''}
        
        <div class="panel-scroll-view">
            <div class="panel-header">
                <div class="panel-title-section">
                    <div class="panel-title-text">
                        <h2>${data.name}</h2>
                    </div>
                </div>
                <button id="close-panel" class="close-button">&times;</button>
            </div>
            
            <div class="panel-content">
                <div class="panel-image-container">
                    <img 
                        src="${imagePath || '/images/SidePanelImages/coming-soon.png'}" 
                        alt="${data.name}" 
                        class="panel-image"
                        onerror="this.onerror=null; this.src='/images/SidePanelImages/coming-soon.png';"
                    >
                </div>
                
                <div class="panel-section">
                    <h3>Product Description</h3>
                    <p>${data.description}</p>
                </div>
                
                <div class="panel-bottom-section">
                    ${(data.button1Url && data.button1Url !== '#' && /^https?:\/\//i.test(data.button1Url)) ? `
                        ${(data.phone || data.email) ? `<div class="contact-info">
                            ${data.phone ? `<p><strong>Tel:</strong> ${data.phone}</p>` : ''}
                            ${data.email ? `<p><strong>Email:</strong> ${data.email}</p>` : ''}
                        </div>` : ''}
                        <button class="action-button primary" id="learn-more-btn">Find Out More</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Apply icon colour to floating panel icon — client wants every side-panel icon black.
    const floatingIconImg = panel.querySelector('.panel-floating-icon img');
    if (floatingIconImg) {
        floatingIconImg.style.filter = iconColorToFilter('black');
    }

    // Fade the panel image in once it has actually loaded. Preloaded (cached)
    // images are already complete, so they show instantly with no flash.
    const panelImg = panel.querySelector('.panel-image');
    if (panelImg) {
        if (panelImg.complete && panelImg.naturalWidth > 0) {
            panelImg.classList.add('loaded');
        } else {
            panelImg.addEventListener('load', () => panelImg.classList.add('loaded'), { once: true });
        }
    }

    // Re-attach event listeners
    const closeBtn = panel.querySelector('#close-panel');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('active');

            // Navigate back to parent category header
            const currentData = hotspotData[activeHotspotIndex];
            if (currentData) {
                const categoryKey = currentData.categoryKey;
                // Find the category header (where name === category) for this hotspot's category
                const categoryHeaderIndex = hotspotData.findIndex(
                    d => d.name === d.category && d.categoryKey === categoryKey
                );
                if (categoryHeaderIndex !== -1) {
                    onHotspotClick2D(categoryHeaderIndex);
                    return; // onHotspotClick2D restores the nav
                }
            }

            // Fallback: just restore nav if no category found
            const nav = document.querySelector('.top-nav');
            if (nav) {
                nav.style.opacity = '1';
                nav.style.pointerEvents = 'auto';
            }
        });
    }

    // Button event listeners
    const learnMoreBtn = panel.querySelector('#learn-more-btn');
    const contactUsBtn = panel.querySelector('#contact-us-btn');

    if (learnMoreBtn && data.button1Url) {
        learnMoreBtn.addEventListener('click', () => navigateTo(data.button1Url));
    }

    if (contactUsBtn && data.button2Url) {
        contactUsBtn.addEventListener('click', () => navigateTo(data.button2Url));
    }

    panel.classList.add('active');
}

// ===================================================
// Nav Category Bar: show/hide badge + arrows
// ===================================================
let navArrowsWired = false;

function hideCategoryBadge() {
    const row = document.getElementById('nav-category-row');
    const homeBtn = document.getElementById('nav-home-btn');
    if (row) row.style.display = 'none';
    if (homeBtn) homeBtn.style.display = 'none';
}

function restoreInstructions() {
    const dialog = document.getElementById('instructions-dialog');
    const toggleBtn = document.getElementById('instructions-toggle');
    if (dialog) dialog.classList.add('hidden');
    if (toggleBtn) toggleBtn.classList.add('visible');
}

function showNavCategoryBar(data) {
    const row = document.getElementById('nav-category-row');
    const badgeIcon = document.getElementById('nav-category-icon');
    const badgeName = document.getElementById('nav-category-name');

    if (!row || !badgeIcon || !badgeName) return;

    // Populate badge content
    badgeIcon.src = data.icon ? `/images/Icons/${data.icon}` : '';
    badgeIcon.style.display = data.icon ? 'inline-block' : 'none';
    badgeName.textContent = data.name;

    // Apply category colour to nav badge
    const catColors = categoryColorMap[data.categoryKey] || {};
    const badgeColor = data.color || catColors.color || '#0690ce';
    const iconColor = data.iconColor || catColors.iconColor || 'white';
    row.style.setProperty('--theme-color', badgeColor);
    badgeIcon.style.filter = iconColorToFilter(iconColor);

    // Add category as data attribute for specific styling (like centering fixes)
    row.dataset.category = data.categoryKey;

    // Show the category row and home button
    row.style.display = 'flex';
    const homeBtn = document.getElementById('nav-home-btn');
    if (homeBtn) homeBtn.style.display = 'flex';

    // Hide instructions dialog when in category view, but keep ? button visible
    const dialog = document.getElementById('instructions-dialog');
    const toggleBtn = document.getElementById('instructions-toggle');
    if (dialog) dialog.classList.add('hidden');
    if (toggleBtn) toggleBtn.classList.add('visible');

    // Wire up arrows once
    if (!navArrowsWired) {
        navArrowsWired = true;

        const prevBtn = document.getElementById('nav-cat-prev');
        const nextBtn = document.getElementById('nav-cat-next');

        function navigateCategory(direction) {
            const categoryIndices = hotspotData
                .map((d, i) => ({ d, i }))
                .filter(({ d }) => d.category === d.name)
                .map(({ i }) => i);

            if (categoryIndices.length === 0) return;

            const currentPos = categoryIndices.indexOf(activeHotspotIndex);
            let nextPos = currentPos + direction;

            if (nextPos < 0) nextPos = categoryIndices.length - 1;
            if (nextPos >= categoryIndices.length) nextPos = 0;

            onHotspotClick2D(categoryIndices[nextPos]);
        }

        if (prevBtn) prevBtn.addEventListener('click', () => navigateCategory(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => navigateCategory(1));
    }
}

// Updated zoom function for vector positions
function zoomToTarget2(targetPosition, distanceOrCamPos = 60, onComplete = null) {
    // Cancel any existing tweens to prevent conflicts with new animation
    tweenGroup.removeAll();

    let newCameraPosition;

    // Check if second argument is a Vector3 (Specific Camera Position)
    if (distanceOrCamPos instanceof THREE.Vector3) {
        newCameraPosition = distanceOrCamPos.clone();
    } else {
        // Standard Behavior: Back up from target
        const distance = distanceOrCamPos;
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);

        newCameraPosition = new THREE.Vector3().addVectors(
            targetPosition,
            cameraDirection.multiplyScalar(-distance)
        );
    }

    // SLOW ANIMATION: 2000ms
    const duration = 2000;

    new Tween(camera.position, tweenGroup)
        .to(newCameraPosition, duration)
        .easing(Easing.Cubic.InOut)
        .start();

    new Tween(controls.target, tweenGroup)
        .to(targetPosition, duration)
        .easing(Easing.Cubic.InOut)
        .onComplete(() => {
            controls.enabled = true;
            controls.enableDamping = true;
            isAnimating = false;
            if (onComplete) onComplete();
        })
        .start();

    // Safety timeout: if tweens fail to complete, reset isAnimating after duration + buffer
    setTimeout(() => {
        if (isAnimating) {
            console.warn('Safety reset: isAnimating was still true after expected duration');
            controls.enabled = true;
            controls.enableDamping = true;
            isAnimating = false;
            if (onComplete) onComplete();
        }
    }, duration + 500);
}

// Initialize hotspots after loading CSV
loadHotspotCSV();

// ===================================================
// END: Hotspot CSV Loading and Management
// ===================================================

// Preload all side-panel images into the browser cache so they appear instantly
// when a hotspot is opened (instead of being fetched on first open). Called after
// the model loads so it doesn't compete with the main model download.
let panelImagesPreloaded = false;
function preloadPanelImages() {
    if (panelImagesPreloaded || !hotspotData.length) return;
    panelImagesPreloaded = true;
    const seen = new Set();
    hotspotData.forEach(d => {
        if (d.image && !seen.has(d.image)) {
            seen.add(d.image);
            const img = new Image();
            img.src = panelImagePath(d.image);
        }
    });
    // Also cache the fallback used when an image is missing.
    new Image().src = '/images/SidePanelImages/coming-soon.png';
}


gltfLoader.load(
    '/models/glb/NAMIR_Interactive_CutawayMine_3JS_1.0.3f_draco.glb',
    (gltf) => {
        // Hide Loading Overlay
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('fade-out');
            setTimeout(() => {
                loadingOverlay.style.display = 'none';
            }, 500); // Remove from DOM after fade
        }

        gltf.scene.traverse((child) => {
            if (child.isMesh) {
                // Enable shadows for model
                child.castShadow = true;
                child.receiveShadow = true;

                // Reduce shininess
                if (child.material) {
                    child.material.roughness = 1;
                    child.material.metalness = 0;
                }

                // Move ST Mesh forward by 6 units
                if (child.name.toLowerCase().includes('st mesh') || child.name.toLowerCase() === 'st') {
                    child.position.z += 6;
                }

                // Move Woven Mesh left by 6 units
                if (child.name.toLowerCase().includes('woven mesh')) {
                    child.position.x -= 6;
                }

                // NEW: Compute bounds tree for much faster raycasting
                if (child.geometry) {
                    child.geometry.computeBoundsTree();
                }
            }
            
            // Capture Shotcrete Spray Track Location for particle effect (might not be a mesh)
            if (child.name.toLowerCase().includes('shotcrete_spraytracklocation')) {
                sprayTrackLocation = child;
            }
        });
        scene.add(gltf.scene);
        loadedModel = gltf.scene;

        // Model is in; warm the side-panel image cache so panels open instantly.
        preloadPanelImages();

        // Animation Mixer
        mixer = new THREE.AnimationMixer(gltf.scene);
        const animations = gltf.animations || [];

        if (animations.length > 0) {
            animations.forEach((clip) => {
                mixer.clipAction(clip).play();
            });
        }
    },
    (progress) => {
        // Update Loading Text
        // Clamp to 99% — Three.js GLTFLoader can report loaded > total due to estimate drift
        if (progress.total > 0) {
            const rawPercent = Math.round((progress.loaded / progress.total) * 100);
            const percent = Math.min(rawPercent, 99);
            const loadingText = document.getElementById('loading-text');
            if (loadingText) loadingText.textContent = `Loading Model... ${percent}%`;
        }
    },
    (error) => { console.error('GLTF LOADER FAILED:', error) }
);



/**
 * Raycasting and Interaction
 */
let loadedModel = null;
let mixer = null;
const tweenGroup = new Group()

// --- Particle System for Spray ---
let sprayParticles = null;
let sprayTrackLocation = null;
const sprayParticleCount = 4000; // Increased density for a solid stream
const sprayPositions = new Float32Array(sprayParticleCount * 3);
const sprayVelocities = [];
const sprayLifetimes = new Float32Array(sprayParticleCount);

const sprayGeometry = new THREE.BufferGeometry();
for(let i=0; i<sprayParticleCount; i++) {
    // start hidden far away
    sprayPositions[i*3] = 0;
    sprayPositions[i*3+1] = -9999;
    sprayPositions[i*3+2] = 0;
    sprayVelocities.push(new THREE.Vector3());
    sprayLifetimes[i] = Math.random(); // staggered start
}
sprayGeometry.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));

// Create a simple circular texture for softer particles
const canvas2d = document.createElement('canvas');
canvas2d.width = 32;
canvas2d.height = 32;
const context2d = canvas2d.getContext('2d');
const gradient = context2d.createRadialGradient(16, 16, 0, 16, 16, 16);
gradient.addColorStop(0, 'rgba(255,255,255,1)');
gradient.addColorStop(1, 'rgba(255,255,255,0)');
context2d.fillStyle = gradient;
context2d.fillRect(0, 0, 32, 32);
const particleTexture = new THREE.CanvasTexture(canvas2d);

const sprayMaterial = new THREE.PointsMaterial({
    color: 0xcccccc, // lighter grey
    size: 0.6, // smaller particles
    map: particleTexture,
    transparent: true,
    opacity: 0.6, // softer opacity
    depthWrite: false,
    blending: THREE.NormalBlending
});

sprayParticles = new THREE.Points(sprayGeometry, sprayMaterial);
sprayParticles.frustumCulled = false; // Prevent it from disappearing when the origin is off-screen
scene.add(sprayParticles);
// ---------------------------------

// Hamburger Menu Logic
const hamburgerBtn = document.getElementById('hamburger-btn');
const leftSidebar = document.getElementById('left-sidebar');
const closeLeftSidebarBtn = document.getElementById('close-left-sidebar');

// Home / Reset View Button
const navHomeBtn = document.getElementById('nav-home-btn');
if (navHomeBtn) {
    navHomeBtn.addEventListener('click', () => {
        // Immediately clear nav before animation starts
        const navRow = document.getElementById('nav-category-row');
        if (navRow) navRow.style.display = 'none';
        navHomeBtn.style.display = 'none';
        resetView();
    });
}

function initBrandLogo() {
    const logoEl = document.querySelector('.sidebar-logo');
    if (!logoEl) return;
    const brand = new URLSearchParams(window.location.search).get('brand') || 'mekhlopat';
    if (brand === 'kemex') {
        logoEl.src = '/images/logos/kemex_logo1.webp';
    } else {
        logoEl.src = '/images/logos/Namir_Mekhlopat_logo_03.webp';
    }
}
initBrandLogo();

function setSidebarOverlayHidden(hidden) {
    const navBar = document.getElementById('nav-category-bar');
    const navHome = document.getElementById('nav-home-btn');
    const instrDialog = document.getElementById('instructions-dialog');
    const instrToggle = document.getElementById('instructions-toggle');
    const burger = document.getElementById('hamburger-btn');
    const vis = hidden ? 'hidden' : '';
    if (navBar) navBar.style.visibility = vis;
    if (navHome) navHome.style.visibility = vis;
    if (instrDialog) instrDialog.style.visibility = vis;
    if (instrToggle) instrToggle.style.visibility = vis;
    if (burger) burger.style.visibility = vis;
}

const sidebarBackdrop = document.getElementById('sidebar-backdrop');

if (hamburgerBtn && leftSidebar) {
    hamburgerBtn.addEventListener('click', () => {
        const opening = !leftSidebar.classList.contains('active');
        leftSidebar.classList.toggle('active');
        setSidebarOverlayHidden(opening);
    });
}

if (closeLeftSidebarBtn && leftSidebar) {
    closeLeftSidebarBtn.addEventListener('click', () => {
        leftSidebar.classList.remove('active');
        setSidebarOverlayHidden(false);
    });
}

if (sidebarBackdrop && leftSidebar) {
    sidebarBackdrop.addEventListener('click', () => {
        leftSidebar.classList.remove('active');
        setSidebarOverlayHidden(false);
    });
}

// Close Panel Logic
let isPanelManuallyClosed = false; // Track if user explicitly closed it

const closePanelBtn = document.getElementById('close-panel');
if (closePanelBtn) {
    closePanelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('info-panel').classList.remove('active');
        isPanelManuallyClosed = true;

        // Restore Nav
        const nav = document.querySelector('.top-nav');
        if (nav) {
            nav.style.opacity = '1';
            nav.style.pointerEvents = 'auto';
        }
    });
}

/**
 * Lights
 */
const directionalLight = new THREE.DirectionalLight(0xffffff, 3); // Stronger light for deeper shadows
directionalLight.position.set(50, 200, 100);
directionalLight.castShadow = true;
// Optimize shadow map
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.bias = -0.0005; // Slightly deeper bias
directionalLight.shadow.normalBias = 0.02; // Prevents shadow acne on slanted surfaces
// Adjust shadow camera frustum to cover the scene
const d = 200;
directionalLight.shadow.camera.left = -d;
directionalLight.shadow.camera.right = d;
directionalLight.shadow.camera.top = d;
directionalLight.shadow.camera.bottom = -d;

scene.add(directionalLight);

// Optional: Add a helper to see shadow volume (comment out in prod)
// const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
// scene.add(shadowHelper);

const light = new THREE.PointLight(0xffffff, 0.3, 10);
light.position.set(50, 100, 100);
const light2 = new THREE.PointLight(0xffffff, 1.5, 100); // Reduced fill light
light2.position.set(50, 100, 100);
scene.add(light);
scene.add(light2);

const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0xB8860B, 0.1); // significantly darker shadows
scene.add(hemisphereLight);

/**
 * Animation Functions
 */
function zoomToTarget(target, distance = 60, onComplete = null) {
    // Cancel any existing tweens to prevent conflicts
    tweenGroup.removeAll();

    const targetPosition = new THREE.Vector3();
    target.getWorldPosition(targetPosition);

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    // Offset the camera *back* from the target
    const newCameraPosition = new THREE.Vector3().addVectors(
        targetPosition,
        cameraDirection.multiplyScalar(-distance) // Use negative scalar to move back
    );

    new Tween(camera.position, tweenGroup)
        .to(newCameraPosition, 1000)
        .easing(Easing.Quadratic.InOut)
        .start();

    new Tween(controls.target, tweenGroup)
        .to(targetPosition, 1000)
        .easing(Easing.Quadratic.InOut)
        .onComplete(() => {
            controls.enabled = true;
            controls.enableDamping = true;
            isAnimating = false;
            // Execute callback if provided
            if (onComplete) onComplete();
        })
        .start();
}

// --- NEW FUNCTION: Check URL hash on startup ---
function checkUrlHashAndZoom() {
    // Only run if the model is loaded and hotspots exist
    if (hotspots.length === 0 || !loadedModel) return;

    const hash = window.location.hash.substring(1); // Get hash without '#'
    if (hash) {
        // Find the hotspot group matching the hash name
        const targetGroup = hotspots.find(group => group.name === hash);

        if (targetGroup) {
            // Disable controls temporarily
            controls.enabled = false;
            controls.enableDamping = false;
            isAnimating = true;

            zoomToTarget(targetGroup);

            // Note: We intentionally DO NOT hide the other hotspots on load
        }
    }
}
// --- END NEW FUNCTION ---

/**
 * Animate
 */
const clock = new THREE.Clock()

// ===================================================
// UPDATED TICK FUNCTION - Now updates line connectors
// ===================================================
// Function to reset view (moved outside tick)
function resetView() {
    isAnimating = true;
    controls.enabled = false;

    // Cancel any existing tweens to prevent conflicts
    tweenGroup.removeAll();

    // Exact starting camera position (matches initial camera.position set at scene load)
    const defaultCamPos = new THREE.Vector3(-233.27, 139.96, 233.27);
    const defaultTarget = new THREE.Vector3(0, 0, 0);

    // Reset Hotspot States
    activeHotspotIndex = -1;
    hotspotData.forEach(d => d.clicked = false);
    hotspotElements.forEach(el => el.classList.remove('active'));

    // Close info panel if open
    const panel = document.getElementById('info-panel');
    if (panel) panel.classList.remove('active');

    // Close left sidebar if open
    const leftSidebar = document.getElementById('left-sidebar');
    if (leftSidebar) leftSidebar.classList.remove('active');

    // Restore Nav
    const nav = document.querySelector('.top-nav');
    if (nav) {
        nav.style.opacity = '1';
        nav.style.pointerEvents = 'auto';
    }

    // Hide category badge and arrows, restore instructions
    hideCategoryBadge();
    restoreInstructions();

    new Tween(camera.position, tweenGroup)
        .to(defaultCamPos, 1500)
        .easing(Easing.Quadratic.InOut)
        .start();

    new Tween(controls.target, tweenGroup)
        .to(defaultTarget, 1500)
        .easing(Easing.Quadratic.InOut)
        .onComplete(() => {
            controls.enabled = true;
            controls.enableDamping = true;
            isAnimating = false;
        })
        .start();
}

// Back Button Listener
const backButton = document.getElementById('back-button');
if (backButton) {
    backButton.addEventListener('click', () => {
        resetView();
    });
}

// Sensitivity Slider Logic
const sensitivitySlider = document.getElementById('sensitivity-slider');
if (sensitivitySlider) {
    sensitivitySlider.addEventListener('input', (e) => {
        const multiplier = parseFloat(e.target.value);
        if (controls) {
            // Treat the default 0.4 as our baseline (multiplier of 1)
            const newSpeed = 0.4 * multiplier;
            controls.rotateSpeed = newSpeed;
            controls.zoomSpeed = newSpeed;
            controls.panSpeed = newSpeed;
        }
    });
}

// Expose resetView globally so the instructions dialog can call it
window.resetView = resetView;

// ===================================================
// UPDATED TICK FUNCTION
// ===================================================
const tick = () => {
    const delta = clock.getDelta()
    const elapsedTime = clock.getElapsedTime()

    if (mixer) {
        mixer.update(delta)
    }

    tweenGroup.update()

    if (isAnimating === false) {
        controls.update()
    } else {
        camera.lookAt(controls.target)
    }

    // --- Update Spray Particles ---
    if (sprayParticles && sprayTrackLocation) {
        const emitterPos = new THREE.Vector3();
        sprayTrackLocation.getWorldPosition(emitterPos);
        
        // Shoot at 90 degrees (local X axis). If it's the wrong wall, change to (-1, 0, 0)
        const dir = new THREE.Vector3(1, 0, 0);
        dir.transformDirection(sprayTrackLocation.matrixWorld).normalize();
        
        const positions = sprayParticles.geometry.attributes.position.array;
        
        for(let i=0; i<sprayParticleCount; i++) {
            sprayLifetimes[i] += delta * 8.0; // Life duration - kills particles much earlier so they don't go too far
            
            if (sprayLifetimes[i] >= 1.0) {
                // Reset life with slight randomness to prevent phase alignment
                sprayLifetimes[i] = Math.random() * 0.1;
                
                // Spray velocity: fan out like a cone
                const speed = 70 + Math.random() * 10; 
                const spread = 35; // Even more spread for a wider fanned out cone
                sprayVelocities[i].set(
                    dir.x * speed + (Math.random() - 0.5) * spread,
                    dir.y * speed + (Math.random() - 0.5) * spread,
                    dir.z * speed + (Math.random() - 0.5) * spread
                );

                // INTER-FRAME INTERPOLATION: 
                // Because particles move ~1.2 meters per frame, spawning them all at the exact emitterPos
                // causes visible "clumps" or gaps. We offset them randomly along their velocity vector 
                // for this frame to create a perfectly continuous, gapless stream.
                const timeOffset = Math.random() * delta;
                
                positions[i*3] = emitterPos.x + (sprayVelocities[i].x * timeOffset) + (Math.random() - 0.5) * 0.2;
                positions[i*3+1] = emitterPos.y + (sprayVelocities[i].y * timeOffset) + (Math.random() - 0.5) * 0.2;
                positions[i*3+2] = emitterPos.z + (sprayVelocities[i].z * timeOffset) + (Math.random() - 0.5) * 0.2;
                
            } else {
                // Move
                positions[i*3] += sprayVelocities[i].x * delta;
                positions[i*3+1] += sprayVelocities[i].y * delta;
                positions[i*3+2] += sprayVelocities[i].z * delta;
                
                // If late in life, simulate "splatter" by slowing horizontal speed and dropping
                if (sprayLifetimes[i] > 0.8) {
                    sprayVelocities[i].x *= 0.8;
                    sprayVelocities[i].z *= 0.8;
                    sprayVelocities[i].y -= 80 * delta; // slide down wall aggressively
                } else {
                    sprayVelocities[i].y -= 15 * delta; // normal gravity arc
                }
            }
        }
        sprayParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Update 2D HTML hotspot positions and visibility
    updateHotspots();

    renderer.render(scene, camera)
    window.requestAnimationFrame(tick)
}
// ===================================================

tick()

/**
 * Resize Listener
 */
window.addEventListener('resize', () => {
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})
