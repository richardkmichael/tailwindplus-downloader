#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

usage() {
  echo "Usage: $(basename "$0") [FILE]"
  echo ""
  echo "Create a skeleton JSON file from a TailwindPlus components JSON file,"
  echo "replacing component code with '<CONTENT>' placeholders."
  echo ""
  echo "Arguments:"
  echo "  FILE    Path to the components JSON file."
  echo "          Defaults to tailwindplus-components-YYYY-MM-DD-HHMMSS.json"
  echo "          in the current directory."
  echo ""
  echo "Output: tailwindplus-skeleton.json"
}

if (( $# > 0 )) && [[ "$1" == "--help" || "$1" == "-h" ]]; then
  usage
  exit 0
fi

if [[ -e tailwindplus-skeleton.json ]]; then
  echo "error: tailwindplus-skeleton.json already exists" >&2
  exit 1
fi

if (( $# > 0 )); then
  inputs=("$1")
else
  shopt -s nullglob
  inputs=(tailwindplus-components-????-??-??-??????.json)
  shopt -u nullglob
  if (( ${#inputs[@]} == 0 )); then
    echo "error: no tailwindplus components file found" >&2
    exit 1
  fi
fi

jq '
def walk:
  . as $in |
    if type == "object" then
      reduce keys[] as $key ({}; . + {($key): ($in[$key] | walk)})
    elif type == "array" then
      map(walk)
    elif type == "string" then
      if length > 100 then "<CONTENT>" else . end
    else .
    end;

# Keep metadata, replace large string content in .tailwindplus
. + {"tailwindplus": (.tailwindplus | walk)}
' "${inputs[@]}" > tailwindplus-skeleton.json
