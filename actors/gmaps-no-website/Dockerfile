FROM apify/actor-node-playwright-chrome:18

USER root
RUN mkdir -p /home/myuser/actors/gmaps-no-website && chown -R myuser:myuser /home/myuser/actors

USER myuser

WORKDIR /home/myuser
COPY --chown=myuser:myuser package.json ./
RUN npm install --omit=dev

WORKDIR /home/myuser/actors/gmaps-no-website
COPY --chown=myuser:myuser . .
RUN cp -r shared /home/myuser/shared

CMD ["node", "main.js"]
