#!/usr/bin/env bash
# scope-check.sh — Validates that a branch only touches files within its task's risk clearance AND track boundary.
#
# Ported from The Shopkeeper's ALIVE project. ALIVE lesson: without automated scope enforcement,
# agents touch shared files and create 14+ merge conflicts. This script is the teeth.
#
# Usage:
#   ./scripts/scope-check.sh TASK-A01              # checks current branch vs main
#   ./scripts/scope-check.sh TASK-B02 feat/auth    # checks specific branch
#   ./scripts/scope-check.sh --list-tiers          # show all path→tier mappings
#   ./scripts/scope-check.sh --classify FILE...    # classify specific files
#   ./scripts/scope-check.sh --track TASK-A01      # show track boundaries for a task
#
# Reads: risk-policy.json (repo root)
# Requires: bash 4+, jq, git
#
# Exit codes:
#   0 — all files within clearance and track boundary
#   1 — scope violation (file exceeds task clearance)
#   2 — escalation triggered (game engine, risk-policy, or CLAUDE.md changed)
#   3 — usage error or missing dependencies
#   4 — track boundary violation (file belongs to other track)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
POLICY_FILE="$REPO_ROOT/risk-policy.json"

# ─── Colors ───
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Dependency check ───
check_deps() {
    if ! command -v jq &>/dev/null; then
        echo -e "${RED}Error: jq is required. Install with: apt install jq / brew install jq${NC}" >&2
        exit 3
    fi
    if [ ! -f "$POLICY_FILE" ]; then
        echo -e "${RED}Error: risk-policy.json not found at $POLICY_FILE${NC}" >&2
        exit 3
    fi
}

# ─── Tier ordering (for comparison) ───
tier_rank() {
    case "$1" in
        low)    echo 0 ;;
        medium) echo 1 ;;
        high)   echo 2 ;;
        *)      echo -1 ;;
    esac
}

tier_label() {
    case "$1" in
        low)    echo -e "${GREEN}low${NC}" ;;
        medium) echo -e "${YELLOW}medium${NC}" ;;
        high)   echo -e "${RED}high${NC}" ;;
    esac
}

# ─── Match a file against a glob pattern ───
matches_pattern() {
    local file="$1"
    local pattern="$2"

    # Strip leading ! for negation (handled by caller)
    pattern="${pattern#!}"

    # Convert glob to regex
    local regex="$pattern"

    # Escape dots
    regex="${regex//./\\.}"

    # ** matches any path depth
    regex="${regex//\*\*/__DOUBLESTAR__}"

    # * matches within a single directory (not /)
    regex="${regex//\*/[^/]*}"

    # Replace placeholder
    regex="${regex//__DOUBLESTAR__/.*}"

    # Anchor to full string
    regex="^${regex}$"

    [[ "$file" =~ $regex ]]
}

# ─── Classify a single file into a risk tier ───
classify_file() {
    local file="$1"

    # Check tiers in order: high first (most restrictive wins)
    for tier in high medium low; do
        local paths
        paths=$(jq -r ".tiers.${tier}.paths[]" "$POLICY_FILE" 2>/dev/null)

        # First check negations
        local negated=false
        while IFS= read -r pattern; do
            [ -z "$pattern" ] && continue
            if [[ "$pattern" == !* ]] && matches_pattern "$file" "$pattern"; then
                negated=true
                break
            fi
        done <<< "$paths"

        if [ "$negated" = true ]; then
            continue
        fi

        # Then check positive matches
        while IFS= read -r pattern; do
            [ -z "$pattern" ] && continue
            [[ "$pattern" == !* ]] && continue
            if matches_pattern "$file" "$pattern"; then
                echo "$tier"
                return
            fi
        done <<< "$paths"
    done

    # Unclassified files default to medium (safer than low)
    echo "medium"
}

# ─── Check if a file violates track boundaries ───
check_track_boundary() {
    local file="$1"
    local task_track="$2"

    # No track assigned = no boundary check
    if [ "$task_track" = "null" ] || [ "$task_track" = "" ]; then
        return 1
    fi

    # Get forbidden paths for this track
    local forbidden
    forbidden=$(jq -r ".track_boundaries.${task_track}.forbidden[]?" "$POLICY_FILE" 2>/dev/null)

    if [ -z "$forbidden" ]; then
        return 1
    fi

    while IFS= read -r pattern; do
        [ -z "$pattern" ] && continue
        if matches_pattern "$file" "$pattern"; then
            # Get the other track's name
            local other_track_name
            if [ "$task_track" = "track_a" ]; then
                other_track_name=$(jq -r '.track_boundaries.track_b.name' "$POLICY_FILE")
            else
                other_track_name=$(jq -r '.track_boundaries.track_a.name' "$POLICY_FILE")
            fi
            echo "TRACK VIOLATION: ${file} belongs to '${other_track_name}' — your track cannot touch it"
            return 0
        fi
    done <<< "$forbidden"

    # Check shared files (warning, not violation)
    local shared
    shared=$(jq -r '.track_boundaries.shared.paths[]?' "$POLICY_FILE" 2>/dev/null)

    while IFS= read -r pattern; do
        [ -z "$pattern" ] && continue
        if matches_pattern "$file" "$pattern"; then
            echo "SHARED: ${file} is shared between tracks — coordinate before modifying"
            return 2  # warning, not violation
        fi
    done <<< "$shared"

    return 1
}

# ─── Check escalation rules ───
check_escalations() {
    local file="$1"

    case "$file" in
        risk-policy.json)
            echo "ESCALATE: risk-policy.json modified — requires manual review"
            return 0
            ;;
        CLAUDE.md)
            echo "ESCALATE: CLAUDE.md modified — requires manual review"
            return 0
            ;;
        src/server/ws-server.ts)
            echo "ESCALATE: ws-server.ts modified — STOP: this is the game world"
            return 0
            ;;
        src/server/game-engine.ts)
            echo "ESCALATE: game-engine.ts modified — STOP: this is the game world"
            return 0
            ;;
    esac

    return 1
}

# ─── List all tier mappings ───
cmd_list_tiers() {
    check_deps
    echo -e "${BOLD}Risk Policy — Path Tiers${NC}"
    echo ""
    for tier in high medium low; do
        local desc
        desc=$(jq -r ".tiers.${tier}.description" "$POLICY_FILE")
        echo -e "  $(tier_label $tier): $desc"
        local merge
        merge=$(jq -r ".tiers.${tier}.merge_requires | join(\", \")" "$POLICY_FILE")
        echo -e "  ${DIM}merge requires: ${merge}${NC}"
        jq -r ".tiers.${tier}.paths[]" "$POLICY_FILE" | while IFS= read -r p; do
            echo -e "    ${DIM}${p}${NC}"
        done
        echo ""
    done

    echo -e "${BOLD}Track Boundaries${NC}"
    echo ""
    for track in track_a track_b; do
        local name
        name=$(jq -r ".track_boundaries.${track}.name" "$POLICY_FILE")
        echo -e "  ${CYAN}${name}${NC} (${track})"
        echo -e "  ${DIM}Owns:${NC}"
        jq -r ".track_boundaries.${track}.owns[]" "$POLICY_FILE" | while IFS= read -r p; do
            echo -e "    ${GREEN}✓${NC} ${DIM}${p}${NC}"
        done
        echo -e "  ${DIM}Forbidden:${NC}"
        jq -r ".track_boundaries.${track}.forbidden[]" "$POLICY_FILE" | while IFS= read -r p; do
            echo -e "    ${RED}✗${NC} ${DIM}${p}${NC}"
        done
        echo ""
    done

    echo -e "  ${CYAN}Shared${NC} (coordinate before touching)"
    jq -r '.track_boundaries.shared.paths[]' "$POLICY_FILE" | while IFS= read -r p; do
        echo -e "    ${YELLOW}⚠${NC} ${DIM}${p}${NC}"
    done
    echo ""

    echo -e "${BOLD}Task Clearances${NC}"
    jq -r '.task_clearances | to_entries[] | "  \(.key): \(.value.clearance) (\(.value.track))"' "$POLICY_FILE"
}

# ─── Classify specific files ───
cmd_classify() {
    check_deps
    shift  # remove --classify
    for file in "$@"; do
        local tier
        tier=$(classify_file "$file")
        echo -e "  $(tier_label $tier)  $file"
    done
}

# ─── Show track info for a task ───
cmd_track() {
    check_deps
    shift  # remove --track
    local task_id="$1"

    local task_info
    task_info=$(jq -r ".task_clearances.\"${task_id}\" // \"unknown\"" "$POLICY_FILE")

    if [ "$task_info" = "unknown" ]; then
        echo -e "${YELLOW}No clearance defined for ${task_id}${NC}"
        return
    fi

    local clearance track
    clearance=$(echo "$task_info" | jq -r '.clearance')
    track=$(echo "$task_info" | jq -r '.track')

    local track_name
    track_name=$(jq -r ".track_boundaries.${track}.name // \"unknown\"" "$POLICY_FILE")

    echo -e "${BOLD}${task_id}${NC}"
    echo -e "  Clearance: $(tier_label $clearance)"
    echo -e "  Track:     ${CYAN}${track_name}${NC} (${track})"
    echo ""
    echo -e "  ${GREEN}Files you CAN touch:${NC}"
    jq -r ".track_boundaries.${track}.owns[]" "$POLICY_FILE" | while IFS= read -r p; do
        echo -e "    ${GREEN}✓${NC} ${p}"
    done
    echo ""
    echo -e "  ${RED}Files you CANNOT touch:${NC}"
    jq -r ".track_boundaries.${track}.forbidden[]" "$POLICY_FILE" | while IFS= read -r p; do
        echo -e "    ${RED}✗${NC} ${p}"
    done
    echo ""
    echo -e "  ${YELLOW}Shared files (coordinate first):${NC}"
    jq -r '.track_boundaries.shared.paths[]' "$POLICY_FILE" | while IFS= read -r p; do
        echo -e "    ${YELLOW}⚠${NC} ${p}"
    done
}

# ─── Main: scope check for a task ───
cmd_check() {
    check_deps

    local task_id="$1"
    local branch="${2:-HEAD}"

    # Get task clearance and track
    local task_info
    task_info=$(jq ".task_clearances.\"${task_id}\" // null" "$POLICY_FILE")

    local clearance track
    if [ "$task_info" = "null" ]; then
        echo -e "${YELLOW}Warning: No clearance defined for ${task_id} in risk-policy.json${NC}"
        echo -e "${YELLOW}Defaulting to 'low' clearance, no track. Add the task to task_clearances.${NC}"
        clearance="low"
        track=""
    else
        clearance=$(echo "$task_info" | jq -r '.clearance')
        track=$(echo "$task_info" | jq -r '.track // empty')
    fi

    local clearance_rank
    clearance_rank=$(tier_rank "$clearance")

    # Get changed files
    local changed_files
    if [ "$branch" = "HEAD" ]; then
        changed_files=$(git diff --name-only main...HEAD 2>/dev/null || git diff --name-only origin/main...HEAD 2>/dev/null || echo "")
    else
        changed_files=$(git diff --name-only main..."$branch" 2>/dev/null || git diff --name-only origin/main..."$branch" 2>/dev/null || echo "")
    fi

    if [ -z "$changed_files" ]; then
        echo -e "${DIM}No changed files detected.${NC}"
        exit 0
    fi

    local file_count
    file_count=$(echo "$changed_files" | wc -l | tr -d ' ')

    local track_name=""
    if [ -n "$track" ]; then
        track_name=$(jq -r ".track_boundaries.${track}.name // \"\"" "$POLICY_FILE")
    fi

    echo -e "${BOLD}Scope Check: ${task_id}${NC}"
    echo -e "  Clearance: $(tier_label $clearance)"
    if [ -n "$track_name" ]; then
        echo -e "  Track:     ${CYAN}${track_name}${NC}"
    fi
    echo -e "  Branch:    ${branch}"
    echo -e "  Files:     ${file_count} changed"
    echo ""

    local violations=0
    local escalations=0
    local track_violations=0
    local shared_warnings=0
    local highest_tier="low"

    while IFS= read -r file; do
        [ -z "$file" ] && continue

        # Check escalation rules first
        local esc_msg
        if esc_msg=$(check_escalations "$file"); then
            echo -e "  ${RED}⚠ ${esc_msg}${NC}"
            echo -e "    ${DIM}${file}${NC}"
            ((escalations++))
            continue
        fi

        # Check track boundaries
        if [ -n "$track" ]; then
            local track_msg
            local track_result=0
            track_msg=$(check_track_boundary "$file" "$track") || track_result=$?

            if [ "$track_result" -eq 0 ]; then
                # Hard track violation
                echo -e "  ${RED}✗ ${track_msg}${NC}"
                ((track_violations++))
                continue
            elif [ "$track_result" -eq 2 ]; then
                # Shared file warning
                echo -e "  ${YELLOW}⚠ ${track_msg}${NC}"
                ((shared_warnings++))
                # Still check tier below
            fi
        fi

        # Classify the file
        local tier
        tier=$(classify_file "$file")
        local tier_r
        tier_r=$(tier_rank "$tier")

        # Track highest tier touched
        if [ "$tier_r" -gt "$(tier_rank "$highest_tier")" ]; then
            highest_tier="$tier"
        fi

        # Check against clearance
        if [ "$tier_r" -gt "$clearance_rank" ]; then
            echo -e "  ${RED}✗ VIOLATION${NC}  $(tier_label $tier)  ${file}"
            echo -e "    ${DIM}Task ${task_id} has '${clearance}' clearance but this file is '${tier}'${NC}"
            ((violations++))
        else
            echo -e "  ${GREEN}✓${NC} $(tier_label $tier)  ${DIM}${file}${NC}"
        fi
    done <<< "$changed_files"

    echo ""

    # Summary — track violations are the worst
    if [ "$track_violations" -gt 0 ]; then
        echo -e "${RED}${BOLD}✗ ${track_violations} TRACK BOUNDARY VIOLATION(S) — HARD FAILURE${NC}"
        echo -e "${DIM}  You touched files belonging to the other track. Revert immediately.${NC}"
        echo -e "${DIM}  ALIVE lesson: this is exactly how we got 14 merge conflicts on one PR.${NC}"
        echo ""
        exit 4
    fi

    if [ "$escalations" -gt 0 ]; then
        echo -e "${RED}${BOLD}⚠ ${escalations} ESCALATION(S) — requires operator review before merge${NC}"
        echo ""
        exit 2
    fi

    if [ "$violations" -gt 0 ]; then
        echo -e "${RED}${BOLD}✗ ${violations} SCOPE VIOLATION(S) — ${task_id} touched files above its clearance${NC}"
        echo -e "${DIM}  Either fix the branch or update task_clearances in risk-policy.json${NC}"
        echo ""
        exit 1
    fi

    # Report merge requirements for highest tier touched
    local merge_reqs
    merge_reqs=$(jq -r ".tiers.${highest_tier}.merge_requires | join(\", \")" "$POLICY_FILE")
    echo -e "${GREEN}${BOLD}✓ All ${file_count} files within ${task_id}'s '${clearance}' clearance${NC}"
    if [ "$shared_warnings" -gt 0 ]; then
        echo -e "  ${YELLOW}Note: ${shared_warnings} shared file(s) touched — coordinate with other track${NC}"
    fi
    echo -e "  ${DIM}Highest tier touched: ${highest_tier} → merge requires: ${merge_reqs}${NC}"
    echo ""
    exit 0
}

# ─── Usage ───
usage() {
    echo "Usage:"
    echo "  $0 TASK-XXX [branch]     Check branch scope against task clearance + track boundary"
    echo "  $0 --list-tiers          Show all path→tier mappings and track boundaries"
    echo "  $0 --classify FILE...    Classify specific files by risk tier"
    echo "  $0 --track TASK-XXX      Show track boundaries for a specific task"
    echo ""
    echo "Examples:"
    echo "  $0 TASK-A01                        # check current branch (Track A)"
    echo "  $0 TASK-B02 feat/auth              # check specific branch (Track B)"
    echo "  $0 --classify agent/brain.ts src/server/auth.ts"
    echo "  $0 --track TASK-A03"
    echo ""
    echo "Exit codes:"
    echo "  0 — clean"
    echo "  1 — scope violation (tier exceeded)"
    echo "  2 — escalation (needs operator)"
    echo "  3 — usage error"
    echo "  4 — TRACK BOUNDARY violation (hard failure)"
}

# ─── Entry point ───
case "${1:-}" in
    --list-tiers)   cmd_list_tiers ;;
    --classify)     cmd_classify "$@" ;;
    --track)        cmd_track "$@" ;;
    --help|-h)      usage ;;
    TASK-*)         cmd_check "$@" ;;
    *)              usage; exit 3 ;;
esac
