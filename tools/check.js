/*
  Rendering checks for the clock.

  The page itself has no build step and no dependencies; this folder is the only
  place where Node is involved, and nothing in it ships to the iPad. It renders
  index.html in headless Chrome and answers three questions that are easy to get
  wrong by eye:

    fit         does the clock fit every iPad, in every mode, without overflow
                and without leaving the screen half empty
    brightness  do the date line and the digits glow at the same intensity
    shots       what does each mode actually look like right now

  Usage (from the repo root):

    cd tools
    npm install
    node check.js            all checks, screenshots into tools/shots
    node check.js fit
    node check.js brightness
    node check.js shots
*/

var puppeteer = require('puppeteer');
var path = require('path');
var fs = require('fs');
var PNG = require('pngjs').PNG;

var PAGE_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
var SHOTS_DIR = path.resolve(__dirname, 'shots');

/* Every iPad the clock is expected to run on, plus both orientations. */
var DEVICES = [
  { name: 'ipad-mini-landscape', width: 1024, height: 768 },
  { name: 'ipad-mini-portrait', width: 768, height: 1024 },
  { name: 'ipad-air-landscape', width: 1180, height: 820 },
  { name: 'ipad-pro-129-landscape', width: 1366, height: 1024 },
  { name: 'ipad-10-portrait', width: 820, height: 1180 }
];

var MODES = ['led', 'nixie', 'vfd', 'lcd', 'flat'];

/* Configurations that change the shape of the clock, not just its colours. */
var SHAPES = [
  { name: 'plain', settings: {} },
  { name: 'seconds-date', settings: { showSeconds: true, showDate: true } },
  { name: 'seconds-date-12h-bold', settings: { showSeconds: true, showDate: true, hour12: true, weight: 'bold', language: 'ru' } }
];

/*
  The clock is frozen at 10:08:42 so that screenshots are stable and never land
  inside the night dimming window, which would quietly halve every brightness
  measurement.
*/
function prepare(page, settings) {
  return page.evaluateOnNewDocument(function (saved) {
    window.localStorage.setItem('clockSettings', JSON.stringify(saved));

    var Real = Date;
    var fixed = new Real(2026, 6, 12, 10, 8, 42);

    window.Date = function () {
      return arguments.length ? new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(arguments))))() : new Real(fixed.getTime());
    };
    window.Date.now = function () { return fixed.getTime(); };
    window.Date.prototype = Real.prototype;
  }, settings);
}

function open(browser, device, settings) {
  return browser.newPage().then(function (page) {
    return page.setViewport({ width: device.width, height: device.height })
      .then(function () { return prepare(page, settings); })
      .then(function () { return page.goto(PAGE_URL, { waitUntil: 'load' }); })
      .then(function () { return new Promise(function (done) { setTimeout(done, 250); }); })
      .then(function () { return page; });
  });
}

function settingsFor(mode, extra) {
  var result = { mode: mode, theme: 'amber', autoDim: false };
  var key;

  for (key in extra) {
    if (extra.hasOwnProperty(key)) {
      result[key] = extra[key];
    }
  }

  return result;
}

/*
  Fit check.

  Overflow is a hard failure: a digit off the edge of an iPad is a broken clock.
  A clock that is far smaller than the screen allows is a softer failure, but it
  is the one this project keeps regressing into, so it is reported too. The digit
  row is wider than it is tall, so width is what runs out first: on a landscape
  iPad the digits should end up around 45% of the screen height, in portrait the
  row is width bound and lands much lower.
*/
function checkFit(browser) {
  var problems = [];
  var chain = Promise.resolve();

  DEVICES.forEach(function (device) {
    MODES.forEach(function (mode) {
      SHAPES.forEach(function (shape) {
        chain = chain.then(function () {
          return open(browser, device, settingsFor(mode, shape.settings)).then(function (page) {
            return page.evaluate(function () {
              var box = document.getElementById('clock').getBoundingClientRect();
              var digit = document.querySelector('.digit').getBoundingClientRect();

              return {
                left: box.left,
                top: box.top,
                right: box.right,
                bottom: box.bottom,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                widthUsed: box.width / window.innerWidth,
                digitHeight: Math.round(digit.height)
              };
            }).then(function (info) {
              var overflows = info.left < -1 || info.top < -1 ||
                info.right > info.viewportWidth + 1 || info.bottom > info.viewportHeight + 1;
              var wastesWidth = info.widthUsed < 0.9;

              if (overflows || wastesWidth) {
                problems.push({
                  device: device.name,
                  mode: mode,
                  shape: shape.name,
                  digitHeight: info.digitHeight,
                  widthUsed: Math.round(info.widthUsed * 100) + '%',
                  reason: overflows ? 'overflows the screen' : 'leaves the screen half empty'
                });
              }

              return page.close();
            });
          });
        });
      });
    });
  });

  return chain.then(function () {
    var total = DEVICES.length * MODES.length * SHAPES.length;

    if (problems.length) {
      console.log('FIT: ' + problems.length + ' of ' + total + ' layouts are wrong');
      problems.forEach(function (problem) {
        console.log('  ' + problem.device + ' / ' + problem.mode + ' / ' + problem.shape +
          ': ' + problem.reason + ' (digit ' + problem.digitHeight + 'px, width used ' + problem.widthUsed + ')');
      });
    } else {
      console.log('FIT: all ' + total + ' layouts fit and fill the screen');
    }

    return problems.length;
  });
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/*
  The core of a lit shape, not its halo: take the brightest 2% of the pixels in
  the region and average them. A single brightest pixel would be an antialiasing
  artefact; the mean over the whole region would be dominated by the dark gaps
  between strokes.
*/
function coreBrightness(png, box) {
  var values = [];
  var x;
  var y;
  var index;

  for (y = Math.round(box.top); y < Math.round(box.bottom); y++) {
    for (x = Math.round(box.left); x < Math.round(box.right); x++) {
      index = (png.width * y + x) << 2;
      values.push(luminance(png.data[index], png.data[index + 1], png.data[index + 2]));
    }
  }

  values.sort(function (a, b) { return b - a; });

  var take = Math.max(1, Math.round(values.length * 0.02));
  var sum = values.slice(0, take).reduce(function (a, b) { return a + b; }, 0);

  return Math.round(sum / take);
}

/*
  Brightness check.

  The date line is drawn as text and the digits are drawn as boxes, so nothing
  keeps them at the same intensity automatically - they have drifted apart twice
  already. This measures both instead of trusting the eye. Anything beyond 15%
  apart reads as two different displays stacked on top of each other.
*/
function checkBrightness(browser) {
  var failures = 0;
  var chain = Promise.resolve();
  var cases = [];

  ['led', 'vfd', 'nixie'].forEach(function (mode) {
    ['ice', 'amber', 'red', 'green'].forEach(function (theme) {
      cases.push({ mode: mode, theme: theme });
    });
  });

  cases.forEach(function (item) {
    chain = chain.then(function () {
      var settings = settingsFor(item.mode, { showDate: true });
      settings.theme = item.theme;

      return open(browser, DEVICES[0], settings).then(function (page) {
        return page.evaluate(function (mode) {
          var digit = document.querySelectorAll('.digit')[1];
          var lit = mode === 'nixie'
            ? digit.querySelector('.num.on')
            : digit.querySelector('.seg-b');
          var date = document.getElementById('date-line').getBoundingClientRect();
          var box = lit.getBoundingClientRect();

          return {
            digit: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
            date: { left: date.left, top: date.top, right: date.right, bottom: date.bottom }
          };
        }, item.mode).then(function (boxes) {
          return page.screenshot().then(function (buffer) {
            var png = PNG.sync.read(buffer);
            var digit = coreBrightness(png, boxes.digit);
            var date = coreBrightness(png, boxes.date);
            var ratio = date / digit;
            var wrong = ratio < 0.85 || ratio > 1.15;

            if (wrong) {
              failures++;
            }

            console.log('  ' + (wrong ? 'MISMATCH' : 'ok      ') + ' ' + item.mode + '/' + item.theme +
              ': digit ' + digit + ', date ' + date + ', ratio ' + ratio.toFixed(2));

            return page.close();
          });
        });
      });
    });
  });

  console.log('BRIGHTNESS: date line against the digits');

  return chain.then(function () {
    console.log(failures ? 'BRIGHTNESS: ' + failures + ' mismatched' : 'BRIGHTNESS: all modes match');
    return failures;
  });
}

/* One screenshot per mode, for the things a number cannot tell you. */
function takeShots(browser) {
  var chain = Promise.resolve();

  if (!fs.existsSync(SHOTS_DIR)) {
    fs.mkdirSync(SHOTS_DIR);
  }

  MODES.forEach(function (mode) {
    [SHAPES[0], SHAPES[1]].forEach(function (shape) {
      chain = chain.then(function () {
        return open(browser, DEVICES[0], settingsFor(mode, shape.settings)).then(function (page) {
          return page.screenshot({ path: path.join(SHOTS_DIR, mode + '-' + shape.name + '.png') })
            .then(function () { return page.close(); });
        });
      });
    });
  });

  return chain.then(function () {
    console.log('SHOTS: written to tools/shots');
    return 0;
  });
}

var what = process.argv[2] || 'all';

puppeteer.launch().then(function (browser) {
  var chain = Promise.resolve(0);

  if (what === 'all' || what === 'fit') {
    chain = chain.then(function (failed) {
      return checkFit(browser).then(function (count) { return failed + count; });
    });
  }

  if (what === 'all' || what === 'brightness') {
    chain = chain.then(function (failed) {
      return checkBrightness(browser).then(function (count) { return failed + count; });
    });
  }

  if (what === 'all' || what === 'shots') {
    chain = chain.then(function (failed) {
      return takeShots(browser).then(function (count) { return failed + count; });
    });
  }

  return chain.then(function (failed) {
    return browser.close().then(function () {
      process.exit(failed ? 1 : 0);
    });
  });
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
