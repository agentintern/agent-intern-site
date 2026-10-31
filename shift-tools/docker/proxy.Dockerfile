FROM node:22-alpine
COPY proxy.mjs /proxy.mjs
USER node
CMD ["node", "/proxy.mjs"]
