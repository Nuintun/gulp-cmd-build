'use strict';

var util = require('./lib/util');
var transform = require('./lib/transform');
var concat = require('./lib/concat');
var gutil = require('@nuintun/gulp-util');
var duplexer = require('@nuintun/duplexer');

/**
 * main
 * @param options
 * @returns {Duplexer}
 */
function main(options) {
  var input = transform(options);
  var output = concat();
  var duplex = duplexer({ objectMode: true }, input, output);

  input.pipe(output);

  return duplex;
}

main.cwd = gutil.cwd;
main.cache = util.cache;
main.debug = util.debug;
main.print = util.print;
main.colors = gutil.colors;
main.defaults = { plugins: gutil.plugins(require('./lib/plugins/index')) };

/**
 * exports module
 */
module.exports = main;
