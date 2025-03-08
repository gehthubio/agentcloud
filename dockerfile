FROM rnadigital/agentcloud:master

# Install missing dependencies
RUN apt-get update && apt-get install -y \
    jq \
    ncurses-bin \  # This package contains tput
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
