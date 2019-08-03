'use strict';

const fs = require('fs');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const IPAccessControl = require('@mdbarr/ip-access-control');

function SMTP(skyfall, options) {
  const id = skyfall.utils.id();

  let port = 25;
  let host = '0.0.0.0';
  let secure = false;

  const callbacks = {};

  //////////

  const users = new Map();
  this.addUser = (username, password) => {
    users.set(username, password);
  };

  const domains = new Set();
  this.addDomain = (domain) => {
    domains.add(domain);
  };

  let accessControl = null;
  this.setAccess = (access) => {
    accessControl = new IPAccessControl(access);
  };

  //////////

  const onAuth = (auth, session, callback) => {
    if (callbacks.onAuth && typeof callbacks.onAuth === 'function') {
      if (callbacks.onAuth.length === 3) {
        return callbacks.onAuth(auth, session, callback);
      }
      const result = callbacks.onAuth(auth, session);
      return callback(null, result);
    } else if (users.size) {
      if (users.has(auth.username) && users.get(auth.username) === auth.password) {
        return callback(null, { user: auth.username });
      }
      return callback(new Error('Invalid username or password'));
    }
    return callback(null, { user: auth.username });
  };

  const onConnect = (session, callback) => {
    if (callbacks.onConnect && typeof callbacks.onConnect === 'function') {
      if (callbacks.onConnect.length === 2) {
        return callbacks.onConnect(session, callback);
      }
      if (callbacks.onConnection(session)) {
        return callback();
      }
      return callback(new Error(`Connection not allowed from ${ session.remoteAddress }`));
    } else if (accessControl && typeof accessControl.check === 'function') {
      if (accessControl.check(session.remoteAddress)) {
        return callback();
      }
      return callback(new Error(`Connection not allowed from ${ session.remoteAddress }`));
    }
    return callback();
  };

  const onMailFrom = (address, session, callback) => {
    if (callbacks.onMailFrom && typeof callbacks.onMailFrom === 'function') {
      if (callback.onMailFrom.length === 3) {
        return callbacks.onMailFrom(address, session, callback);
      }
      if (callbacks.onMailFrom(address, session)) {
        return callback();
      }
      return callback(new Error(`Mail from ${ address.address } not accepted`));
    }
    return callback();
  };

  const onRcptTo = (address, session, callback) => {
    if (callbacks.onRcptTo && typeof callbacks.onRcptTo === 'function') {
      if (callbacks.onRcptTo.length === 3) {
        return callbacks.onRcptTo(address, session, callback);
      }
      if (callbacks.onRcptTo(address, session)) {
        return callback();
      }
      return callback(new Error(`Mail to ${ address.address } not accepted`));
    } else if (domains.size) {
      const domain = address.address.replace(/^.*@/, '');
      if (domains.has(domain)) {
        return callback();
      }
      return callback(new Error(`Mail to ${ address.address } not accepted`));
    }
    return callback();
  };

  const onData = (stream, session, callback) => {
    simpleParser(stream, (error, message) => {
      if (error) {
        skyfall.events.emit({
          type: 'smtp:server:error',
          data: error,
          source: id
        });

        return callback(error);
      }

      skyfall.events.emit({
        type: 'smtp:server:message',
        data: {
          ...message,
          session
        },
        source: id
      });

      return callback();
    });
  };

  //////////

  this.configure = (config) => {
    secure = Boolean(config.secure || config.port === 465);

    if (!config.port || config.port === 'auto') {
      port = secure ? 465 : 587
    } else {
      port = Number(config.port) || 587;
    }

    if (config.host) {
      host = config.host;
    }

    if (config.users) {
      for (const user in config.users) {
        users.set(user, config.users[user]);
      }
    }

    if (config.domain) {
      domains.add(config.domain);
    }
    if (config.domains) {
      for (const domain of config.domains) {
        domains.add(domain);
      }
    }

    if (config.access) {
      accessControl = new IPAccessControl(config.acess);
    }

    callbacks.onAuth = config.onAuth || null;
    callbacks.onConnect = config.onConnect || null;
    callbacks.onMailFrom = config.onMailFrom || null;
    callbacks.onRcptTo = config.onRcptTo || null;

    this.server = new SMTPServer({
      secure,
      key: config.key ? fs.readFileSync(config.key) : null,
      cert: config.certificate || config.cert ?
        fs.readFileSync(config.certificate || config.cert) : null,
      name: config.name || 'skyfall-smtp-server',
      size: Number(config.size) || 10485760, // 10MB
      authOptional: config.authOptional !== undefined ? config.authOptional :
        !(users.size || callbacks.onAuth),
      allowInsecureAuth: config.allowInsecureAuth !== undefined ?
        config.allowInsecureAuth : true,
      disableReverseLookup: config.disableReverseLookup !== undefined ?
        config.disableReverseLookup : false,
      maxClients: config.maxClients || Infinity,
      useProxy: config.useProxy !== undefined ? config.useProxy : false,
      lmtp: config.lmtp !== undefined ? config.lmtp : false,
      socketTimeout: Number(config.socketTimeout) || 60000, // 60s
      closeTimeout: Number(config.closeTimeout) || 30000, // 30s
      onAuth,
      onConnect,
      onMailFrom,
      onRcptTo,
      onData
    });

    this.server.on('error', (error) => {
      skyfall.events.emit({
        type: 'smtp:server:error',
        data: error,
        source: id
      });
    });

    this.configuration = {
      id,
      port,
      host,
      mode: config.lmtp ? 'lmtp' : 'smtp'
    };

    skyfall.utils.hidden(this.configuration, 'start', this.start);

    return this.configuration;
  };

  this.start = (callback) => {
    if (!this.server || !this.configuration) {
      const error = new Error('smtp server not configured');

      skyfall.events.emit({
        type: 'smtp:server:error',
        data: error,
        source: id
      });

      if (callback) {
        return callback(error);
      }
      return error;
    }

    skyfall.events.emit({
      type: 'smtp:server:starting',
      data: this.configuration,
      source: id
    });

    return this.server.listen(port, host, (error) => {
      if (error) {
        skyfall.events.emit({
          type: 'smtp:server:error',
          data: error,
          source: id
        });

        if (callback) {
          return callback(error);
        }
        return error;
      }

      skyfall.events.emit({
        type: 'smtp:server:started',
        data: this.configuration,
        source: id
      });

      if (callback) {
        return callback();
      }
      return this.configuration;
    });
  };

  if (Object.keys(options).length) {
    this.configure(options);
  }
}

module.exports = {
  name: 'smtp',
  install: (skyfall, options) => {
    skyfall.smtp = new SMTP(skyfall, options);
  }
};
