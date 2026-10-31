FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@2.1.269 && npm cache clean --force

COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY npmrc /etc/npmrc

RUN useradd -m -u 1001 -s /bin/bash intern \
  && mkdir -p /home/intern/.claude /workspace \
  && chown -R intern:intern /home/intern /workspace

USER intern
WORKDIR /workspace
ENTRYPOINT ["claude"]
