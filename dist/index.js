/**
 * @module @nuintun/gulp-cmd
 * @author nuintun
 * @license MIT
 * @version 0.2.0
 * @description A gulp plugin for cmd transport and concat.
 * @see https://github.com/nuintun/gulp-cmd#readme
 */

'use strict';

const micromatch = require('micromatch');
const gutil = require('@nuintun/gulp-util');
const path = require('path');
const jsDeps = require('cmd-deps');
const cssDeps = require('@nuintun/css-deps');
const Bundler = require('@nuintun/bundler');
const through = require('@nuintun/through');

/**
 * @module utils
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @function resolve
 * @description Resolve a request path
 * @param {string} request
 * @param {string} referer
 * @param {Object} options
 * @returns {string}
 */
function resolve(request, referer, options) {
  // Resolve
  if (gutil.isAbsolute(request)) {
    request = path.join(options.root, request);
  } else if (gutil.isRelative(request)) {
    request = path.join(path.dirname(referer), request);

    // Out of bounds of root
    if (gutil.isOutBounds(request, options.root)) {
      throw new RangeError(`File ${gutil.normalize(request)} is out of bounds of root.`);
    }
  } else {
    const base = options.base || path.dirname(referer);

    // Use base or referer dirname
    request = path.join(base, request);
  }

  return request;
}

/**
 * @function parseAlias
 * @param {string} id
 * @param {Object} alias
 * @returns {string}
 */
function parseAlias(id, alias) {
  return alias && gutil.typpy(alias[id], String) ? alias[id] : id;
}

/**
 * @function fileExt
 * @param {string} path
 * @returns {string}
 */
function fileExt(path$$1) {
  return path.extname(path$$1).toLowerCase();
}

/**
 * @function addExt
 * @description Add .js if not exists
 * @param {string} path
 * @returns {string}
 */
function addExt(path$$1) {
  return `${path$$1}.js`;
}

/**
 * @function hideExt
 * @description Hide .js if exists
 * @param {string} path
 * @returns {string}
 */
function hideExt(path$$1) {
  return path$$1.replace(/([^/]+)\.js$/i, '$1');
}

/**
 * @function isIgnoreModule
 * @param {string} module
 * @param {Object} options
 * @return {boolean}
 */
function isIgnoreModule(module, options) {
  const cache = options.micromatch;

  if (cache.has(module)) return cache.get(module);

  const ignored = micromatch(module, options.ignore).length > 0;

  cache.set(module, ignored);

  return ignored;
}

/**
 * @function initOptions
 * @param {Object} options
 * @returns {Object}
 */
function initOptions(options) {
  options = gutil.inspectAttrs(options, {
    root: {
      type: String,
      default: process.cwd()
    },
    base: {
      required: true,
      type: String,
      onRequired: 'Options.%s is required.',
      onTypeError: 'Options.%s must be a string.'
    },
    js: { type: Object, default: {} },
    css: { type: Object, default: {} },
    alias: { type: Object, default: {} },
    indent: { type: Number, default: 2 },
    ignore: { type: Array, default: [] },
    plugins: { type: Array, default: [] },
    packagers: { type: Object, default: {} },
    strict: { type: Boolean, default: true },
    map: { type: [null, Function], default: null },
    combine: { type: [Boolean, Function], default: false },
    'js.flags': { type: Array, default: ['async'] },
    'css.loader': { type: String, default: 'css-loader' },
    'css.onpath': { type: [null, Function], default: null }
  });

  // Init root and base
  options.root = path.resolve(options.root);
  options.base = path.resolve(options.root, options.base);

  // The base out of bounds of root
  if (gutil.isOutBounds(options.base, options.root)) {
    throw new TypeError('Options.base is out bounds of options.root.');
  }

  // Assert css loader
  if (!options.css.loader) {
    throw new TypeError(`Options.css.loader must be a nonempty string.`);
  }

  // Init files cache
  options.cache = new Map();
  // Init loaders cache
  options.loaders = new Map();
  // Init micromatch cache
  options.micromatch = new Map();
  // Init ignore
  options.ignore = Array.from(
    options.ignore.reduce((patterns, pattern) => {
      if (!patterns.has(pattern) && gutil.typpy(pattern, String)) {
        // Preserve the "!" prefix so that micromatch can use it for negation.
        const negate = pattern.startsWith('!');

        if (negate) pattern = pattern.slice(1);

        pattern = gutil.unixify(path.resolve(pattern));

        if (negate) pattern = `!${pattern}`;

        patterns.add(pattern);
      }

      return patterns;
    }, new Set())
  );

  // Init combine
  const combine = options.combine;
  const fnCombine = gutil.typpy(combine, Function);

  options.combine = module => (fnCombine ? combine(module) : combine);

  // Freeze
  options.js = Object.freeze(options.js);
  options.css = Object.freeze(options.css);

  // Can not override js packager
  delete options.packagers.js;

  // Freeze
  return Object.freeze(options);
}

/**
 * @function moduleId
 * @description Parse module id form src
 * @param {string} src
 * @param {Object} base
 * @returns {string|null}
 */
function moduleId(src, options) {
  const root = options.root;

  // Vinyl not in base dir, user root
  if (gutil.isOutBounds(src, root)) {
    // Stringify file path
    const fpath = JSON.stringify(gutil.normalize(src));

    // Output error
    throw new RangeError(`Module ${fpath} is out of bounds of root.`);
  }

  const base = options.base;
  const isOutBase = gutil.isOutBounds(src, base);
  const repath = path.relative(isOutBase ? root : base, src);
  const id = (isOutBase ? '/' : '') + gutil.normalize(repath);

  // Return id
  return id;
}

/**
 * @function resolveModuleId
 * @param {string} src
 * @param {Object} options
 * @returns {string|null}
 */
function resolveModuleId(src, options) {
  let id = null;
  const base = options.base;

  // Parse module id
  id = moduleId(src, options);
  // Parse map
  id = gutil.parseMap(id, src, options.map);
  id = gutil.normalize(id);
  id = hideExt(id);

  // Add ext
  if (fileExt(id) === '.css') id = addExt(id);

  return id;
}

const LINEFEED_RE = /[\r\n]+/g;

/**
 * @function wrapModule
 * @param {string} id
 * @param {Array|Set} deps
 * @param {string} code
 * @param {boolean} strict
 * @param {number} indent
 * @returns {string}
 */
function wrapModule(id, deps, code, options) {
  const strict = options.strict;
  const indent = options.indent;

  id = JSON.stringify(id);
  deps = JSON.stringify(Array.from(deps), null, indent);

  if (strict !== false) {
    code = `'use strict';\n\n${code}`;
  }

  if (indent > 0) {
    const pad = new Array(indent + 1).join(' ');

    code = pad + code.replace(LINEFEED_RE, `$&${pad}`);
  }

  // Header and footer template string
  const header = `define(${id}, ${deps}, function(require, exports, module){\n`;
  const footer = '\n});\n';

  return header + code + footer;
}

/**
 * @module js
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @namespace jsPackager
 */
const jsPackager = {
  /**
   * @property module
   * @type {boolean}
   */
  module: true,
  /**
   * @method resolve
   * @param {string} path
   * @returns {string}
   */
  resolve(path$$1) {
    return path$$1;
  },
  /**
   * @method parse
   * @param {string} path
   * @param {string} contents
   * @param {Object} options
   * @returns {Object}
   */
  parse(path$$1, contents, options) {
    const root = options.root;
    const base = options.base;

    // Metadata
    const id = resolveModuleId(path$$1, options);
    const dependencies = new Set();
    const modules = new Set();

    // Parse module
    const meta = jsDeps(
      contents,
      (dependency, flag) => {
        dependency = parseAlias(dependency, options.alias);

        // Only collect local bependency
        if (!gutil.isUrl(dependency)) {
          // Normalize
          dependency = gutil.normalize(dependency);

          // If path end with /, use index.js
          if (dependency.endsWith('/')) dependency += 'index.js';

          // Resolve dependency
          let resolved = resolve(dependency, path$$1, { root, base });

          // Only collect require no flag
          if (flag === null) {
            // If has ext and module can read
            if (fileExt(resolved) && gutil.fsSafeAccess(resolved)) {
              !isIgnoreModule(resolved, options) && modules.add(resolved);
            } else {
              // Module can't read, add ext test again
              resolved = addExt(resolved);

              // Module can read
              if (gutil.fsSafeAccess(resolved)) {
                !isIgnoreModule(resolved, options) && modules.add(resolved);
              } else {
                // Relative path from cwd
                const rpath = JSON.stringify(gutil.path2cwd(path$$1));

                // Output warn
                gutil.logger.warn(
                  gutil.chalk.yellow(`Module ${JSON.stringify(dependency)} at ${rpath} can't be found.`),
                  '\x07'
                );
              }
            }
          }

          // Parse map
          dependency = gutil.parseMap(dependency, resolved, options.map);
          dependency = gutil.normalize(dependency);
          dependency = hideExt(dependency);

          // The seajs has hacked css before 3.0.0
          // https://github.com/seajs/seajs/blob/2.2.1/src/util-path.js#L49
          // Demo https://github.com/popomore/seajs-test/tree/master/css-deps
          if (fileExt(dependency) === '.css') dependency = addExt(dependency);

          // Add dependency
          dependencies.add(dependency);
        }

        // Return dependency
        return dependency;
      },
      {
        flags: options.js.flags,
        allowReturnOutsideFunction: true
      }
    );

    // Get contents
    contents = meta.code;

    return { id, dependencies, contents, modules };
  },
  /**
   * @method transform
   * @param {string} id
   * @param {Set} dependencies
   * @param {string} contents
   * @param {Object} options
   * @returns {string}
   */
  transform(id, dependencies, contents, options) {
    return contents;
  }
};

/**
 * @module loaders
 * @license MIT
 * @version 2018/03/30
 */

/**
 * @function registerLoader
 * @param {string} loader
 * @param {string} id
 * @param {Object} options
 * @returns {object}
 */
async function registerLoader(loader, id, options) {
  const loaders = options.loaders;

  // Hit cache
  if (loaders.has(loader)) return loaders.get(loader);

  // Normalize id
  id = gutil.normalize(id);

  // If id end with /, use index.js
  if (id.endsWith('/')) dependency += 'index.js';

  // Add ext
  id = fileExt(id) === '.js' ? id : addExt(id);

  const root = options.root;
  const base = options.base;
  const cache = options.cache;
  const plugins = options.plugins;

  // Get path
  let path$$1 = path.join(gutil.isAbsolute(id) ? root : base, id);

  // Resolve module id
  id = resolveModuleId(path$$1, options);

  // Dependencies
  const dependencies = new Set();
  // Get real path and stat
  const fpath = require.resolve(`./builtins/loaders/${loader}`);
  const stat = await gutil.fsReadStat(fpath);

  // Read file contents
  let contents = await gutil.fsReadFile(fpath);

  // Get code
  contents = contents.toString();

  // Execute loaded hook
  contents = await gutil.pipeline(plugins, 'loaded', path$$1, contents, { root, base });
  // Execute parsed hook
  contents = await gutil.pipeline(plugins, 'parsed', path$$1, contents, { root, base });
  // Transform code
  contents = await jsPackager.transform(id, dependencies, contents, options);

  // If is module then wrap module
  if (jsPackager.module) contents = wrapModule(id, dependencies, contents, options);

  // Resolve path
  path$$1 = await jsPackager.resolve(path$$1);
  // Execute transformed hook
  contents = await gutil.pipeline(plugins, 'transformed', path$$1, contents, { root, base });

  // To buffer
  contents = gutil.buffer(contents);

  // Create vinyl file
  const vinyl = new gutil.VinylFile({ base, path: path$$1, stat, contents });

  // Set cache
  loaders.set(loader, { id, path: path$$1, vinyl });
  cache.set(path$$1, { path: path$$1, dependencies, contents });

  // Return meta
  return { id, path: path$$1, vinyl };
}

/**
 * @module css
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @namespace cssPackager
 */
const css = {
  /**
   * @property module
   * @type {boolean}
   */
  module: true,
  /**
   * @method resolve
   * @param {string} path
   * @returns {string}
   */
  resolve(path$$1) {
    return addExt(path$$1);
  },
  /**
   * @method parse
   * @param {string} path
   * @param {string} contents
   * @param {Object} options
   * @returns {Object}
   */
  async parse(path$$1, contents, options) {
    const root = options.root;
    const loader = options.css.loader;
    const { id: loaderId, path: loaderPath } = await registerLoader('css', loader, options);

    // Metadata
    const id = resolveModuleId(path$$1, options);
    const dependencies = new Set([loaderId]);
    const modules = new Set(isIgnoreModule(loaderPath, options) ? [] : [loaderPath]);

    /**
     * @function onpath
     * @param {string} prop
     * @param {string} value
     */
    const onpath = (prop, value) => {
      // Normalize value
      value = gutil.isUrl(value) ? value : gutil.normalize(value);

      // Get onpath
      const onpath = options.css.onpath;

      // Returned value
      return onpath ? onpath(prop, value, path$$1) : value;
    };

    // Parse module
    const meta = cssDeps(
      contents,
      (dependency, media) => {
        if (gutil.isUrl(dependency)) {
          // Relative file path from cwd
          const rpath = JSON.stringify(gutil.path2cwd(path$$1));

          // Output warn
          gutil.logger.warn(
            gutil.chalk.yellow(`Found remote css file ${JSON.stringify(dependency)} at ${rpath}, unsupported.`),
            '\x07'
          );
        } else {
          if (media.length) {
            // Get media
            media = JSON.stringify(media.join(', '));

            // Relative file path from cwd
            const rpath = JSON.stringify(gutil.path2cwd(path$$1));

            // Output warn
            gutil.logger.warn(
              gutil.chalk.yellow(`Found import media queries ${media} at ${rpath}, unsupported.`),
              '\x07'
            );
          }

          // Normalize
          dependency = gutil.normalize(dependency);

          // Resolve dependency
          let resolved = resolve(dependency, path$$1, { root });

          // Module can read
          if (gutil.fsSafeAccess(resolved)) {
            !isIgnoreModule(resolved, options) && modules.add(resolved);
          } else {
            // Relative file path from cwd
            const rpath = JSON.stringify(gutil.path2cwd(path$$1));

            // Output warn
            gutil.logger.warn(
              gutil.chalk.yellow(`Module ${JSON.stringify(dependency)} at ${rpath} can't be found.`),
              '\x07'
            );
          }

          // Use css resolve rule
          if (!gutil.isRelative(dependency)) dependency = `./${dependency}`;

          // Parse map
          dependency = gutil.parseMap(dependency, resolved, options.map);
          dependency = gutil.normalize(dependency);
          // The seajs has hacked css before 3.0.0
          // https://github.com/seajs/seajs/blob/2.2.1/src/util-path.js#L49
          // Demo https://github.com/popomore/seajs-test/tree/master/css-deps
          dependency = addExt(dependency);

          // Add dependency
          dependencies.add(dependency);
        }

        return false;
      },
      { onpath, media: true }
    );

    // Get contents
    contents = meta.code;

    return { id, dependencies, contents, modules };
  },
  /**
   * @method transform
   * @param {string} id
   * @param {Set} dependencies
   * @param {string} contents
   * @param {Object} options
   * @returns {string}
   */
  async transform(id, dependencies, contents, options) {
    let requires = '';
    const loader = options.css.loader;
    const { id: loaderId } = await registerLoader('css', loader, options);

    dependencies.forEach(dependency => {
      if (dependency === loaderId) {
        requires += `const loader = require(${JSON.stringify(loaderId)});\n\n`;
      } else {
        requires += `require(${JSON.stringify(dependency)});\n`;
      }

      return requires;
    });

    if (dependencies.size > 1) requires += '\n';

    contents = `${requires}loader(${JSON.stringify(contents)});`;

    return contents;
  }
};

/**
 * @module json
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @namespace jsonPackager
 */
const json = {
  /**
   * @property module
   * @type {boolean}
   */
  module: true,
  /**
   * @method resolve
   * @param {string} path
   * @returns {string}
   */
  resolve(path$$1) {
    return addExt(path$$1);
  },
  /**
   * @method parse
   * @param {string} path
   * @param {string} contents
   * @param {Object} options
   * @returns {Object}
   */
  parse(path$$1, contents, options) {
    // Metadata
    const id = resolveModuleId(path$$1, options);
    const dependencies = new Set();
    const modules = new Set();

    return { id, dependencies, contents, modules };
  },
  /**
   * @method transform
   * @param {string} id
   * @param {Set} dependencies
   * @param {string} contents
   * @param {Object} options
   * @returns {string}
   */
  transform(id, dependencies, contents, options) {
    contents = `module.exports = ${contents};`;

    return contents;
  }
};

/**
 * @module html
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @namespace htmlPackager
 */
const html = {
  /**
   * @property module
   * @type {boolean}
   */
  module: true,
  /**
   * @method resolve
   * @param {string} path
   * @returns {string}
   */
  resolve(path$$1) {
    return addExt(path$$1);
  },
  /**
   * @method parse
   * @param {string} path
   * @param {string} contents
   * @param {Object} options
   * @returns {Object}
   */
  parse(path$$1, contents, options) {
    // Metadata
    const id = resolveModuleId(path$$1, options);
    const dependencies = new Set();
    const modules = new Set();

    return { id, dependencies, contents, modules };
  },
  /**
   * @method transform
   * @param {string} id
   * @param {Set} dependencies
   * @param {string} contents
   * @param {Object} options
   * @returns {string}
   */
  transform(id, dependencies, contents, options) {
    contents = `module.exports = ${JSON.stringify(contents)};`;

    return contents;
  }
};

/**
 * @module index
 * @license MIT
 * @version 2018/03/26
 */

const packagers = /*#__PURE__*/(Object.freeze || Object)({
  html: html,
  tpl: html,
  js: jsPackager,
  css: css,
  json: json
});

/**
 * @module parser
 * @license MIT
 * @version 2018/03/30
 */

/**
 * @function parser
 * @param {Vinyl} vinyl
 * @param {Object} options
 * @returns {Object}
 */
async function parser(vinyl, options) {
  let path$$1 = vinyl.path;
  let dependencies = new Set();
  let contents = vinyl.contents;

  const ext = vinyl.extname.slice(1).toLowerCase();
  const packager = options.packagers[ext] || packagers[ext];

  if (packager) {
    const root = options.root;
    const base = options.base;
    const plugins = options.plugins;

    // Get code
    contents = contents.toString();

    // Execute loaded hook
    contents = await gutil.pipeline(plugins, 'loaded', path$$1, contents, { root, base });

    // Parse metadata
    const meta = await packager.parse(path$$1, contents, options);

    // Override contents
    contents = meta.contents;

    // Execute parsed hook
    contents = await gutil.pipeline(plugins, 'parsed', path$$1, contents, { root, base });
    // Transform code
    contents = await packager.transform(meta.id, meta.dependencies, contents, options);

    // If is module then wrap module
    if (packager.module) contents = wrapModule(meta.id, meta.dependencies, contents, options);

    // Resolve path
    path$$1 = await packager.resolve(path$$1);
    // Execute transformed hook
    contents = await gutil.pipeline(plugins, 'transformed', path$$1, contents, { root, base });

    // Override dependencies
    dependencies = meta.modules;

    // To buffer
    contents = gutil.buffer(contents);
  }

  return { path: path$$1, dependencies, contents };
}

/**
 * @module bundler
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @function bundler
 * @param {Vinyl} vinyl
 * @param {Object} options
 * @returns {Vinyl}
 */
async function bundler(vinyl, options) {
  const input = vinyl.path;
  const root = options.root;
  const base = options.base;
  const cache = options.cache;

  // Is combine
  const combine = options.combine(input);

  // Bundler
  const bundles = await new Bundler({
    input,
    resolve: path$$1 => path$$1,
    parse: async path$$1 => {
      let meta;
      // Is entry file
      const entry = input === path$$1;

      // Hit cache
      if (cache.has(path$$1)) {
        meta = cache.get(path$$1);
      } else {
        const file = entry ? vinyl : await gutil.fetchModule(path$$1, options);

        // Execute parser
        meta = await parser(file, options);

        // Set cache
        cache.set(path$$1, meta);
      }

      // Override path
      path$$1 = meta.path;

      // Get meta
      const dependencies = combine ? meta.dependencies : new Set();
      const contents = meta.contents;

      // If is entry file override file path
      if (entry) vinyl.path = path$$1;

      // Return meta
      return { path: path$$1, dependencies, contents };
    }
  });

  // Combine files
  vinyl.contents = gutil.combine(bundles);

  return vinyl;
}

/**
 * @module index
 * @license MIT
 * @version 2018/03/26
 */

/**
 * @function main
 * @param {Object} options
 */
function main(options) {
  options = initOptions(options);

  // Stream
  return through(
    async function(vinyl, encoding, next) {
      vinyl = gutil.VinylFile.wrap(vinyl);
      vinyl.base = options.base;

      // Throw error if stream vinyl
      if (vinyl.isStream()) {
        return next(new TypeError('Streaming not supported.'));
      }

      // Return empty vinyl
      if (vinyl.isNull()) {
        return next(null, vinyl);
      }

      // Bundler
      try {
        vinyl = await bundler(vinyl, options);
      } catch (error) {
        return next(error);
      }

      // Next
      next(null, vinyl);
    },
    function(next) {
      const combine = options.combine;

      options.loaders.forEach(loader => {
        if (!combine(loader.path) || isIgnoreModule(loader.path, options)) {
          this.push(loader.vinyl);
        }
      });

      // Clear cache
      options.cache.clear();
      options.loaders.clear();
      options.micromatch.clear();

      // Next
      next();
    }
  );
}

// Exports
main.chalk = gutil.chalk;
main.logger = gutil.logger;

module.exports = main;
