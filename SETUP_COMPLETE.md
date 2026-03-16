# Aircraft Window Prototype - Setup Complete ✅

## Project Structure Created:
```
aircraft-window-proto/
├── package.json                ✅ Dependencies installed
├── vite.config.js              ✅ Vite configuration
├── server.js                   ✅ Express + Socket.io server
├── README.md                   ✅ Documentation
├── index.html                  ✅ Main HTML with UI
├── dist/                       ✅ Built production files
│   ├── index.html
│   └── assets/
│       └── README.txt
├── public/
│   └── assets/
│       └── README.txt          ✅ Asset placeholder
├── scripts/
│   └── simulate_sensor.bat     ✅ Sensor test script
└── src/
    ├── main.js                 ✅ Main application logic
    ├── scene.js                ✅ Three.js scene setup
    ├── weather.js              ✅ Weather mapping
    └── shaders.js              ✅ Cloud shaders
```

## Next Steps:

### 1. Install Dependencies ✅ (Already Done)
```bash
npm install
```

### 2. Build the Project ✅ (Already Done)
```bash
npm run build
```

### 3. Run the Server
```bash
npm start
```
Then open http://localhost:3000 in your browser

### 4. Optional: Add Assets
To get the full visual experience, add these files to `public/assets/`:
- `window_frame.png` (1280x720 with transparent center)
- `wing.png` (aircraft wing view)

The application will run without these assets, but won't show the window frame or wing overlay.

## Features:
- ✅ Two modes: Circadian (local time) and Interactive (flight simulation)
- ✅ Real-time weather visualization with custom shaders
- ✅ WebSocket communication for flight data
- ✅ Sensor endpoint for blind simulation
- ✅ Responsive UI with controls
- ✅ Time shifting functionality
- ✅ Night/day cycle with stars
- ✅ Cloud animation based on wind speed

## Testing:
- Use the "Simulate Blind Closed" button or run:
  ```bash
  scripts\simulate_sensor.bat
  ```
- Toggle between modes using the "Toggle Mode" button
- Adjust time using the slider

The project is ready to run! 🚁✈️
