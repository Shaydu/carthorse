#!/bin/bash

# Simple Bandwidth Usage Tracker
# Usage: ./simple_bandwidth_tracker.sh [limit_mb] [alert_percent]

set -e

# Configuration
LIMIT_MB=${1:-1000}  # Default 1GB limit
ALERT_PERCENT=${2:-80}  # Alert at 80% usage
INTERFACE="en0"
LOG_FILE="/tmp/bandwidth_session.log"
SESSION_START=$(date +%s)

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Initialize session log
echo "=== Bandwidth Session Started ===" > "$LOG_FILE"
echo "Start time: $(date)" >> "$LOG_FILE"
echo "Limit: ${LIMIT_MB}MB" >> "$LOG_FILE"
echo "Alert threshold: ${ALERT_PERCENT}%" >> "$LOG_FILE"
echo "Interface: $INTERFACE" >> "$LOG_FILE"
echo "================================" >> "$LOG_FILE"

# Function to get current network stats
get_network_stats() {
    # Get bytes transferred since boot
    local rx_bytes=$(netstat -I $INTERFACE | tail -1 | awk '{print $7}')
    local tx_bytes=$(netstat -I $INTERFACE | tail -1 | awk '{print $10}')
    
    # Calculate total bytes
    local total_bytes=$((rx_bytes + tx_bytes))
    echo "$total_bytes"
}

# Function to convert bytes to MB
bytes_to_mb() {
    local bytes=$1
    echo "scale=2; $bytes / 1024 / 1024" | bc -l
}

# Function to show alert
show_alert() {
    local message="$1"
    local level="$2"
    
    case $level in
        "warning")
            echo -e "${YELLOW}⚠️  WARNING: $message${NC}"
            ;;
        "critical")
            echo -e "${RED}🚨 CRITICAL: $message${NC}"
            # Play alert sound
            afplay /System/Library/Sounds/Ping.aiff 2>/dev/null || true
            ;;
    esac
    
    echo "$(date): $level - $message" >> "$LOG_FILE"
}

# Function to display current usage
display_usage() {
    local current_mb=$1
    local percent=$2
    local bar_length=30
    local filled=$((percent * bar_length / 100))
    local empty=$((bar_length - filled))
    
    printf "${BLUE}📊 Session Usage: ${NC}"
    printf "["
    printf "%${filled}s" | tr ' ' '█'
    printf "%${empty}s" | tr ' ' '░'
    printf "] ${current_mb}MB / ${LIMIT_MB}MB (${percent}%%)\n"
}

# Function to save session summary
save_summary() {
    local session_mb=$1
    local percent=$2
    local session_duration=$3
    
    echo "" >> "$LOG_FILE"
    echo "=== Session Summary ===" >> "$LOG_FILE"
    echo "End time: $(date)" >> "$LOG_FILE"
    echo "Duration: ${session_duration} seconds" >> "$LOG_FILE"
    echo "Total usage: ${session_mb}MB" >> "$LOG_FILE"
    echo "Limit: ${LIMIT_MB}MB" >> "$LOG_FILE"
    echo "Percentage: ${percent}%" >> "$LOG_FILE"
    echo "=====================" >> "$LOG_FILE"
}

# Main monitoring loop
echo -e "${GREEN}🚀 Starting bandwidth tracker...${NC}"
echo -e "${BLUE}📡 Interface: $INTERFACE${NC}"
echo -e "${BLUE}📏 Limit: ${LIMIT_MB}MB${NC}"
echo -e "${BLUE}⚠️  Alert at: ${ALERT_PERCENT}%${NC}"
echo -e "${BLUE}📝 Log: $LOG_FILE${NC}"
echo ""

# Get initial stats
INITIAL_BYTES=$(get_network_stats)
ALERTED=false

# Trap to save summary on exit
trap 'save_summary "$SESSION_MB" "$PERCENT" "$(($(date +%s) - SESSION_START))"; echo -e "\n${GREEN}📊 Session ended. Check $LOG_FILE for details${NC}"' EXIT

while true; do
    # Get current stats
    CURRENT_BYTES=$(get_network_stats)
    
    # Calculate session usage (difference from start)
    SESSION_BYTES=$((CURRENT_BYTES - INITIAL_BYTES))
    SESSION_MB=$(bytes_to_mb $SESSION_BYTES)
    
    # Calculate percentage
    PERCENT=$(echo "scale=1; $SESSION_MB * 100 / $LIMIT_MB" | bc -l)
    
    # Clear line and display current usage
    printf "\r"
    display_usage "$SESSION_MB" "$PERCENT"
    
    # Check for alerts
    if (( $(echo "$PERCENT >= $ALERT_PERCENT" | bc -l) )) && [ "$ALERTED" = false ]; then
        show_alert "Bandwidth usage reached ${ALERT_PERCENT}% (${SESSION_MB}MB / ${LIMIT_MB}MB)" "warning"
        ALERTED=true
    fi
    
    # Check for critical usage (95%)
    if (( $(echo "$PERCENT >= 95" | bc -l) )); then
        show_alert "Critical bandwidth usage: ${PERCENT}% (${SESSION_MB}MB / ${LIMIT_MB}MB)" "critical"
    fi
    
    # Log every 10 seconds
    if [ $(( $(date +%s) % 10 )) -eq 0 ]; then
        echo "$(date): ${SESSION_MB}MB (${PERCENT}%)" >> "$LOG_FILE"
    fi
    
    sleep 2
done 