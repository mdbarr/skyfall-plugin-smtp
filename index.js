'use strict';

const { SMTPServer } = require('smtp-server');

function SMTP(skyfall, options) {
  this.id = skyfall.utils.id();
  this.server = new SMTPServer(options);
}

module.exports = {
  name: 'smtp',
  install: (skyfall, options) => {
    skyfall.smtp = new SMTP(skyfall, options);
  }
};
