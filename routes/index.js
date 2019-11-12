const checkJwt = require('../middleware/Auth0/checkJwt');
const documents = require('./documents');

module.exports = (app) => {
  app.get('/test', (req, res, next) => {
    console.log('test');
    res.json({ msg: `GET /test` });
  });

  app.use('/api/translate/documents', checkJwt, documents); // authentication: checkJwt
  // app.use('/api/translate/documents', documents);
}