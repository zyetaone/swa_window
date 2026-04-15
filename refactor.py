import re

with open('src/routes/playground/+page.svelte', 'r') as f:
    content = f.read()

# 1. State definitions to strip
states_to_remove = [
    'activeLocation', 'timeOfDay', 'weather', 'maplibreSource',
    'density', 'cloudSpeed', 'heading', 'planeSpeed', 'altitude',
    'autoOrbit', 'autoTime', 'autoFly', 'turbulenceLevel',
    'mlTerrain', 'mlBuildings', 'mlAtmosphere',
    'paletteName', 'freeCam', 'showCityLights', 'showThreeBillboards', 'showLandmarks', 'useRealisticClouds',
    'lodMaxZoomLevels', 'lodTileCountRatio'
]

for s in states_to_remove:
    # Match: let variable = $state(...); or let variable: type = $state(...);
    content = re.sub(rf'\n\s*let\s+{s}(?:\s*:\s*.*?)?\s*=\s*\$state[^;]*;', '', content)

# 2. Add imports
content = content.replace(
    "import 'maplibre-gl/dist/maplibre-gl.css';",
    "import 'maplibre-gl/dist/maplibre-gl.css';\n\timport { pg } from './lib/playground-state.svelte';\n\timport PlaygroundHud from './components/PlaygroundHud.svelte';\n\timport PlaygroundDrawer from './components/PlaygroundDrawer.svelte';"
)

# 3. Replace standalone variables referencing the stripped state
for s in states_to_remove:
    content = re.sub(rf'\b(?<!\.){s}\b', f'pg.{s}', content)

# 4. Remove HUD and Drawer HTML blocks
content = re.sub(r'<!-- HUD chips.*?</div>', '<PlaygroundHud {isBoosting} />', content, flags=re.DOTALL)
content = re.sub(r'<!-- Settings drawer.*?</aside>', '', content, flags=re.DOTALL)
content = re.sub(r'<aside class="drawer".*?</aside>', '', content, flags=re.DOTALL)
content = re.sub(r'<!-- Drawer toggle.*?</div>', '<PlaygroundDrawer bind:drawerOpen />', content, flags=re.DOTALL)

with open('src/routes/playground/+page.svelte', 'w') as f:
    f.write(content)

print('Refactor successful')
