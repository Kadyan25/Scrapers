FROM apify/actor-node-playwright-chrome:18

USER root
RUN mkdir -p /home/myuser/actors/gmaps-full && chown -R myuser:myuser /home/myuser/actors

USER myuser

# Install at /home/myuser so both actor and shared/ can resolve node_modules up the tree
WORKDIR /home/myuser
COPY --chown=myuser:myuser package.json ./
RUN npm install --omit=dev

# Copy actor files and place shared/ where ../../shared resolves from WORKDIR
WORKDIR /home/myuser/actors/gmaps-full
COPY --chown=myuser:myuser . .
RUN cp -r shared /home/myuser/shared

CMD ["node", "main.js"]
