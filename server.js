const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware to parse JSON for sensor simulation
app.use(express.json());

// Serve built static files (Vite build output)
// In dev, use 'npm run dev'. In prod/Pi, use 'npm run build' then 'npm start'
app.use(express.static(path.join(__dirname, 'dist')));
// Also serve public assets directly if needed
app.use(express.static(path.join(__dirname, 'public')));

// --- State & Simulation ---
let flightMode = false; // false = Circadian, true = Interactive
let currentLocationIndex = 0;

// Mock locations
const LOCATIONS = [
    { name: "New York", lat: 40.7128, lon: -74.0060 },
    { name: "London", lat: 51.5074, lon: -0.1278 },
    { name: "Tokyo", lat: 35.6762, lon: 139.6503 }
];

// Flight Simulation Data
let flightData = {
    lat: 40.7128,
    lon: -74.0060,
    altitude: 10000, // meters
    heading: 90,
    weather: {
        cloudsAll: 50,     // 0-100
        rain1h: 0,         // mm
        windSpeed: 10,     // m/s
        windDeg: 45,
        main: "Clear"
    }
};

// --- Sensor Endpoint ---
app.post('/sensor', (req, res) => {
    const { state } = req.body; // { "state": "open" | "closed" }
    console.log(`[SENSOR] Blind state: ${state}`);
    
    io.emit('blind', state);
    
    // Logic: If closed, maybe switch location or reset simulation?
    // For prototype: 'closed' event triggers scene change in client,
    // but we can also change server state here.
    if(state === 'closed') {
        currentLocationIndex = (currentLocationIndex + 1) % LOCATIONS.length;
        // Reset flight pos to new location
        flightData.lat = LOCATIONS[currentLocationIndex].lat;
        flightData.lon = LOCATIONS[currentLocationIndex].lon;
    }

    res.json({ status: 'ok', received: state });
});

// --- Simulation Loop ---
setInterval(() => {
    if (flightMode) {
        // Move plane simply
        flightData.lon += 0.01; 
        flightData.lat += Math.sin(Date.now() / 10000) * 0.005;
        flightData.heading = (flightData.heading + 0.1) % 360;
        
        // Oscillate weather for demo
        flightData.weather.cloudsAll = 50 + Math.sin(Date.now() / 5000) * 40;
        flightData.weather.windSpeed = 10 + Math.cos(Date.now() / 8000) * 5;
    }

    io.emit('flight:update', {
        ...flightData,
        locationName: LOCATIONS[currentLocationIndex].name,
        timestamp: Date.now()
    });
}, 1000); // 1Hz update

io.on('connection', (socket) => {
    console.log('Client connected');
    socket.emit('flight:update', flightData); // Initial data
    
    socket.on('mode:toggle', (mode) => {
        flightMode = mode === 'interactive';
        console.log(`Mode switched to: ${flightMode ? 'Interactive' : 'Circadian'}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
