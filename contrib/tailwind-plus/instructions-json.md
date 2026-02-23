# JSON file format workflow

## Steps

1. Consult the component catalog in SKILL.md to identify the right component.
2. If `tailwindplus-skeleton.json` exists, `Read` it to confirm the component path before querying.
3. Extract the component code with `jq`. Select by framework (`.name`), mode (`.mode`), and Tailwind
   version (`.version`). Property names containing spaces must be quoted in the jq path:
   ```
   jq '.tailwindplus."{Category}"."{Subcategory}"."{Group}"."{Component}".snippets[]
     | select(.name == "html" and .mode == "system" and .version == 4)
     | .code' --raw-output tailwindplus-components-*.json
   ```
   Framework values: `html`, `react`, `vue`. Mode values: `system`, `light`, `dark`.
   Prefer `system` and version `4`; adjust to match the project or ask the user if unclear.
4. Adapt the code to the user's needs (replace placeholder text, adjust colors, wire up interactivity).
