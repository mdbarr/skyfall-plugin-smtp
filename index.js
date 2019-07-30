'use strict';

const fs = require('fs');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');

function SMTP(skyfall, options) {
  this.id = skyfall.utils.id();

  this.callbacks = {
    onAuth: null,
    onConnect: null,
    onMailFrom: null,
    onRcptTo: null
  };

  const onAuth = (auth, session, callback) => {
    if (this.callbacks.onAuth && typeof this.callbacks.onAuth === 'function') {
      return this.callbacks.onAuth(auth, session, callback);
    }
    return callback(null, { user: auth.username });
  };

  const onConnect = (session, callback) => {
    console.log(session.remoteAddress);
    if (this.callbacks.onConnect && typeof this.callbacks.onConnect === 'function') {
      return this.callbacks.onConnect(session, callback);
    }
    return callback();
  };

  const onMailFrom = (address, session, callback) => {
    if (this.callbacks.onMailFrom && typeof this.callbacks.onMailFrom === 'function') {
      return this.callbacks.onMailFrom(address, session, callback);
    }
    return callback();
  };

  const onRcptTo = (address, session, callback) => {
    if (this.callbacks.onRcptTo && typeof this.callbacks.onRcptTo === 'function') {
      return this.callbacks.onRcptTo(address, session, callback);
    }
    return callback();
  };

  const onData = (stream, session, callback) => {
    simpleParser(stream, (error, message) => {
      if (error) {
        return callback(error);
      }
      skyfall.events.emit({
        type: 'smtp:server:message',
        data: {
          message,
          session
        },
        source: this.id
      });
      return true;
    });
  };

  this.server = new SMTPServer({
    secure: options.secure || false,
    key: options.key ? fs.readFileSync(options.key) : null,
    certificate: options.certificate ? fs.readFileSync(options.certificate) : null,
    name: options.name || 'skyfall-smtp-server',
    size: Number(options.size) || 10485760, // 10MB
    authOptional: options.authOptional || true,
    allowInsecureAuth: options.allowInsecureAuth || true,
    disableReverseLookup: options.disableReverseLookup || false,
    maxClients: options.maxClients || Infinity,
    useProxy: options.useProxy || false,
    lmtp: options.lmtp || false,
    socketTimeout: Number(options.socketTimeout) || 60000, // 60s
    closeTimeout: Number(options.closeTimeout) || 30000, // 30s
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
      source: this.id
    });
  });
}

module.exports = {
  name: 'smtp',
  install: (skyfall, options) => {
    skyfall.smtp = new SMTP(skyfall, options);
  }
};
