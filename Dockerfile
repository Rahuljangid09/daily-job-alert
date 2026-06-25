# Using the official Apify Node.js image
FROM apify/actor-node:18

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source
COPY . ./

# Run the Actor
CMD node main.js
