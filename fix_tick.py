import re

with open('src/routes/playground/+page.svelte', 'r') as f:
    content = f.read()

# Fix Javascript object shorthand: pg.heading, -> heading: pg.heading,
# Be careful not to break everything. Only match exactly: "				pg.variable,"
content = re.sub(r'(\s+)pg\.(\w+),', r'\1\2: pg.\2,', content)

# Remove the old preset actions which are now in PlaygroundState
# We just replace the `function randomize() {...}` and `function reset() {...}` with nothing
content = re.sub(r'function randomize\(\)\s*\{.*?\}', '', content, flags=re.DOTALL)
content = re.sub(r'function reset\(\)\s*\{.*?\}', '', content, flags=re.DOTALL)


with open('src/routes/playground/+page.svelte', 'w') as f:
    f.write(content)
