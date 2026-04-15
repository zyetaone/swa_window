with open('src/routes/playground/+page.svelte', 'r') as f:
    text = f.read()

text = text.replace('speed=cloudSpeed={pg.cloudSpeed}', 'speed={pg.cloudSpeed}')

with open('src/routes/playground/+page.svelte', 'w') as f:
    f.write(text)

