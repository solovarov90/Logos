#!/bin/bash
set -e

# Configuration
APP_DIR="/root/OpenClaw"

echo "=========================================="
echo "Starting OpenClaw Update at $(date)"
echo "=========================================="

# Navigate to application directory
cd "$APP_DIR" || { echo "Directory $APP_DIR not found"; exit 1; }

# Fetch and reset git
echo "--> Fetching latest changes..."
git fetch origin
echo "--> Resetting to origin/main..."
git reset --hard origin/main

# Rebuild containers
echo "--> Rebuilding Docker containers..."
docker compose up -d --build

# Cleanup unused images
echo "--> Cleaning up unused Docker images..."
docker image prune -f

echo "=========================================="
echo "Update Completed Successfully!"
echo "=========================================="
