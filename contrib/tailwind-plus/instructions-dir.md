# Directory format workflow

## Directory layout

```
{components-root}/
  {Category}/
    {Subcategory}/
      {Group}/
        {Component}/
          v3/
            html-system.html    ← HTML with light+dark mode support
            html-light.html     ← HTML light only
            html-dark.html      ← HTML dark only
            react-system.jsx    ← React with light+dark mode support
            react-light.jsx
            react-dark.jsx
            vue-system.vue
            vue-light.vue
            vue-dark.vue
          v4/
            html-system.html
            ...
```

The components root directory name depends on how the downloader was invoked: the default is a
timestamped directory (`tailwindplus-components-[TIMESTAMP]/`), but `--output` overrides it.

## Steps

1. Consult the component catalog in SKILL.md to identify the right group.
2. Browse available components within the group: `Glob` `{components-root}/{Category}/{Subcategory}/{Group}/*/`
3. List file variants for the chosen component: `Glob` `{components-root}/{Category}/{Subcategory}/{Group}/{Component}/v4/*`
   Prefer `v4`; use `v3` only if the project targets Tailwind CSS v3.
4. `Read` the appropriate file — choose to match the project's framework and dark mode approach
   (`system` supports both light and dark via `dark:` prefixes). If either is unclear, ask the user.
5. Adapt the code to the user's needs (replace placeholder text, adjust colors, wire up interactivity).

Note: category, subcategory, group, and component names all contain spaces — account for this in
Glob patterns.
