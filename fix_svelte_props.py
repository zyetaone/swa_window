import re

with open('src/routes/playground/+page.svelte', 'r') as f:
    orig = f.read()

# Fix destructured shorthand props: {pg.altitude} -> altitude={pg.altitude}
fixed = re.sub(r'\{pg\.(\w+)\}', r'\1={pg.\1}', orig)

with open('src/routes/playground/+page.svelte', 'w') as f:
    f.write(fixed)
print("Props fixed")
