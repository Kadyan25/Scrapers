'use strict';

/**
 * Wait a random number of milliseconds between min and max.
 * Use this everywhere instead of fixed setTimeout.
 */
function humanDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Short delay between scroll steps inside the GMaps results panel.
 */
function scrollDelay() {
  return humanDelay(300, 700);
}

/**
 * Wait after a page navigation before interacting with the DOM.
 */
function pageLoadDelay() {
  return humanDelay(1500, 3000);
}

module.exports = { humanDelay, scrollDelay, pageLoadDelay };
