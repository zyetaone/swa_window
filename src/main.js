import { WindowScene } from './scene.js';
import { mapWeatherToVisuals } from './weather.js';
import SunCalc from 'suncalc';
import { io } from "socket.io-client";

const socket = io();
const scene = new WindowScene(document.getElementById('canvas-container'));

// State
let mode = 'circadian'; // 'circadian' | 'interactive'
let timeOffset = 0;
let currentData = {
    lat: 40.7128,
    lon: -74.0060,
    heading: 0,
    weather: { cloudsAll: 20, rain1h: 0, windSpeed: 5, main: 'Clear' }
};

// UI Elements
const elMode = document.getElementById('mode-display');
const elLoc = document.getElementById('loc-display');
const elTime = document.getElementById('time-display');
const elSunAlt = document.getElementById('sun-alt');
const elClouds = document.getElementById('cloud-val');
const elWind = document.getElementById('wind-val');
const elFlightIcon = document.getElementById('flight-icon');

// --- Socket Listeners ---
socket.on('flight:update', (data) => {
    currentData = data;
    if (mode === 'interactive') {
        updateScene();
    }
});

socket.on('blind', (state) => {
    if (state === 'closed') {
        // Effect: Brief blackout or scene change
        document.body.style.backgroundColor = '#000';
        document.getElementById('canvas-container').style.opacity = '0';
        setTimeout(() => {
             document.getElementById('canvas-container').style.opacity = '1';
             // In a real app, we might cycle the destination here
             console.log("Blind event triggered scene refresh");
        }, 1000);
    }
});

// --- Controls ---
document.getElementById('btn-simulate-blind').addEventListener('click', () => {
    fetch('/sensor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed' })
    });
});

document.getElementById('btn-toggle-mode').addEventListener('click', () => {
    mode = mode === 'circadian' ? 'interactive' : 'circadian';
    elMode.innerText = mode === 'interactive' ? 'Interactive (Flight)' : 'Circadian (Local)';
    elFlightIcon.classList.toggle('hidden', mode !== 'interactive');
    socket.emit('mode:toggle', mode);
});

document.getElementById('time-slider').addEventListener('input', (e) => {
    timeOffset = parseFloat(e.target.value);
});

// --- Main Loop ---
const clock = new THREE.Clock();

function updateScene() {
    // 1. Determine Time
    let date = new Date();
    if (mode === 'circadian') {
        date.setHours(date.getHours() + timeOffset);
    } else {
        // In flight mode, use server timestamp or simulated time
        // For visual demo, we just stick to local time + offset or specific flight time
        date.setHours(date.getHours() + timeOffset); 
    }

    // 2. Calculate Sun Position
    // SunCalc returns radians. Three.js Sky needs azimuth/elevation (degrees usually easiest)
    const sunPos = SunCalc.getPosition(date, currentData.lat, currentData.lon);
    const elevation = (sunPos.altitude * 180 / Math.PI);
    const azimuth = (sunPos.azimuth * 180 / Math.PI) + 180;

    // 3. Weather Mapping
    const visuals = mapWeatherToVisuals(currentData.weather, sunPos.altitude);

    // 4. Update Scene Components
    scene.updateSun(azimuth, elevation, visuals);
    scene.updateClouds(visuals, clock.getDelta());

    // 5. Update UI
    elLoc.innerText = `${currentData.lat.toFixed(2)}, ${currentData.lon.toFixed(2)}`;
    elTime.innerText = date.toLocaleTimeString();
    elSunAlt.innerText = elevation.toFixed(1);
    elClouds.innerText = currentData.weather.cloudsAll;
    elWind.innerText = currentData.weather.windSpeed.toFixed(1);
}

function animate() {
    requestAnimationFrame(animate);
    
    // Circadian mode updates continuously based on clock
    // Interactive mode updates usually on socket event, but we animate frames here
    if(mode === 'circadian') {
        // In circadian, we might fetch real weather if we had an API key
        // For prototype, static default weather is fine
        updateScene();
    } else {
        // Ensure animations run
        scene.updateClouds(mapWeatherToVisuals(currentData.weather, 0), clock.getDelta());
    }
    
    scene.render();
}

animate();
