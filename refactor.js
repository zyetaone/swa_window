const fs = require('fs');

let content = fs.readFileSync('src/routes/playground/+page.svelte', 'utf8');

// 1. Remove state variable definitions that are now in PlaygroundState
const statesToRemove = [
    'activeLocation', 'timeOfDay', 'weather', 'maplibreSource',
    'density', 'cloudSpeed', 'heading', 'planeSpeed', 'altitude',
    'autoOrbit', 'autoTime', 'autoFly', 'turbulenceLevel',
    'mlTerrain', 'mlBuildings', 'mlAtmosphere',
    'paletteName', 'freeCam', 'showCityLights', 'showThreeBillboards', 'showLandmarks', 'useRealisticClouds',
    'lodMaxZoomLevels', 'lodTileCountRatio'
];

statesToRemove.forEach(state => {
    let re = new RegExp(`\\n\\s*let ${state}(\\s*:\\s*[\\w<>|]+)?\\s*=\\s*\\$state[<\\w\\s|>\\[\\]]*\\(.*?\\);`, 'g');
    content = content.replace(re, '');
});

// 2. Add imports
content = content.replace(
    "import 'maplibre-gl/dist/maplibre-gl.css';",
    `import 'maplibre-gl/dist/maplibre-gl.css';\n\timport { pg } from './lib/playground-state.svelte';\n\timport PlaygroundHud from './components/PlaygroundHud.svelte';\n\timport PlaygroundDrawer from './components/PlaygroundDrawer.svelte';`
);

// 3. Replace all usages of these variables with pg.<variable>
statesToRemove.forEach(state => {
    // Replace standalone variables in script and template (word boundary)
    // Careful not to replace object properties like loc.id (so we use \b(?<!\.)variable\b)
    let re = new RegExp(`\\b(?<!\\.)${state}\\b`, 'g');
    content = content.replace(re, `pg.${state}`);
});

// 4. Remove HUD and Drawer HTML blocks
content = content.replace(/<!-- HUD chips.*?<\/div>/s, '<PlaygroundHud {isBoosting} />');
content = content.replace(/<!-- Drawer toggle.*?<\/aside>/s, '<PlaygroundDrawer bind:drawerOpen />');
content = content.replace(/<!-- Settings drawer.*?<\/aside>/s, ''); // just in case

// 5. Remove HUD and Drawer CSS
// We can just keep the CSS as it is, Svelte will tree-shake unused CSS!
// But just to be clean, we can try to strip it. I'll leave the CSS since it's harmless and gets purged.

// 6. Fix any accidental `pg.pg.variable` if we ran it twice or something
content = content.replace(/pg\.pg\./g, 'pg.');

// Write back
fs.writeFileSync('src/routes/playground/+page.svelte', content);
console.log('Refactor complete');
