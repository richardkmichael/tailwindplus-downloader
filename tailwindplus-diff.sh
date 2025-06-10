#!/usr/bin/env bash

# Bash best practices
set -o errexit   # Exit on any command failure
set -o nounset   # Exit on undefined variables
set -o pipefail  # Exit on pipe failures

# Check for required dependencies
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required for JSON processing but not installed."
  echo "This tool uses jq to extract and compare TailwindPlus components."
  echo "Please install jq: https://jqlang.github.io/jq/download/"
  echo "  macOS: brew install jq"
  echo "  Ubuntu/Debian: apt-get install jq"
  echo "  CentOS/RHEL: yum install jq"
  exit 1
fi

# Check if git is available for better diff output
HAS_GIT=false
if command -v git >/dev/null 2>&1; then
  HAS_GIT=true
else
  echo "Note: git not found. Diffs will use basic format."
  echo "For better word-level diffs, install git: https://git-scm.com/downloads"
  echo ""
fi

# Cleanup function for temporary files
cleanup() {
  rm -f temp1.html temp2.html 2>/dev/null
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Function to display usage information
usage() {
  echo "Usage: $0 [--old <OLD_FILE>] [--new <NEW_FILE>]"
  echo ""
  echo "Compare TailwindPlus component files and generate detailed diffs."
  echo ""
  echo "Options:"
  echo "  --old <OLD_FILE>: Path to the old JSON file"
  echo "  --new <NEW_FILE>: Path to the new JSON file"
  echo "  -h, --help:       Show this help message"
  echo ""
  echo "If no files are specified, will automatically use the two most recent"
  echo "tailwindplus-components*.json files (newest as --new, second-newest as --old)."
  echo ""
  echo "The tool generates word-level diffs for changed components and saves them"
  echo "in the 'diffs' directory for detailed analysis."
  exit 1
}

# Initialize variables
OLD_FILE=""
NEW_FILE=""

# Parse command line arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --old) OLD_FILE="$2"; shift ;;
    --new) NEW_FILE="$2"; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown parameter: $1"; usage ;;
  esac
  shift
done

# Auto-discovery logic if files not explicitly provided
if [ -z "$OLD_FILE" ] || [ -z "$NEW_FILE" ]; then
  # Find all tailwindplus-components files, sort by modification time (newest first)
  # Note: mapfile would be preferred (mapfile -t files < <(ls -t...)) but using
  # read loop for macOS bash 3.2 compatibility since mapfile requires bash 4.0+
  files=()
  while IFS= read -r file; do
    files+=("$file")
  done < <(ls -t tailwindplus-components*.json 2>/dev/null)

  # Check if we have enough files
  if [ ${#files[@]} -lt 2 ]; then
    echo "Found ${#files[@]} tailwindplus-components file(s):"
    for file in "${files[@]}"; do
      echo "  $file"
    done
    echo ""
    if [ ${#files[@]} -eq 1 ]; then
      echo "Error: Only 1 file found. At least 2 files are needed for comparison."
      echo ""
      echo "Please specify the other file using --old or --new:"
      echo "  $0 --old <older_file> --new ${files[0]}"
      echo "  $0 --old ${files[0]} --new <newer_file>"
    else
      echo "No tailwindplus-components files found. Please run tailwindplus-download.js first."
    fi
    exit 1
  fi

  # Use auto-discovered files if not explicitly provided
  if [ -z "$NEW_FILE" ]; then
    NEW_FILE="${files[0]}"  # Most recent
  fi
  if [ -z "$OLD_FILE" ]; then
    OLD_FILE="${files[1]}"  # Second most recent
  fi

  echo "Auto-discovered tailwindplus-components files."
  echo ""
fi

# Check if files exist
if [ ! -f "$OLD_FILE" ]; then
  echo "Error: Old file '$OLD_FILE' does not exist."
  exit 1
fi

if [ ! -f "$NEW_FILE" ]; then
  echo "Error: New file '$NEW_FILE' does not exist."
  exit 1
fi

echo "Comparing:"
echo "  Old: $OLD_FILE"
echo "  New: $NEW_FILE"
echo ""

# Ensure diffs directory exists and is writable
if [ ! -d "diffs" ]; then
  if ! mkdir -p "diffs" 2>/dev/null; then
    echo "Error: Cannot create diffs directory. Check permissions."
    exit 1
  fi
fi

# Get all categories
jq -r 'keys[]' "$NEW_FILE" | while read -r category; do
  echo "Processing category: $category"

  # Get subcategories for this category
  jq -r --arg cat "$category" '.[$cat] | keys[]' "$NEW_FILE" | while read -r subcategory; do
    echo "  Processing subcategory: $subcategory"

    # Get groups for this subcategory
    jq -r --arg cat "$category" --arg subcat "$subcategory" '.[$cat][$subcat] | keys[]' "$NEW_FILE" | while read -r group; do
      echo "    Processing group: $group"

      # Get component names for this group
      jq -r --arg cat "$category" --arg subcat "$subcategory" --arg grp "$group" '.[$cat][$subcat][$grp] | keys[]' "$NEW_FILE" | while read -r component; do
        echo "      Comparing: $category > $subcategory > $group > \"$component\""

        # Extract component with proper quoting - handles spaces in keys properly
        if ! jq -r --arg cat "$category" --arg subcat "$subcategory" --arg grp "$group" --arg comp "$component" '.[$cat][$subcat][$grp][$comp]' "$OLD_FILE" > temp1.html 2>/dev/null; then
          echo "      - Warning: Failed to extract component from old file"
          continue
        fi

        if ! jq -r --arg cat "$category" --arg subcat "$subcategory" --arg grp "$group" --arg comp "$component" '.[$cat][$subcat][$grp][$comp]' "$NEW_FILE" > temp2.html 2>/dev/null; then
          echo "      - Warning: Failed to extract component from new file"
          continue
        fi

        # Check if files exist and have content
        if [ -s temp1.html ] && [ -s temp2.html ]; then
          # Check if they differ
          if ! cmp -s temp1.html temp2.html; then
            echo "      - DIFFERENCES FOUND!"

            # Create sanitized component name for filename - handle all dangerous characters
            safe_name=$(printf '%s' "${category}_${subcategory}_${group}_${component}" | \
              tr ' /:*?"<>|[]$`\\\n\t#' '_' | \
              tr -s '_' | \
              sed 's/^[._]*//' | \
              cut -c1-200)

            # Validate the sanitized filename and provide fallback
            if [[ -z "$safe_name" || "$safe_name" =~ ^[._-]+$ ]]; then
              safe_name="component_$(date +%s)_$$"  # Fallback to timestamp + PID
            fi

            # Create diff file using git if available (better for HTML/CSS), otherwise basic diff
            if [ "$HAS_GIT" = true ]; then
              git diff --no-index --word-diff=color temp1.html temp2.html > "diffs/${safe_name}.diff" 2>/dev/null || true
              echo "        Summary: $(git diff --no-index --stat temp1.html temp2.html 2>/dev/null || echo 'Git diff completed')"
            else
              diff -u temp1.html temp2.html > "diffs/${safe_name}.diff" 2>/dev/null || true
              diff_lines=$(wc -l < "diffs/${safe_name}.diff" 2>/dev/null || echo "0")
              echo "        Summary: ${diff_lines} lines in diff file"
            fi
          fi
        else
          # Check which file is missing the component
          if [ ! -s temp1.html ] && [ -s temp2.html ]; then
            echo "      - Component exists only in the NEW file."
          elif [ -s temp1.html ] && [ ! -s temp2.html ]; then
            echo "      - Component exists only in the OLD file."
          else
            echo "      - Component extraction failed for both files."
          fi
        fi
      done
    done
  done
done

echo ""
echo "Diff files saved in 'diffs' directory"
