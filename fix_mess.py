with open('src/routes/playground/+page.svelte', 'r') as f:
    text = f.read()

text = text.replace('pg.weather/Weather.svelte', 'weather/Weather.svelte')
text = text.replace('heading: pg.heading, distanceMeters', 'pg.heading, distanceMeters')
text = text.replace('locationId: activeLocation: pg.activeLocation,', 'locationId: pg.activeLocation,')
text = text.replace('bearing=heading={pg.heading}', 'bearing={pg.heading}')
text = text.replace('showTerrain=mlTerrain={pg.mlTerrain}', 'showTerrain={pg.mlTerrain}')
text = text.replace('showBuildings=mlBuildings={pg.mlBuildings}', 'showBuildings={pg.mlBuildings}')
text = text.replace('showAtmosphere=mlAtmosphere={pg.mlAtmosphere}', 'showAtmosphere={pg.mlAtmosphere}')

# Let's double check if there are any others.
text = text.replace('pg.timeOfDay={pg.timeOfDay}', 'timeOfDay={pg.timeOfDay}')
text = text.replace('pg.paletteName={pg.paletteName}', 'paletteName={pg.paletteName}')
text = text.replace('pg.freeCam={pg.freeCam}', 'freeCam={pg.freeCam}')
text = text.replace('pg.showCityLights={pg.showCityLights}', 'showCityLights={pg.showCityLights}')
text = text.replace('pg.lodMaxZoomLevels={pg.lodMaxZoomLevels}', 'lodMaxZoomLevels={pg.lodMaxZoomLevels}')
text = text.replace('pg.lodTileCountRatio={pg.lodTileCountRatio}', 'lodTileCountRatio={pg.lodTileCountRatio}')


with open('src/routes/playground/+page.svelte', 'w') as f:
    f.write(text)

