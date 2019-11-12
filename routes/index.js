const checkJwt = require('../middleware/Auth0/checkJwt');
const documents = require('./documents');

module.exports = (app) => {
  // app.use('/api/translate/documents', checkJwt, documents); // authentication: checkJwt
  app.use('/api/translate/documents', documents);
}