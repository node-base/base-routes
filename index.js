'use strict';

var debug = require('debug')('base:routes');
var rethrow = require('template-error');
var router = require('en-route');
var utils = require('./utils');

module.exports = function(options) {
  return function baseRoutes(app) {
    if (!utils.isValid(app)) return;

    /**
     * The `Router` and `Route` classes are on the `app` instance,
     * in case they need to be accessed directly.
     *
     * ```js
     * var router = new app.Router();
     * var route = new app.Route();
     * ```
     * @api public
     */

    this.Router = router.Router;
    this.Route = router.Route;

    /**
     * Lazily initalize `router`, to allow options and
     * custom methods to be defined after instantiation.
     */

    this.define('lazyRouter', function(methods) {
      if (this.router == null) {
        this.router = new this.Router({methods: utils.methods});
      }
      if (typeof methods !== 'undefined') {
        this.router.method(methods);
      }
    });

    /**
     * Handle middleware `method` for the given `file`.
     *
     * ```js
     * app.handle('methodName', file, next);
     * ```
     * @name .handle
     * @param {String} `methodName` Name of the router method to handle.
     * @param {Object} `file` View object
     * @param {Function} `next` Callback function
     * @return {undefined}
     * @api public
     */

    this.define('handle', function(method, file, next) {
      debug('handling "%s" middleware for "%s"', method, file.basename);
      this.lazyRouter();

      if (typeof next !== 'function') {
        next = function(err, file) {
          app.handleError(method, file, function() {
            throw err;
          });
        };
      }

      file.options = file.options || {};
      if (!file.options.handled) {
        file.options.handled = [];
      }

      // set router method on file.options
      file.options.method = method;
      file.options.handled.push(method);
      this.emit(method, file);

      // create callback
      var cb = this.handleError(method, file, next);

      // if not an instance of `Templates`, or if we're inside a collection
      // or the collection is not specified on file.options just handle the route and return
      if (!this.isTemplates || this.isCollection || !file.options.collection) {
        this.router.handle(file, cb);
        return;
      }

      // handle the app routes first, then handle the collection routes
      var collection = this[file.options.collection];

      this.router.handle(file, function(err) {
        if (err) {
          cb(err);
          return;
        }
        collection.handle(method, file, cb);
      });
    });

    /**
     * Run the given middleware handler only if the file has not
     * already been handled by `method`.
     *
     * ```js
     * app.handleOnce(method, file, callback);
     * // example
     * app.handleOnce('onLoad', file, callback);
     * ```
     * @name .handleOnce
     * @param  {Object} `method` The name of the handler method to call.
     * @param  {Object} `file`
     * @return {undefined}
     * @api public
     */

    this.define('handleOnce', function(method, file, next) {
      if (!file.options.handled) {
        file.options.handled = [];
      }

      if (typeof next !== 'function') {
        next = file.next;
      }

      if (file.options.handled.indexOf(method) === -1) {
        this.handle(method, file, next);
        return;
      }
      next(null, file);
    });

    /**
     * Handle middleware errors.
     */

    this.define('handleError', function(method, file, next) {
      var app = this;
      return function(err) {
        next = next || file.next;

        if (typeof next !== 'function') {
          throw new TypeError('expected a callback function');
        }

        if (err) {
          if (err._handled === true) {
            next();
            return;
          }

          err._handled = true;
          err.source = err.stack.split('\n')[1].trim();
          err.reason = app._name + '#handle("' + method + '"): ' + file.path;
          err.file = file;

          if (app.hasListeners('error')) {
            app.emit('error', err);
          }

          if (typeof next !== 'function') {
            throw err;
          }

          if (err instanceof ReferenceError) {
            try {
              rethrow(file.content, file.data);
            } catch (e) {
              next(e);
              return;
            }
          }

          next(err);
          return;
        }
        next(null, file);
      };
    });

    /**
     * Create a new Route for the given path. Each route
     * contains a separate middleware stack. See the [en-route][]
     * API documentation for details on adding handlers and
     * middleware to routes.
     *
     * ```js
     * app.create('posts');
     * app.route(/blog/)
     *   .all(function(file, next) {
     *     // do something with file
     *     next();
     *   });
     *
     * app.post('whatever', {path: 'blog/foo.bar', content: 'bar baz'});
     * ```
     * @name .route
     * @param {String} `path`
     * @return {Object} Returns the instance for chaining.
     * @api public
     */

    this.define('route', function(/*path*/) {
      this.lazyRouter();
      return this.router.route.apply(this.router, arguments);
    });

    /**
     * Add callback triggers to route parameters, where
     * `name` is the name of the parameter and `fn` is the
     * callback function.
     *
     * ```js
     * app.param('title', function(view, next, title) {
     *   //=> title === 'foo.js'
     *   next();
     * });
     *
     * app.onLoad('/blog/:title', function(view, next) {
     *   //=> view.path === '/blog/foo.js'
     *   next();
     * });
     * ```
     * @name .param
     * @param {String} `name`
     * @param {Function} `fn`
     * @return {Object} Returns the instance for chaining.
     * @api public
     */

    this.define('param', function(/*name, fn*/) {
      this.lazyRouter();
      this.router.param.apply(this.router, arguments);
      return this;
    });

    /**
     * Special route method that works just like the
     * `router.METHOD()` methods, except that it matches
     * all verbs.
     *
     * ```js
     * app.all(/\.hbs$/, function(view, next) {
     *   // do stuff to view
     *   next();
     * });
     * ```
     * @name .all
     * @param {String} `path`
     * @param {Function} `callback`
     * @return {Object} `this` for chaining
     * @api public
     */

    this.define('all', function(path/*, callback*/) {
      this.lazyRouter();
      var route = this.route(path);
      route.all.apply(route, [].slice.call(arguments, 1));
      return this;
    });

    /**
     * Add a router handler method to the instance. Interchangeable
     * with the [handlers]() method.
     *
     * ```js
     * app.handler('onFoo');
     * // or
     * app.handler(['onFoo', 'onBar']);
     * ```
     * @name .handler
     * @param  {String} `method` Name of the handler method to define.
     * @return {Object} Returns the instance for chaining
     * @api public
     */

    this.define('handler', function(method) {
      this.handlers(method);
      return this;
    });

    /**
     * Add one or more router handler methods to the instance.
     *
     * ```js
     * app.handlers(['onFoo', 'onBar', 'onBaz']);
     * // or
     * app.handlers('onFoo');
     * ```
     * @name .handlers
     * @param {Array|String} `methods` One or more method names to define.
     * @return {Object} Returns the instance for chaining
     * @api public
     */

    this.define('handlers', function(methods) {
      this.lazyRouter(methods);
      mixinHandlers(methods);
      return this;
    });

    function mixinHandlers(methods) {
      utils.arrayify(methods).forEach(function(method) {
        app.define(method, function(path) {
          var route = this.route(path);
          var args = [].slice.call(arguments, 1);
          route[method].apply(route, args);
          return this;
        });
      });
    }

    // Mix router handler methods onto the intance
    mixinHandlers(utils.methods);
    return baseRoutes;
  };
};
