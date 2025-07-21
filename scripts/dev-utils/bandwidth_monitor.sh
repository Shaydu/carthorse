#!/bin/bash

# Bandwidth Monitor with Limits and Alerts
# Usage: ./bandwidth_monitor.sh [limit_mb] [alert_percent] [shutdown_threshold]

set -e

# Configuration
LIMIT_MB=${1:-1000}  # Default 1GB limit
ALERT_PERCENT=${2:-80}  # Alert at 80% usage
SHUTDOWN_THRESHOLD=${3:-100}  # Shutdown at 100% (disabled by default)
INTERFACE="en0"
LOG_FILE="/tmp/bandwidth_usage.log"
SESSION_START=$(date +%s)

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Initialize usage tracking
echo "$(date): Session started - Limit: ${LIMIT_MB}MB, Alert: ${ALERT_PERCENT}%, Shutdown: ${SHUTDOWN_THRESHOLD}%" >> "$LOG_FILE"

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
        "shutdown")
            echo -e "${RED}🛑 SHUTDOWN: $message${NC}"
            # Play multiple alert sounds
            for i in {1..3}; do
                afplay /System/Library/Sounds/Ping.aiff 2>/dev/null || true
                sleep 0.5
            done
            ;;
    esac
    
    echo "$(date): $level - $message" >> "$LOG_FILE"
}

# Function to shutdown network (requires sudo)
shutdown_network() {
    echo -e "${RED}🛑 SHUTTING DOWN NETWORK INTERFACE $INTERFACE${NC}"
    echo "$(date): SHUTDOWN - Disabling network interface $INTERFACE" >> "$LOG_FILE"
    
    # Try to disable the interface
    if command -v sudo &> /dev/null; then
        sudo ifconfig $INTERFACE down 2>/dev/null || {
            echo -e "${RED}Failed to shutdown network. You may need to run manually:${NC}"
            echo "sudo ifconfig $INTERFACE down"
        }
    else
        echo -e "${RED}sudo not available. Please manually disable network:${NC}"
        echo "ifconfig $INTERFACE down"
    fi
}

# Function to display current usage
display_usage() {
    local current_mb=$1
    local percent=$2
    local bar_length=20
    local filled=$((percent * bar_length / 100))
    local empty=$((bar_length - filled))
    
    printf "${BLUE}📊 Bandwidth Usage: ${NC}"
    printf "["
    printf "%${filled}s" | tr ' ' '█'
    printf "%${empty}s" | tr ' ' '░'
    printf "] ${current_mb}MB / ${LIMIT_MB}MB (${percent}%%)\n"
}

# Main monitoring loop
echo -e "${GREEN}🚀 Starting bandwidth monitor...${NC}"
echo -e "${BLUE}📡 Interface: $INTERFACE${NC}"
echo -e "${BLUE}📏 Limit: ${LIMIT_MB}MB${NC}"
echo -e "${BLUE}⚠️  Alert at: ${ALERT_PERCENT}%${NC}"
if [ "$SHUTDOWN_THRESHOLD" != "100" ]; then
    echo -e "${BLUE}🛑 Shutdown at: ${SHUTDOWN_THRESHOLD}%${NC}"
fi
echo ""

# Get initial stats
INITIAL_BYTES=$(get_network_stats)
LAST_BYTES=$INITIAL_BYTES
ALERTED=false
SHUTDOWN_ALERTED=false

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
    
    # Check for shutdown threshold
    if (( $(echo "$PERCENT >= $SHUTDOWN_THRESHOLD" | bc -l) )) && [ "$SHUTDOWN_ALERTED" = false ]; then
        show_alert "Bandwidth limit reached! Shutting down network in 10 seconds..." "shutdown"
        SHUTDOWN_ALERTED=true
        
        # Countdown and shutdown
        for i in {10..1}; do
            printf "\r${RED}🛑 Shutting down in $i seconds...${NC}"
            sleep 1
        done
        printf "\n"
        shutdown_network
        break
    fi
    
    # Check for critical usage (95%)
    if (( $(echo "$PERCENT >= 95" | bc -l) )); then
        show_alert "Critical bandwidth usage: ${PERCENT}% (${SESSION_MB}MB / ${LIMIT_MB}MB)" "critical"
    fi
    
    sleep 2
done

# Final summary
echo ""
echo -e "${GREEN}📊 Session Summary:${NC}"
echo -e "${BLUE}   Start time: $(date -r $SESSION_START)${NC}"
echo -e "${BLUE}   End time: $(date)${NC}"
echo -e "${BLUE}   Total usage: ${SESSION_MB}MB${NC}"
echo -e "${BLUE}   Limit: ${LIMIT_MB}MB${NC}"
echo -e "${BLUE}   Percentage: ${PERCENT}%${NC}"
echo ""
echo -e "${GREEN}📝 Log saved to: $LOG_FILE${NC}" 
