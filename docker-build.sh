#!/usr/bin/env bash

# Change directory to the current script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; cd $DIR

# Create data directory
mkdir -p data/

# Build the docker image
docker build -t img-trk:latest .
