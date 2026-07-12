/*
  Home screen icon generator.

  Without an icon of its own iOS takes a screenshot of the page and uses that as
  the home screen icon, which is why the clock used to land differently on every
  iPad. This script draws the icon once, as vector, and rasterises it into the
  sizes iOS asks for.

  The icon is an analogue dial in the palette of the LED clock: an amber glow on
  a black background, hands frozen at the same 10:08 the screenshots use. A dial
  is drawn instead of digits because the oldest target, the non retina iPad mini,
  renders the icon at 76 pixels, and seven segment digits turn to mush there.

  Usage (from the repo root):

    cd tools
    npm install
    node make-icons.js

  Writes ../icons/*.png. Re-run only when the icon itself changes; the result is
  committed, so a plain checkout needs no Node at all.
*/

var puppeteer = require('puppeteer');
var path = require('path');
var fs = require('fs');

var ICONS_DIR = path.resolve(__dirname, '..', 'icons');

/*
  76  non retina iPad (iPad mini 1, iOS 9)
  120 iPhone
  152 retina iPad
  167 iPad Pro
  180 iPhone Plus / Max, and what modern iOS picks when it wants the largest one
  192 Android and desktop browsers reading the web app manifest
  512 manifest and any store like listing
*/
var SIZES = [76, 120, 152, 167, 180, 192, 512];

var AMBER = '#ffb648';
var CORE = '#ffe2a0';

/* Hand angles for 10:08, clockwise from twelve o'clock. */
var HOUR_ANGLE = (10 + 8 / 60) * 30;
var MINUTE_ANGLE = 8 * 6;

/*
  Everything is expressed in a 512 unit square and scaled by the viewBox, so a
  single drawing serves every size. Strokes are kept heavy on purpose: a hairline
  that looks elegant at 512 disappears at 76.
*/
function svg(size) {
  var ticks = '';
  var i;

  for (i = 0; i < 12; i += 1) {
    ticks += '<line x1="256" y1="86" x2="256" y2="' + (i % 3 === 0 ? 118 : 108) + '"' +
      ' stroke="' + AMBER + '" stroke-width="' + (i % 3 === 0 ? 18 : 12) + '" stroke-linecap="round"' +
      ' transform="rotate(' + (i * 30) + ' 256 256)"/>';
  }

  return '' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 512 512">' +
    '<defs>' +
    '<radialGradient id="bg" cx="50%" cy="46%" r="62%">' +
    '<stop offset="0" stop-color="#181206"/>' +
    '<stop offset="1" stop-color="#050505"/>' +
    '</radialGradient>' +
    '<radialGradient id="bloom" cx="50%" cy="50%" r="50%">' +
    '<stop offset="0" stop-color="rgba(255,150,0,0.34)"/>' +
    '<stop offset="1" stop-color="rgba(255,120,0,0)"/>' +
    '</radialGradient>' +
    /* The halo of the LED mode, rebuilt as a filter: a tight bright ring first, a wide dim one behind it. */
    '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="16" result="wide"/>' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="tight"/>' +
    '<feFlood flood-color="#ff8a00" flood-opacity="0.55" result="warm"/>' +
    '<feFlood flood-color="#ffd08a" flood-opacity="0.85" result="hot"/>' +
    '<feComposite in="warm" in2="wide" operator="in" result="wideGlow"/>' +
    '<feComposite in="hot" in2="tight" operator="in" result="tightGlow"/>' +
    '<feMerge>' +
    '<feMergeNode in="wideGlow"/>' +
    '<feMergeNode in="tightGlow"/>' +
    '<feMergeNode in="SourceGraphic"/>' +
    '</feMerge>' +
    '</filter>' +
    '</defs>' +
    /* Full bleed background: iOS rounds the corners itself and never shows a border. */
    '<rect width="512" height="512" fill="url(#bg)"/>' +
    '<circle cx="256" cy="256" r="230" fill="url(#bloom)"/>' +
    '<g filter="url(#glow)">' +
    '<circle cx="256" cy="256" r="182" fill="none" stroke="' + AMBER + '" stroke-width="18"/>' +
    ticks +
    '<line x1="256" y1="256" x2="256" y2="160" stroke="' + CORE + '" stroke-width="26" stroke-linecap="round"' +
    ' transform="rotate(' + HOUR_ANGLE + ' 256 256)"/>' +
    '<line x1="256" y1="256" x2="256" y2="116" stroke="' + CORE + '" stroke-width="20" stroke-linecap="round"' +
    ' transform="rotate(' + MINUTE_ANGLE + ' 256 256)"/>' +
    '<circle cx="256" cy="256" r="16" fill="' + CORE + '"/>' +
    '</g>' +
    '</svg>';
}

function render(page, size) {
  var file = path.join(ICONS_DIR, 'icon-' + size + '.png');

  return page.setContent(
    '<body style="margin:0;background:#050505">' + svg(size) + '</body>'
  ).then(function () {
    return page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  }).then(function () {
    return page.screenshot({ path: file });
  }).then(function () {
    console.log('icons/icon-' + size + '.png');
  });
}

function main() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR);
  }

  var browser;

  puppeteer.launch({ args: ['--allow-file-access-from-files'] }).then(function (b) {
    browser = b;
    return b.newPage();
  }).then(function (page) {
    return SIZES.reduce(function (chain, size) {
      return chain.then(function () {
        return render(page, size);
      });
    }, Promise.resolve());
  }).then(function () {
    return browser.close();
  }).catch(function (error) {
    console.error(error);
    if (browser) {
      browser.close();
    }
    process.exit(1);
  });
}

main();
