/**
 * Subscribes to _db_updates events from CouchDB
 */

var couchr = require('couchr'),
    url = require('url');


/**
 * Subscribes a handler to db update events. Tries to use the
 * /_db_updates api if available, otherwise falls back to listening
 * to API proxy events
 */

exports.start = function (config, password, handler) {
    // add auth details to couch url
    var couch_url = url.parse(config.couch.url);
    couch_url.auth = 'admin:' + encodeURIComponent(password);
    exports.dbUpdatesAvailable(couch_url, function (err, enabled) {
        if (enabled) {
            console.log('[db_updates] using /_db_updates api');
            return exports.getUpdates(couch_url, handler);
        }
        else {
            // TODO: make sure workers use the /_api end point
            // otherwise we won't detect worker events!
            console.log('[db_updates] using api proxy fallback');
            config.api_db_events.on('updated', function (db) {
                console.log('[api db event] updated ' + db);
                handler(null, {type: 'updated', db_name: db});
            });
            config.api_db_events.on('deleted', function (db) {
                console.log('[api db event] deleted ' + db);
                handler(null, {type: 'deleted', db_name: db});
            });
            config.api_db_events.on('created', function (db) {
                console.log('[api db event] created ' + db);
                handler(null, {type: 'created', db_name: db});
            });
        }
    });
};

/**
 * Tests if the /_db_updates api is available at the provided
 * CouchDB URL
 */

exports.dbUpdatesAvailable = function (couch_url, callback) {
    var updates_url  = url.resolve(couch_url, '/_db_updates');
    couchr.get(updates_url, function (err, data, res) {
        if (res && res.statusCode === 400) {
            // Bad Request response due to 'illegal database name'
            // This means it doesn't recognise /_db_updates as
            // a special root-level handler
            return callback(null, false);
        }
        if (err) {
            return callback(err);
        }
        return callback(null, true);
    });
};

/**
 * Requests db_updates url from CouchDB, retries forever on errors
 */

exports.getUpdates = function (couch_url, handler, /*opt*/prev_error) {
    var updates_url  = url.resolve(couch_url, '/_db_updates');
    var q = {
        feed: 'continuous',
        heartbeat: true
    };
    var opt = {
        callback_on_data: handler,
        headers: {'Connection': 'Keep-Alive'}
    };
    couchr.request('GET', updates_url, q, opt, function (err, data) {
        if (err) {
            // log error from /_db_updates
            console.log('[db_updates] ' + err);
            // retry request, if first error, retry immediately,
            // otherwise wait 1 second before trying again
            return setTimeout(function () {
                exports.getUpdates(couch_url, handler, true);
            }, prev_error ? 1000: 0);
        }
        else {
            // successfully received db_update event
            return exports.getUpdates(couch_url, handler, false);
        }
    });
};
