#!/bin/bash

# Path to the plist file
PLIST_NAME="com.user.videoupdater.plist"
DEST_DIR="$HOME/Library/LaunchAgents"

# Copy the plist to LaunchAgents
echo "Installing $PLIST_NAME to $DEST_DIR..."
cp "$PLIST_NAME" "$DEST_DIR/"

# Load the job
echo "Loading the job..."
launchctl unload "$DEST_DIR/$PLIST_NAME" 2>/dev/null
launchctl load "$DEST_DIR/$PLIST_NAME"

echo "Job installed and loaded."
echo "You can check logs at:"
echo "  StandardOut: $(pwd)/stdout.log"
echo "  StandardError: $(pwd)/stderr.log"
