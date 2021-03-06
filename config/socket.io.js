var socketIO = require('socket.io');
var redisClient = require('redis');
var url = require('url');
var glob = require('glob');
var logger = require('winston');

module.exports = function (server, config) {
  var utils = require(config.root + '/app/helpers/utils.js');
  var authentication = require(config.root + '/app/helpers/authentication.js');
  var manager = require(config.root + '/app/helpers/manager.js');

  /*
   * Start Redis Subscribe
   *
   * Server Message Structure
   * message = {
   *   type: 'change',
   *   resource: 'User',
   *   action: 'update',
   *   resource_content: {
   *     id: 1,
   *     name: 'Fred Moura'
   *   },
   *   recipient_uids: []
   *  }
   */
  var subscribe = redisClient.createClient(config.db);
  subscribe.subscribe('server-message');

  var redis = redisClient.createClient(config.db);

  /*
   * Listeners
   */
  var list = [];
  var listeners = [];
  list = glob.sync(config.root + '/app/listeners/**/*.js');
  list.forEach(function (listener) {
    listeners.push(require(listener));
  });

  /*
   * Clean Setted Online
   */
  authentication.setRedis(redis);
  authentication.clean();

  /*
   * Start Socket Server
   */
  var io = socketIO(server, config.socket.options);

  /*
   * Socket Authentication
   */
  io.use(function(socket, next){
    try{
      var requestUrl = url.parse(socket.request.url);
      var params = utils.getQueryParams(requestUrl);

      try{ authorization = JSON.parse(params.authorization); }
      catch(e) { authorization = params.authorization }
      logger.info('new request', {request_url: socket.request.url, authorization: authorization, timestamp: Date.now(), pid: process.pid});

      authentication.authenticate(authorization).then(function(user){
        logger.info('authenticated', {request_url: socket.request.url, authorization: authorization, user: user, timestamp: Date.now(), pid: process.pid});
        socket.uid = user.uid;
        socket.user = user;
        next();
      }, function () {
        logger.info('unauthorized', {request_url: socket.request.url, authorization: authorization, timestamp: Date.now(), pid: process.pid});
        next(new Error('Unauthorized'));
      });
    }catch(e){
      logger.info('unexpected error', {request_url: socket.request.url, authorization: authorization, timestamp: Date.now(), pid: process.pid});
      next(new Error('Unexpected Error'));
    }
  });

  /*
   * On Connect Socket Server
   */
  io.on('connection', function (socket) {
    authentication.setOnline(socket);
    manager.add(socket);

    /*
     * Apply Listeners
     */
    listeners.forEach(function (listener) {
      listener(socket, {
        redis: redis,
        subscribe: subscribe,
        manager: manager,
        config: config
      });
    });

    socket.once('disconnect', function(){
      authentication.setOffline(socket);
    });
  });
};