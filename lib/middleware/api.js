/**
 * Serves the API, proxying relevant requests to CouchDB
 */

var http_proxy = require('http-proxy'),
    EventEmitter = require('events').EventEmitter,
    utils = require('../utils');


module.exports = function (config) {
    // make sure the couch host and port are set in config
    if (!config.couch.host || !config.couch.port) {
        return callback(new Error(
            'Please set the COUCH_URL environment variable'
        ));
    }

    // where to send requests
    var target = {
        port: config.couch.port,
        host: config.couch.host
    };

    // create a http proxy to CouchDB
    var proxy = new http_proxy.RoutingProxy({
        changeOrigin: true
    });

    // add event emitter to config for /_db_events fallback
    config.api_db_events = new EventEmitter();

    // return the proxy handler
    return function (req, res, next) {
        // ignore non-api requests
        if (!/^\/_api/.test(req.url)) {
            return next();
        }
        // remove the /_api part from url before proxying
        req.url = req.url.substr('/_api'.length);
        // catch any db create, update and delete events to emit
        res = exports.watchEvents(config, req, res);
        // proxy request to CouchDB
        proxy.proxyRequest(req, res, target);
    };
};

/**
 * Tests if the request is likely to cause a db_update event, and
 * captures information about the request to emit through the config
 * object later. This is used as a fallback for older versions of
 * CouchDB without the /_db_updates API.
 */

exports.watchEvents = function (config, req, res) {
    // split the path into parts
    var parts = req.url.replace(/^\/|\/$/, '').split('/');
    // store db name for emitting db event later
    var name = parts[0];
    if (name[0] !== '_' || name === '_users' || name === '_replicator') {
        // it's a db, not a special root-level handler
        if (!utils.safeMethod(req.method)) {
            // keep reference to original method
            var _writeHead = res.writeHead;
            // it may change state, check the response status code
            res.writeHead = function (code) {
                if (code >= 200 && code < 300) {
                    // success!
                    var type = 'updated';
                    if (parts.length === 1) {
                        // db-level operation
                        if (req.method === 'DELETE') {
                            type = 'deleted';
                        }
                        else if (req.method === 'PUT') {
                            type = 'created';
                        }
                    }
                    config.api_db_events.emit(type, name);
                }
                // now do actual writeHead call
                return _writeHead.apply(res, arguments);
            };
        }
    }
    return res;
};
